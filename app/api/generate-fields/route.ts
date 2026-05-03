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
import type { Question } from "@/lib/question";
import { type LandlordRule, OPERATORS_BY_KIND } from "@/lib/landlord-rule";
import { callClaude, ClaudeApiError, extractText, stripCodeFences } from "@/lib/anthropic";
const DEFAULT_MAX_FIELDS_PER_QUESTION = 3;

const DEBUG = process.env.NODE_ENV !== "production";

function log(label: string, data?: unknown) {
  if (!DEBUG) return;
  const ts = new Date().toISOString().slice(11, 23);
  if (data !== undefined) {
    console.log(`[generate-fields ${ts}] ${label}`, typeof data === "string" ? data : JSON.stringify(data, null, 2));
  } else {
    console.log(`[generate-fields ${ts}] ${label}`);
  }
}

/**
 * Attempt to fix common JSON issues from LLM output:
 * trailing commas, truncated output (missing closing braces/brackets).
 */
function repairJson(raw: string): string {
  let s = raw.trim();
  s = s.replace(/,\s*([\]}])/g, "$1");
  const opens = { "{": "}", "[": "]" };
  const closes = new Set(["}", "]"]);
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch in opens) stack.push(opens[ch as keyof typeof opens]);
    else if (closes.has(ch)) stack.pop();
  }
  while (stack.length > 0) s += stack.pop();
  return s;
}

