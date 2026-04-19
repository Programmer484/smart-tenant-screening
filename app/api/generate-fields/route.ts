import { NextResponse } from "next/server";
import {
  LandlordField,
  FieldValueKind,
  FIELD_VALUE_KINDS,
  validateLandlordFieldId,
  validateLandlordFieldLabel,
  normalizeEnumOptions,
  validateEnumOptions,
} from "@/lib/landlord-field";
import type { Question, QuestionTrigger } from "@/lib/question";
import { OPERATORS_BY_KIND, VALUELESS_OPERATORS } from "@/lib/landlord-rule";
import { callClaude, ClaudeApiError, extractToolUse } from "@/lib/anthropic";
import { DEFAULT_MAX_FIELDS_PER_QUESTION } from "@/lib/property";

const DEBUG = process.env.NODE_ENV !== "production";

/** Large field + question payloads can be verbose; give the model headroom. */
const GENERATE_FIELDS_MAX_OUTPUT_TOKENS = 8192;

const FIELD_INPUT_SCHEMA = {
  type: "object",
  properties: {
    id: {
      type: "string",
      pattern: "^[a-z][a-z0-9_]*$",
      description: "snake_case identifier; must start with a letter",
    },
    label: { type: "string", description: "Human-readable field label" },
    value_kind: { type: "string", enum: [...FIELD_VALUE_KINDS] },
    options: {
      type: "array",
      items: { type: "string" },
      description: "Required when value_kind is 'enum' (>=2 distinct choices)",
    },
  },
  required: ["id", "label", "value_kind"],
} as const;

const TRIGGER_INPUT_SCHEMA = {
  type: "object",
  properties: {
    fieldId: {
      type: "string",
      description: "MUST be one of the parent question's fieldIds",
    },
    operator: { type: "string" },
    value: {
      type: "string",
      description:
        "Boolean values must be the literal strings 'true' or 'false'. Omit for is_empty/is_not_empty.",
    },
  },
  required: ["fieldId", "operator"],
} as const;

const QUESTION_INPUT_SCHEMA = {
  type: "object",
  properties: {
    id: {
      type: "string",
      description: "Use existing question id when updating; otherwise a new id starting with 'q_'",
    },
    text: { type: "string", description: "Question shown to the applicant" },
    fieldIds: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      description: "IDs of fields this question collects (must exist in newFields or EXISTING FIELDS)",
    },
    extract_hint: { type: "string" },
    parentQuestionId: {
      type: "string",
      description:
        "Set when this question is a conditional follow-up. Must reference another question's id (existing or in this same proposal). Omit for root questions.",
    },
    trigger: {
      ...TRIGGER_INPUT_SCHEMA,
      description:
        "Required when parentQuestionId is set. The trigger.fieldId must be one of the parent question's fieldIds.",
    },
  },
  required: ["id", "text", "fieldIds"],
} as const;

const PROPOSE_TOOL = {
  name: "propose_fields_and_questions",
  description:
    "Submit the proposed schema fields, interview questions (with optional parent + trigger for conditional follow-ups), and deletions for the landlord's screening flow.",
  input_schema: {
    type: "object",
    properties: {
      newFields: { type: "array", items: FIELD_INPUT_SCHEMA },
      questions: { type: "array", items: QUESTION_INPUT_SCHEMA },
      deletedQuestionIds: {
        type: "array",
        items: { type: "string" },
        description: "IDs of EXISTING QUESTIONS to remove (e.g. when merged into another)",
      },
    },
    required: ["newFields", "questions", "deletedQuestionIds"],
  },
} as const;

const REPAIR_TOOL = {
  name: "define_missing_fields",
  description:
    "Define schema definitions for the listed missing field IDs so they can be referenced by interview questions.",
  input_schema: {
    type: "object",
    properties: {
      newFields: {
        type: "array",
        minItems: 1,
        items: FIELD_INPUT_SCHEMA,
      },
    },
    required: ["newFields"],
  },
} as const;

function log(label: string, data?: unknown) {
  if (!DEBUG) return;
  const ts = new Date().toISOString().slice(11, 23);
  if (data !== undefined) {
    console.log(`[generate-fields ${ts}] ${label}`, typeof data === "string" ? data : JSON.stringify(data, null, 2));
  } else {
    console.log(`[generate-fields ${ts}] ${label}`);
  }
}