function buildSystemPrompt(
  existingFields: { id: string; label: string; value_kind: string }[],
  existingQuestions: { id: string; text: string; fieldIds: string[] }[],
  existingVisibilityRules: { targetFieldId: string; conditions: { fieldId: string; operator: string; value: string }[] }[],
  maxFieldsPerQuestion: number,
  generationAttempt: 0 | 1,
): string {
  let prompt = `You are a rental application assistant. Given a landlord's prompt, generate the data FIELDS needed and the interview QUESTIONS to collect them.

IMPORTANT:
- The landlord will describe what they want to ask applicants.
- Your job is to create:
  1. Fields (data schema) — the atomic data points to store. First, define the most natural human-facing label. Then, derive a concise, descriptive snake_case ID from that label.
  2. Questions (interview flow) — the questions to ask tenants, each linked to one or more fields
  3. Visibility rules (optional) — conditions that control when a field's question should be asked

RULES:
- A question CAN collect multiple fields (compound questions), but no question should collect more than ${maxFieldsPerQuestion} field(s). If you need more, split into multiple questions.
- Every NEW field must be referenced by at least one question.
- Do NOT duplicate fields that already exist.
- Prefer FEWER questions: if new fields are on the SAME TOPIC as an existing question (e.g. house rules, smoking, pets, drugs, lease compliance — or any similar screening theme), UPDATE that existing question: return its original "id", merge the new field id(s) into "fieldIds", and revise "text" so one natural question covers all of those fields. Only create a NEW question when the topic is clearly separate or merging would make the question awkward.
- When the landlord is adding fields for new screening rules, still look at EXISTING QUESTIONS below: reuse and expand a matching question whenever possible instead of adding redundant questions.
- When UPDATING an existing question, return its FULL fieldIds list (existing + new). When ADDING a new question, use a new id starting with "q_".
- If a question is being REPLACED or MERGED into another, include the old question's id in "deletedQuestionIds".
- The total fieldIds per question must NOT exceed ${maxFieldsPerQuestion}. If an existing question would exceed this after merging, split: delete the old one and create new questions.
- CRITICAL: Every field ID in every question's "fieldIds" array MUST either appear in EXISTING FIELDS below OR in your "newFields" output. Do not reference field IDs that are not defined.

VISIBILITY RULES:
- If a question should only be asked when a prior answer meets a condition (e.g. "ask pet deposit only if has_pets is true"), add a visibilityRule with targetFieldId set to one of that question's fieldIds and a conditions array.
- Only create visibility rules when there is a clear logical dependency between fields. Most questions need NO visibility rule.
- The targetFieldId must be an existing or newly created field. Each condition's fieldId must also be a known field.
- Valid operators depend on the field's value_kind: number: ==,!=,>,>=,<,<=  boolean: ==  text: ==,!=  date: ==,!=,>,>=,<,<=  enum: ==,!=
- Do NOT duplicate visibility rules that already exist (see EXISTING VISIBILITY RULES below if any).

Return ONLY a valid JSON object with this structure — no explanation, no code fences:
{
  "newFields": [
    { "id": "snake_case_id", "label": "Human-readable label", "value_kind": "text|number|boolean|date|enum", "options": ["only", "for", "enum"] }
  ],
  "questions": [
    { "id": "q_snake_case", "text": "Question to ask the applicant", "fieldIds": ["field_id_1", "field_id_2"], "extract_hint": "optional extraction hint" }
  ],
  "deletedQuestionIds": ["q_old_id"],
  "visibilityRules": [
    { "targetFieldId": "field_that_should_be_conditional", "conditions": [{ "fieldId": "prerequisite_field", "operator": "==", "value": "true" }] }
  ]
}

Value kinds: ${JSON.stringify(FIELD_VALUE_KINDS)}
If value_kind is "enum", include "options" with at least 2 distinct choices.
If no changes are needed, return {"newFields":[],"questions":[],"deletedQuestionIds":[],"visibilityRules":[]}.`;

  if (generationAttempt === 1) {
    prompt += `

GENERATION ATTEMPT: 2 (retry). A previous pass referenced field IDs that were not in the schema; missing definitions were added to EXISTING FIELDS. Regenerate a complete, consistent proposal. Every "fieldIds" entry must match EXISTING FIELDS or "newFields".`;
  }

  if (existingFields.length > 0) {
    prompt += `\n\nEXISTING FIELDS (do NOT duplicate):\n${existingFields.map((f) => `  - id: "${f.id}", label: "${f.label}", value_kind: "${f.value_kind}"`).join("\n")}`;
    prompt += `\nYou may reference these existing field IDs in new or updated questions and in visibility rule conditions.`;
  }
  if (existingQuestions.length > 0) {
    prompt += `\n\nEXISTING QUESTIONS (you may update or delete these — use their exact "id" to reference them):\n${existingQuestions.map((q) => `  - id: "${q.id}", text: "${q.text}", fieldIds: [${q.fieldIds.join(", ")}]`).join("\n")}`;
  }
  if (existingVisibilityRules.length > 0) {
    prompt += `\n\nEXISTING VISIBILITY RULES (do NOT duplicate):\n${existingVisibilityRules.map((r) => `  - Show "${r.targetFieldId}" only when: ${r.conditions.map((c) => `${c.fieldId} ${c.operator} ${c.value}`).join(" AND ")}`).join("\n")}`;
  }

  return prompt;
}