function buildSystemPrompt(
  existingFields: { id: string; label: string; value_kind: string }[],
  existingQuestions: { id: string; text: string; fieldIds: string[]; parentQuestionId?: string; trigger?: QuestionTrigger }[],
  maxFieldsPerQuestion: number,
  generationAttempt: 0 | 1,
): string {
  let prompt = `You are a rental application assistant. Given a landlord's prompt, generate the data FIELDS needed and the interview QUESTIONS to collect them.

You MUST respond by calling the "${PROPOSE_TOOL.name}" tool with the proposal as its input. Do not write any prose; the tool input is the entire response.

IMPORTANT:
- The landlord will describe what they want to ask applicants.
- Your job is to create:
  1. Fields (data schema) — the atomic data points to store. First, define the most natural human-facing label. Then, derive a concise, descriptive snake_case ID from that label.
  2. Questions (interview flow) — the questions to ask tenants, each linked to one or more fields. Conditional follow-ups carry a "parentQuestionId" + "trigger".

RULES:
- A question CAN collect multiple fields (compound questions), but no question should collect more than ${maxFieldsPerQuestion} field(s). If you need more, split into multiple questions.
- Every NEW field must be referenced by at least one question.
- Each field is OWNED BY EXACTLY ONE question — never put the same fieldId on two different questions.
- Do NOT duplicate fields that already exist.
- Prefer FEWER questions: if new fields are on the SAME TOPIC as an existing question (e.g. house rules, smoking, pets, drugs, lease compliance — or any similar screening theme), UPDATE that existing question: return its original "id", merge the new field id(s) into "fieldIds", and revise "text" so one natural question covers all of those fields. Only create a NEW question when the topic is clearly separate or merging would make the question awkward.
- When the landlord is adding fields for new screening rules, still look at EXISTING QUESTIONS below: reuse and expand a matching question whenever possible instead of adding redundant questions.
- When UPDATING an existing question, return its FULL fieldIds list (existing + new). When ADDING a new question, use a new id starting with "q_".
- If a question is being REPLACED or MERGED into another, include the old question's id in "deletedQuestionIds".
- The total fieldIds per question must NOT exceed ${maxFieldsPerQuestion}. If an existing question would exceed this after merging, split: delete the old one and create new questions.
- CRITICAL: Every field ID in every question's "fieldIds" array MUST either appear in EXISTING FIELDS below OR in your "newFields" output. Do not reference field IDs that are not defined.

CONDITIONAL FOLLOW-UPS (parentQuestionId + trigger):
- A follow-up is asked only when its parent question's answer matches a condition (e.g. "ask pet_count only if has_pets is true").
- To create one: include the follow-up in "questions" with parentQuestionId = the parent question's id, and trigger = { fieldId, operator, value } where fieldId MUST be one of the PARENT question's fieldIds.
- The parent's fieldId must already be on the parent — child follow-ups can ONLY trigger off their direct parent's answers, not arbitrary earlier ones. Build deeper chains by chaining parents (Q1 → Q2 → Q3), each child triggering off ITS parent.
- Sibling follow-ups: multiple follow-ups can share the same parentQuestionId and trigger off the same (or different) parent fields.
- Make sure the parent question appears EARLIER than its children in the "questions" array.
- Most questions need NO trigger — only add it when there is a clear logical dependency.
- Valid operators depend on the parent field's value_kind. All kinds also support is_empty / is_not_empty (which take NO value):
  number: ==,!=,>,>=,<,<=,is_empty,is_not_empty
  boolean: ==,is_empty,is_not_empty
  text: ==,!=,contains,is_empty,is_not_empty
  date: ==,!=,>,>=,<,<=,is_empty,is_not_empty
  enum: ==,!=,is_empty,is_not_empty
- For is_empty / is_not_empty, omit the trigger "value" (or use an empty string).
- For boolean triggers, value MUST be the string "true" or "false" (lowercase).

Value kinds: ${JSON.stringify(FIELD_VALUE_KINDS)}
If value_kind is "enum", include "options" with at least 2 distinct choices.
If no changes are needed, call the tool with all three arrays empty.`;

  if (generationAttempt === 1) {
    prompt += `

GENERATION ATTEMPT: 2 (retry). A previous pass referenced field IDs that were not in the schema; missing definitions were added to EXISTING FIELDS. Regenerate a complete, consistent proposal. Every "fieldIds" entry must match EXISTING FIELDS or "newFields".`;
  }

  if (existingFields.length > 0) {
    prompt += `\n\nEXISTING FIELDS (do NOT duplicate):\n${existingFields.map((f) => `  - id: "${f.id}", label: "${f.label}", value_kind: "${f.value_kind}"`).join("\n")}`;
    prompt += `\nYou may reference these existing field IDs in new or updated questions and in trigger conditions.`;
  }
  if (existingQuestions.length > 0) {
    prompt += `\n\nEXISTING QUESTIONS (you may update or delete these — use their exact "id" to reference them):\n${existingQuestions
      .map((q) => {
        const parent = q.parentQuestionId ? `, parentQuestionId: "${q.parentQuestionId}"` : "";
        const trig = q.trigger
          ? `, trigger: { fieldId: "${q.trigger.fieldId}", operator: "${q.trigger.operator}"${q.trigger.value ? `, value: "${q.trigger.value}"` : ""} }`
          : "";
        return `  - id: "${q.id}", text: "${q.text}", fieldIds: [${q.fieldIds.join(", ")}]${parent}${trig}`;
      })
      .join("\n")}`;
  }

  return prompt;
}

function buildRepairFieldsPrompt(missingIds: string[]): string {
  return `You are a rental application schema assistant. The interview generator referenced field IDs that are not yet defined in the database.

You MUST respond by calling the "${REPAIR_TOOL.name}" tool with definitions for every missing field id below.

Rules:
- Include exactly one object per missing field id, using that EXACT "id" string (same spelling and casing).
- Choose an appropriate value_kind and human-readable label from context.
- If value_kind is "enum", include at least 2 options.
- Value kinds allowed: ${JSON.stringify(FIELD_VALUE_KINDS)}

Missing field ids to define:
${missingIds.map((id) => `  - "${id}"`).join("\n")}`;
}

function parseGeneratedField(v: unknown): LandlordField | null {
  if (typeof v !== "object" || v === null) return null;
  const f = v as Record<string, unknown>;
  if (
    typeof f.id !== "string" ||
    validateLandlordFieldId(f.id) !== null ||
    typeof f.label !== "string" ||
    validateLandlordFieldLabel(f.label) !== null
  ) {
    return null;
  }
  const value_kind = f.value_kind as LandlordField["value_kind"];
  if (!FIELD_VALUE_KINDS.includes(value_kind)) return null;

  const out: LandlordField = {
    id: f.id,
    label: f.label,
    value_kind,
  };

  if (value_kind === "enum") {
    if (!Array.isArray(f.options)) return null;
    const rawOpts = f.options
      .filter((x) => typeof x === "string")
      .map((x) => x as string);
    const options = normalizeEnumOptions(rawOpts);
    if (validateEnumOptions(options) !== null) return null;
    out.options = options;
  }

  return out;
}

/** Parse a question, but DEFER trigger validation — we need the full question
 *  list (existing + proposed) and field schema, which we don't have at this
 *  point. We just preserve raw parent + trigger fields and validate later. */
function parseGeneratedQuestion(v: unknown): Question | null {
  if (typeof v !== "object" || v === null) return null;
  const q = v as Record<string, unknown>;
  if (typeof q.id !== "string" || typeof q.text !== "string" || !q.text.trim()) return null;
  if (!Array.isArray(q.fieldIds) || q.fieldIds.length === 0) return null;

  const fieldIds = (q.fieldIds as unknown[]).filter((x): x is string => typeof x === "string");
  if (fieldIds.length === 0) return null;

  const out: Question = {
    id: q.id,
    text: q.text,
    fieldIds,
    sort_order: 0,
    extract_hint: typeof q.extract_hint === "string" ? q.extract_hint : undefined,
  };

  if (typeof q.parentQuestionId === "string" && q.parentQuestionId.trim()) {
    out.parentQuestionId = q.parentQuestionId;
  }

  if (typeof q.trigger === "object" && q.trigger !== null) {
    const t = q.trigger as Record<string, unknown>;
    if (typeof t.fieldId === "string" && typeof t.operator === "string") {
      const value = typeof t.value === "string" ? t.value : "";
      out.trigger = {
        fieldId: t.fieldId,
        operator: t.operator,
        value,
      };
    }
  }

  return out;
}

/** After the LLM returns, validate parent/trigger pairs against the full set
 *  of (existing + proposed) questions and known fields. Drops a question's
 *  trigger (and parentQuestionId) if it can't be resolved — we'd rather show
 *  it as a root than silently break the tree. */