function buildRepairFieldsPrompt(missingIds: string[]): string {
  return `You are a rental application schema assistant. The interview generator referenced field IDs that are not yet defined in the database.

Return ONLY valid JSON — no markdown, no code fences:
{ "newFields": [ { "id": "exact_snake_case_id", "label": "Human label", "value_kind": "text|number|boolean|date|enum", "options": ["only","for","enum"] } ] }

Rules:
- You MUST include exactly one object per missing field id, using that EXACT "id" string (same spelling and casing).
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

function parseGeneratedQuestion(v: unknown): Question | null {
  if (typeof v !== "object" || v === null) return null;
  const q = v as Record<string, unknown>;
  if (typeof q.id !== "string" || typeof q.text !== "string" || !q.text.trim()) return null;
  if (!Array.isArray(q.fieldIds) || q.fieldIds.length === 0) return null;

  const fieldIds = (q.fieldIds as unknown[]).filter((x): x is string => typeof x === "string");
  if (fieldIds.length === 0) return null;

  return {
    id: q.id,
    text: q.text,
    fieldIds,
    sort_order: 0,
    extract_hint: typeof q.extract_hint === "string" ? q.extract_hint : undefined,
    branches: [],
  };
}

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

function parseVisibilityRule(
  v: unknown,
  allFields: Map<string, FieldValueKind>,
): LandlordRule | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  const targetFieldId = typeof r.targetFieldId === "string" ? r.targetFieldId : null;
  if (!targetFieldId || !allFields.has(targetFieldId)) return null;
  if (!Array.isArray(r.conditions) || r.conditions.length === 0) return null;

  const conditions = r.conditions
    .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
    .map((c) => {
      if (typeof c.fieldId !== "string" || typeof c.operator !== "string" || c.value == null) return null;
      const condFieldKind = allFields.get(c.fieldId);
      if (!condFieldKind) return null;
      const validOps = OPERATORS_BY_KIND[condFieldKind];
      if (!validOps?.includes(c.operator)) return null;
      const value = String(c.value).trim();
      if (!value) return null;
      return { id: generateId(), fieldId: c.fieldId, operator: c.operator, value };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  if (conditions.length === 0) return null;

  return {
    id: generateId(),
    kind: "ask" as const,
    targetFieldId,
    conditions,
  };
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
  visibilityRules: LandlordRule[];
  rawFieldsLen: number;
  rawQuestionsLen: number;
  rawVisLen: number;
};

function parseResultObject(
  result: Record<string, unknown>,
  existingFields: { id: string; label: string; value_kind: string }[],
  existingVisibilityRules: { targetFieldId: string; conditions: { fieldId: string; operator: string; value: string }[] }[],
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
  const questions = rawQuestions
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

  const rawVisRules = Array.isArray(result.visibilityRules) ? result.visibilityRules : [];
  const existingTargets = new Set(existingVisibilityRules.map((r) => r.targetFieldId));
  const visibilityRules = rawVisRules
    .map((v) => parseVisibilityRule(v, allFieldKinds))
    .filter((r): r is LandlordRule => r !== null)
    .filter((r) => !existingTargets.has(r.targetFieldId!));

  return {
    newFields,
    questions,
    deletedQuestionIds,
    visibilityRules,
    rawFieldsLen: rawFields.length,
    rawQuestionsLen: rawQuestions.length,
    rawVisLen: rawVisRules.length,
  };
}

async function callClaudeJson(key: string, system: string, user: string): Promise<unknown> {
  const response = await callClaude(key, {
    system,
    messages: [{ role: "user", content: user }],
    max_tokens: 2048,
  });
  const raw = extractText(response);
  const cleaned = stripCodeFences(raw);
  try {
    return JSON.parse(cleaned);
  } catch (firstErr) {
    const repaired = repairJson(cleaned);
    try {
      return JSON.parse(repaired);
    } catch {
      throw new Error(`JSON parse failed: ${(firstErr as Error).message}`);
    }
  }
}

async function repairMissingFields(
  key: string,
  missingIds: string[],
  description: string,
  questionsSnapshot: Question[],
): Promise<LandlordField[]> {
  const system = buildRepairFieldsPrompt(missingIds);
  const user = `Landlord instruction:\n${description}\n\nProposed questions that reference the missing ids (for context):\n${JSON.stringify(questionsSnapshot.map((q) => ({ id: q.id, text: q.text, fieldIds: q.fieldIds })), null, 2)}`;

  const parsed = await callClaudeJson(key, system, user);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Repair response was not an object");
  }
  const rec = parsed as Record<string, unknown>;
  const raw = Array.isArray(rec.newFields) ? rec.newFields : [];
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
  | { ok: true; newFields: LandlordField[]; questions: Question[]; deletedQuestionIds: string[]; visibilityRules: LandlordRule[] }
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
        (x): x is { id: string; label: string; value_kind: string } =>
          typeof x === "object" && x !== null && typeof (x as any).id === "string" && typeof (x as any).label === "string"
      )
    : [];

  const existingQuestions: { id: string; text: string; fieldIds: string[] }[] = Array.isArray(rec.existingQuestions)
    ? (rec.existingQuestions as unknown[]).filter(
        (x): x is { id: string; text: string; fieldIds: string[] } =>
          typeof x === "object" && x !== null && typeof (x as any).id === "string" && typeof (x as any).text === "string"
      )
    : [];

  const existingVisibilityRules: { targetFieldId: string; conditions: { fieldId: string; operator: string; value: string }[] }[] =
    Array.isArray(rec.existingVisibilityRules)
      ? (rec.existingVisibilityRules as unknown[]).filter(
          (x): x is { targetFieldId: string; conditions: { fieldId: string; operator: string; value: string }[] } =>
            typeof x === "object" && x !== null && typeof (x as any).targetFieldId === "string" && Array.isArray((x as any).conditions)
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
      existingVisibilityRules,
      maxFieldsPerQuestion,
      0,
    );

    const response0 = await callClaude(key, {
      system: system0,
      messages: [{ role: "user", content: description }],
      max_tokens: 2048,
    });
    const raw0 = extractText(response0);
    const cleaned0 = stripCodeFences(raw0);
    log("raw response (attempt 0)", raw0);

    let parsed0: unknown;
    try {
      parsed0 = JSON.parse(cleaned0);
    } catch (firstErr) {
      log("JSON.parse failed, attempting repair…");
      const repaired = repairJson(cleaned0);
      try {
        parsed0 = JSON.parse(repaired);
        log("repair succeeded");
      } catch {
        log("repair also failed", (firstErr as Error).message);
        return NextResponse.json(
          { ok: false, error: "AI returned invalid JSON", raw: cleaned0 },
          { status: 502 },
        );
      }
    }

    if (typeof parsed0 !== "object" || parsed0 === null) {
      return NextResponse.json(
        { ok: false, error: "AI response was not an object", raw: cleaned0 },
        { status: 502 },
      );
    }

    const firstPass = parseResultObject(parsed0 as Record<string, unknown>, existingFields, existingVisibilityRules);

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
        existingVisibilityRules,
        maxFieldsPerQuestion,
        1,
      );

      const response1 = await callClaude(key, {
        system: system1,
        messages: [{ role: "user", content: description }],
        max_tokens: 2048,
      });
      const raw1 = extractText(response1);
      const cleaned1 = stripCodeFences(raw1);
      log("raw response (attempt 1)", raw1);

      let parsed1: unknown;
      try {
        parsed1 = JSON.parse(cleaned1);
      } catch (firstErr) {
        const repaired = repairJson(cleaned1);
        try {
          parsed1 = JSON.parse(repaired);
        } catch {
          return NextResponse.json(
            { ok: false, error: "AI returned invalid JSON on retry", raw: cleaned1 },
            { status: 502 },
          );
        }
      }

      if (typeof parsed1 !== "object" || parsed1 === null) {
        return NextResponse.json(
          { ok: false, error: "AI retry response was not an object", raw: cleaned1 },
          { status: 502 },
        );
      }

      const second = parseResultObject(parsed1 as Record<string, unknown>, augmentedExisting, existingVisibilityRules);
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
        rawVisLen: second.rawVisLen,
      };
    }

    log("parsed results", {
      newFields: parsed.newFields.length,
      questions: parsed.questions.length,
      deletedQuestionIds: parsed.deletedQuestionIds,
      visibilityRules: parsed.visibilityRules.length,
      droppedFields: parsed.rawFieldsLen - parsed.newFields.length,
      droppedQuestions: parsed.rawQuestionsLen - parsed.questions.length,
      droppedVisRules: parsed.rawVisLen - parsed.visibilityRules.length,
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
      visibilityRules: parsed.visibilityRules,
    } satisfies GenerateFieldsResponse);
  } catch (err) {
    if (err instanceof ClaudeApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