function sanitizeQuestionTriggers(
  proposed: Question[],
  existingQuestions: { id: string; fieldIds: string[] }[],
  knownFields: Map<string, FieldValueKind>,
): { questions: Question[]; droppedTriggers: number } {
  const allById = new Map<string, { fieldIds: string[] }>();
  for (const eq of existingQuestions) allById.set(eq.id, { fieldIds: eq.fieldIds });
  for (const pq of proposed) allById.set(pq.id, { fieldIds: pq.fieldIds });

  let droppedTriggers = 0;
  const out: Question[] = proposed.map((q) => {
    if (!q.parentQuestionId) {
      if (q.trigger) {
        droppedTriggers++;
        const { trigger: _trig, ...rest } = q;
        return rest;
      }
      return q;
    }
    const parent = allById.get(q.parentQuestionId);
    if (!parent || q.parentQuestionId === q.id) {
      droppedTriggers++;
      const { parentQuestionId: _p, trigger: _t, ...rest } = q;
      return rest;
    }
    if (!q.trigger) {
      droppedTriggers++;
      const { parentQuestionId: _p, ...rest } = q;
      return rest;
    }
    if (!parent.fieldIds.includes(q.trigger.fieldId)) {
      droppedTriggers++;
      const { parentQuestionId: _p, trigger: _t, ...rest } = q;
      return rest;
    }
    const kind = knownFields.get(q.trigger.fieldId);
    if (!kind) {
      droppedTriggers++;
      const { parentQuestionId: _p, trigger: _t, ...rest } = q;
      return rest;
    }
    const validOps = OPERATORS_BY_KIND[kind];
    if (!validOps?.includes(q.trigger.operator)) {
      droppedTriggers++;
      const { parentQuestionId: _p, trigger: _t, ...rest } = q;
      return rest;
    }
    if (!VALUELESS_OPERATORS.has(q.trigger.operator) && !q.trigger.value.trim()) {
      droppedTriggers++;
      const { parentQuestionId: _p, trigger: _t, ...rest } = q;
      return rest;
    }
    return q;
  });

  return { questions: out, droppedTriggers };
}

function knownFieldIdSet(
  existingFields: { id: string }[],
  newFields: LandlordField[],
): Set<string> {
  const s = new Set<string>();
  for (const f of existingFields) s.add(f.id);
  for (const f of newFields) s.add(f.id);
  return s;
}

function collectOrphanFieldIds(questions: Question[], known: Set<string>): string[] {
  const out = new Set<string>();
  for (const q of questions) {
    for (const fid of q.fieldIds) {
      if (!known.has(fid)) out.add(fid);
    }
  }
  return [...out];
}

function mergeFieldsById(...lists: LandlordField[][]): LandlordField[] {
  const map = new Map<string, LandlordField>();
  for (const list of lists) {
    for (const f of list) {
      map.set(f.id, f);
    }
  }
  return [...map.values()];
}

type ParsedGenerateResult = {
  newFields: LandlordField[];
  questions: Question[];
  deletedQuestionIds: string[];
  rawFieldsLen: number;
  rawQuestionsLen: number;
};

function parseResultObject(
  result: Record<string, unknown>,
  existingFields: { id: string; label: string; value_kind: string }[],
  existingQuestions: { id: string; fieldIds: string[] }[],
): ParsedGenerateResult {
  const rawFields = Array.isArray(result.newFields)
    ? result.newFields
    : Array.isArray(result.fields)
      ? result.fields
      : [];
  const newFields = rawFields
    .map(parseGeneratedField)
    .filter((x): x is LandlordField => x !== null);

  const rawQuestions = Array.isArray(result.questions) ? result.questions : [];
  const proposedQuestions = rawQuestions
    .map(parseGeneratedQuestion)
    .filter((x): x is Question => x !== null);

  const deletedQuestionIds = Array.isArray(result.deletedQuestionIds)
    ? result.deletedQuestionIds.filter((x): x is string => typeof x === "string")
    : [];

  const allFieldKinds = new Map<string, FieldValueKind>();
  for (const ef of existingFields) {
    if (FIELD_VALUE_KINDS.includes(ef.value_kind as FieldValueKind)) {
      allFieldKinds.set(ef.id, ef.value_kind as FieldValueKind);
    }
  }
  for (const nf of newFields) {
    allFieldKinds.set(nf.id, nf.value_kind);
  }

  const remainingExisting = existingQuestions.filter((eq) => !deletedQuestionIds.includes(eq.id));
  const { questions, droppedTriggers } = sanitizeQuestionTriggers(
    proposedQuestions,
    remainingExisting,
    allFieldKinds,
  );
  if (DEBUG && droppedTriggers > 0) log("dropped invalid triggers", droppedTriggers);

  return {
    newFields,
    questions,
    deletedQuestionIds,
    rawFieldsLen: rawFields.length,
    rawQuestionsLen: rawQuestions.length,
  };
}

async function callProposeTool(
  key: string,
  system: string,
  description: string,
): Promise<Record<string, unknown>> {
  const response = await callClaude(key, {
    system,
    messages: [{ role: "user", content: description }],
    max_tokens: GENERATE_FIELDS_MAX_OUTPUT_TOKENS,
    tools: [PROPOSE_TOOL as unknown as { name: string; description: string; input_schema: Record<string, unknown> }],
    tool_choice: { type: "tool", name: PROPOSE_TOOL.name },
  });
  const input = extractToolUse<Record<string, unknown>>(response, PROPOSE_TOOL.name);
  if (!input) {
    throw new Error(`Model did not invoke ${PROPOSE_TOOL.name} tool`);
  }
  return input;
}

async function repairMissingFields(
  key: string,
  missingIds: string[],
  description: string,
  questionsSnapshot: Question[],
): Promise<LandlordField[]> {
  const system = buildRepairFieldsPrompt(missingIds);
  const user = `Landlord instruction:\n${description}\n\nProposed questions that reference the missing ids (for context):\n${JSON.stringify(questionsSnapshot.map((q) => ({ id: q.id, text: q.text, fieldIds: q.fieldIds })), null, 2)}`;

  const response = await callClaude(key, {
    system,
    messages: [{ role: "user", content: user }],
    max_tokens: GENERATE_FIELDS_MAX_OUTPUT_TOKENS,
    tools: [REPAIR_TOOL as unknown as { name: string; description: string; input_schema: Record<string, unknown> }],
    tool_choice: { type: "tool", name: REPAIR_TOOL.name },
  });
  const input = extractToolUse<{ newFields?: unknown[] }>(response, REPAIR_TOOL.name);
  if (!input) {
    throw new Error(`Model did not invoke ${REPAIR_TOOL.name} tool`);
  }

  const raw = Array.isArray(input.newFields) ? input.newFields : [];
  const fields = raw.map(parseGeneratedField).filter((x): x is LandlordField => x !== null);
  const byId = new Map(fields.map((f) => [f.id, f]));
  const missing: string[] = [];
  for (const id of missingIds) {
    if (!byId.has(id)) missing.push(id);
  }
  if (missing.length > 0) {
    throw new Error(`Repair did not define all missing fields: ${missing.join(", ")}`);
  }
  return missingIds.map((id) => byId.get(id)!);
}

function toExistingRow(f: LandlordField): { id: string; label: string; value_kind: string } {
  return { id: f.id, label: f.label, value_kind: f.value_kind };
}

function augmentExistingForRetry(
  base: { id: string; label: string; value_kind: string }[],
  ...extraFields: LandlordField[][]
): { id: string; label: string; value_kind: string }[] {
  const map = new Map<string, { id: string; label: string; value_kind: string }>();
  for (const row of base) {
    map.set(row.id, row);
  }
  for (const list of extraFields) {
    for (const f of list) {
      map.set(f.id, toExistingRow(f));
    }
  }
  return [...map.values()];
}

export type GenerateFieldsResponse =
  | { ok: true; newFields: LandlordField[]; questions: Question[]; deletedQuestionIds: string[] }
  | { ok: false; error: string; violations?: { text: string; fieldIds: string[]; id?: string }[]; orphanFieldIds?: string[] };

export async function POST(req: Request) {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "CLAUDE_API_KEY is not set" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rec = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

  const description = typeof rec.description === "string" ? rec.description.trim() : "";
  if (!description) {
    return NextResponse.json({ error: "Missing description" }, { status: 400 });
  }

  const maxFieldsPerQuestion = typeof rec.maxFieldsPerQuestion === "number" && rec.maxFieldsPerQuestion >= 1
    ? rec.maxFieldsPerQuestion
    : DEFAULT_MAX_FIELDS_PER_QUESTION;

  const existingFields: { id: string; label: string; value_kind: string }[] = Array.isArray(rec.existingFields)
    ? (rec.existingFields as unknown[]).filter(
        (x): x is { id: string; label: string; value_kind: string } => {
          if (typeof x !== "object" || x === null) return false;
          const o = x as Record<string, unknown>;
          return typeof o.id === "string" && typeof o.label === "string";
        }
      )
    : [];

  const existingQuestions: { id: string; text: string; fieldIds: string[]; parentQuestionId?: string; trigger?: QuestionTrigger }[] = Array.isArray(rec.existingQuestions)
    ? (rec.existingQuestions as unknown[]).filter(
        (x): x is { id: string; text: string; fieldIds: string[]; parentQuestionId?: string; trigger?: QuestionTrigger } => {
          if (typeof x !== "object" || x === null) return false;
          const o = x as Record<string, unknown>;
          return typeof o.id === "string" && typeof o.text === "string";
        }
      )
    : [];

  try {
    log("prompt (user)", description);
    log("existingFields", existingFields.length);
    log("existingQuestions", existingQuestions.length);
    log("maxFieldsPerQuestion", maxFieldsPerQuestion);

    const system0 = buildSystemPrompt(
      existingFields,
      existingQuestions,
      maxFieldsPerQuestion,
      0,
    );

    const toolInput0 = await callProposeTool(key, system0, description);
    log("tool input (attempt 0)", toolInput0);

    const firstPass = parseResultObject(toolInput0, existingFields, existingQuestions);

    let parsed = firstPass;
    let known = knownFieldIdSet(existingFields, parsed.newFields);
    let orphans = collectOrphanFieldIds(parsed.questions, known);

    if (orphans.length > 0) {
      log("orphan field refs after attempt 0", orphans);
      let repairFields: LandlordField[];
      try {
        repairFields = await repairMissingFields(key, orphans, description, parsed.questions);
      } catch (e) {
        log("field repair failed", (e as Error).message);
        return NextResponse.json(
          {
            ok: false,
            error: `Referenced unknown field ids with no schema: ${orphans.join(", ")}. Field repair failed: ${(e as Error).message}`,
            orphanFieldIds: orphans,
          } satisfies GenerateFieldsResponse,
          { status: 422 },
        );
      }

      const augmentedExisting = augmentExistingForRetry(existingFields, parsed.newFields, repairFields);
      const system1 = buildSystemPrompt(
        augmentedExisting,
        existingQuestions,
        maxFieldsPerQuestion,
        1,
      );

      const toolInput1 = await callProposeTool(key, system1, description);
      log("tool input (attempt 1)", toolInput1);

      const second = parseResultObject(toolInput1, augmentedExisting, existingQuestions);
      known = knownFieldIdSet(augmentedExisting, second.newFields);
      orphans = collectOrphanFieldIds(second.questions, known);

      if (orphans.length > 0) {
        log("orphan field refs after attempt 1", orphans);
        return NextResponse.json(
          {
            ok: false,
            error: "Question generation still referenced unknown fields after repair and retry.",
            orphanFieldIds: orphans,
          } satisfies GenerateFieldsResponse,
          { status: 422 },
        );
      }

      parsed = {
        ...second,
        newFields: mergeFieldsById(firstPass.newFields, repairFields, second.newFields),
        rawFieldsLen: second.rawFieldsLen,
        rawQuestionsLen: second.rawQuestionsLen,
      };
    }

    log("parsed results", {
      newFields: parsed.newFields.length,
      questions: parsed.questions.length,
      deletedQuestionIds: parsed.deletedQuestionIds,
      droppedFields: parsed.rawFieldsLen - parsed.newFields.length,
      droppedQuestions: parsed.rawQuestionsLen - parsed.questions.length,
    });

    const violations = parsed.questions.filter((q) => q.fieldIds.length > maxFieldsPerQuestion);
    if (violations.length > 0) {
      log("maxFields violations", violations.map((q) => ({ id: q.id, fieldIds: q.fieldIds })));
      return NextResponse.json({
        ok: false,
        error: `${violations.length} question(s) exceed the max of ${maxFieldsPerQuestion} field(s) per question`,
        violations: violations.map((q) => ({ text: q.text, fieldIds: q.fieldIds, id: q.id })),
      } satisfies GenerateFieldsResponse, { status: 422 });
    }

    log("success");
    return NextResponse.json({
      ok: true,
      newFields: parsed.newFields,
      questions: parsed.questions,
      deletedQuestionIds: parsed.deletedQuestionIds,
    } satisfies GenerateFieldsResponse);
  } catch (err) {
    if (err instanceof ClaudeApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
