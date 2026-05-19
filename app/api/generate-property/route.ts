import { NextResponse } from "next/server";
import {
  LandlordField,
  FIELD_VALUE_KINDS,
  validateLandlordFieldId,
  validateLandlordFieldLabel,
  normalizeEnumOptions,
  validateEnumOptions,
} from "@/lib/landlord-field";
import type { Branch, BranchOutcome, Question } from "@/lib/question";
import type { PropertyVariable, PropertyLinks, AiInstructions } from "@/lib/property";
import { OPERATORS_BY_KIND } from "@/lib/landlord-rule";
import { callClaude, ClaudeApiError, extractText, stripCodeFences } from "@/lib/anthropic";
import { sanitizeQuestions } from "@/lib/condition-utils";

const DEFAULT_MAX_FIELDS_PER_QUESTION = 3;
const DEBUG = process.env.NODE_ENV !== "production";

function log(label: string, data?: unknown) {
  if (!DEBUG) return;
  const ts = new Date().toISOString().slice(11, 23);
  if (data !== undefined) {
    console.log(`[generate-property ${ts}] ${label}`, typeof data === "string" ? data : JSON.stringify(data, null, 2));
  } else {
    console.log(`[generate-property ${ts}] ${label}`);
  }
}

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

const VALID_OUTCOMES: BranchOutcome[] = ["continue", "followups", "reject"];

type ExistingQuestion = {
  id: string;
  text: string;
  fieldIds: string[];
  branches?: { condition: { fieldId: string; operator: string; value: string }; outcome: string }[];
};

function formatExistingQuestions(questions: ExistingQuestion[]): string {
  return questions.map((q) => {
    const base = `  - id: "${q.id}", text: "${q.text}", fieldIds: [${q.fieldIds.join(", ")}]`;
    if (!q.branches?.length) return base;
    const branchLines = q.branches
      .map((b) => `      - [${b.condition.fieldId} ${b.condition.operator} ${b.condition.value}] → ${b.outcome}`)
      .join("\n");
    return `${base}\n    branches:\n${branchLines}`;
  }).join("\n");
}

export function buildSystemPrompt(
  existingFields: { id: string; label: string; value_kind: string }[],
  existingQuestions: ExistingQuestion[],
  variables: PropertyVariable[],
  links: PropertyLinks,
  aiInstructions: Partial<AiInstructions>,
  maxFieldsPerQuestion: number,
  generationAttempt: 0 | 1,
): string {
  const fieldDescriptions = existingFields
    .filter((f) => OPERATORS_BY_KIND[f.value_kind as keyof typeof OPERATORS_BY_KIND])
    .map((f) => {
      const base = `  - id: "${f.id}", value_kind: "${f.value_kind}", label: "${f.label}"`;
      const ops = OPERATORS_BY_KIND[f.value_kind as keyof typeof OPERATORS_BY_KIND].join(", ");
      const opLine = `    valid operators: [${ops}]`;
      return [base, opLine].join("\n");
    })
    .join("\n");

  let prompt = `You are a rental application assistant. Given a landlord's instruction, your goal is to update the property's screening configuration.
You have the power to update: Data Fields, Interview Questions, Variables, Links, and AI Settings.

IMPORTANT GUIDELINES:
1. Identify what needs to change based on the prompt. Only return the arrays/objects that need modification.
2. For "newFields" and "questions", follow the strict schemas below.

--- FIELDS & QUESTIONS ---
- A question CAN collect multiple fields, max ${maxFieldsPerQuestion}.
- Every field ID in "fieldIds" MUST appear in EXISTING FIELDS or in your "newFields" output.
- When UPDATING an existing question, return its FULL fieldIds list AND all branches (existing plus any changes). When ADDING a new question, use a new id starting with "q_".
- Include old question ids in "deletedQuestionIds" if replacing/merging them.
- FLAT SCHEMA: No arrays/objects. Use numbered slots for multiple occupants (occupant_2_name, occupant_3_name). Occupant 1 is the applicant.
- Branches: outcomes can be "continue", "followups", "reject". Use "reject" branches to encode screening criteria directly on the question.

--- VARIABLES ---
- You can create or modify variables. Keep them flat. Return the full "variables" array if changing it.

--- AI SETTINGS & LINKS ---
- You can update AI behavior (offTopicLimit, etc) or links (videoUrl, bookingUrl). Only include what needs changing.

RETURN ONLY A VALID JSON OBJECT:
{
  "notesToUser": [
    "Note: Only include notes for important assumptions that require action, missing critical variables, or skipped checks.",
    "Do NOT explain implementation details or use verbose language."
  ],
  "newFields": [
    { "id": "snake_case_id", "label": "Human label", "value_kind": "text|number|boolean|date|enum", "options": ["only", "for", "enum"] }
  ],
  "questions": [
    { "id": "q_id", "text": "Question?", "fieldIds": ["field_id"], "branches": [
      { "condition": { "fieldId": "has_pets", "operator": "==", "value": "true" }, "outcome": "reject", "subQuestions": [] }
    ]}
  ],
  "deletedQuestionIds": [],
  "variables": [
    { "id": "min_income", "label": "Minimum Income", "value": "3000", "value_kind": "number" }
  ],
  "links": { "videoUrl": "...", "bookingUrl": "..." },
  "aiInstructions": { "rejectionPrompt": "..." }
}

If no changes are needed for a particular section, omit the key or return empty. Keep "notesToUser" concise: ONLY mention important assumptions that require user action, missing critical variables, or skipped checks that materially affect screening.

EXISTING STATE:
`;

  if (existingFields.length > 0) {
    prompt += `\nEXISTING FIELDS:\n${fieldDescriptions}\n`;
  }
  if (existingQuestions.length > 0) {
    prompt += `\nEXISTING QUESTIONS:\n${formatExistingQuestions(existingQuestions)}\n`;
  }
  if (variables.length > 0) {
    prompt += `\nEXISTING VARIABLES:\n${JSON.stringify(variables, null, 2)}\n`;
  }

  if (generationAttempt === 1) {
    prompt += `\n\nGENERATION ATTEMPT: 2 (retry). A previous pass referenced field IDs that were not in the schema; missing definitions were added to EXISTING FIELDS. Regenerate a complete, consistent proposal. Every "fieldIds" and "fieldId" must match EXISTING FIELDS or "newFields".`;
  }

  return prompt;
}

function buildRepairFieldsPrompt(missingIds: string[]): string {
  return `You are a rental application schema assistant. The generator referenced field IDs that are not yet defined.
Return ONLY valid JSON:
{ "newFields": [ { "id": "exact_snake_case_id", "label": "Human label", "value_kind": "text|number|boolean|date|enum", "options": ["only","for","enum"] } ] }

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
  ) return null;
  const value_kind = f.value_kind as LandlordField["value_kind"];
  if (!FIELD_VALUE_KINDS.includes(value_kind)) return null;

  const out: LandlordField = { id: f.id, label: f.label, value_kind };
  if (value_kind === "enum") {
    if (!Array.isArray(f.options)) return null;
    const rawOpts = f.options.filter((x) => typeof x === "string").map((x) => x as string);
    const options = normalizeEnumOptions(rawOpts);
    if (validateEnumOptions(options) !== null) return null;
    out.options = options;
  }
  return out;
}

function parseBranch(v: unknown): Branch | null {
  if (typeof v !== "object" || v === null) return null;
  const b = v as Record<string, unknown>;
  if (typeof b.condition !== "object" || b.condition === null) return null;
  const cond = b.condition as Record<string, unknown>;
  if (typeof cond.fieldId !== "string" || typeof cond.operator !== "string" || cond.value == null) return null;
  const outcome = typeof b.outcome === "string" ? b.outcome as BranchOutcome : null;
  if (!outcome || !VALID_OUTCOMES.includes(outcome)) return null;

  const subQuestions: Question[] = [];
  if (Array.isArray(b.subQuestions)) {
    for (const sq of b.subQuestions) {
      const parsed = parseGeneratedQuestion(sq);
      if (parsed) subQuestions.push(parsed);
    }
  }
  return {
    id: generateId(),
    condition: { fieldId: cond.fieldId, operator: cond.operator, value: String(cond.value).trim() },
    outcome,
    subQuestions,
  };
}

function parseGeneratedQuestion(v: unknown): Question | null {
  if (typeof v !== "object" || v === null) return null;
  const q = v as Record<string, unknown>;
  if (typeof q.id !== "string" || typeof q.text !== "string" || !q.text.trim()) return null;
  if (!Array.isArray(q.fieldIds) || q.fieldIds.length === 0) return null;
  const fieldIds = (q.fieldIds as unknown[]).filter((x): x is string => typeof x === "string");
  if (fieldIds.length === 0) return null;

  const branches: Branch[] = [];
  if (Array.isArray(q.branches)) {
    for (const b of q.branches) {
      const parsed = parseBranch(b);
      if (parsed) branches.push(parsed);
    }
  }
  return { id: q.id, text: q.text, fieldIds, sort_order: 0, branches };
}

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

function knownFieldIdSet(existingFields: { id: string }[], newFields: LandlordField[]): Set<string> {
  const s = new Set<string>();
  for (const f of existingFields) s.add(f.id);
  for (const f of newFields) s.add(f.id);
  return s;
}

function collectOrphanFieldIds(questions: Question[], known: Set<string>): string[] {
  const out = new Set<string>();
  function walk(q: Question) {
    for (const fid of q.fieldIds) if (!known.has(fid)) out.add(fid);
    for (const branch of q.branches) {
      if (!known.has(branch.condition.fieldId)) out.add(branch.condition.fieldId);
      for (const sq of branch.subQuestions) walk(sq);
    }
  }
  for (const q of questions) walk(q);
  return [...out];
}

async function callClaudeJson(key: string, system: string, user: string): Promise<unknown> {
  const response = await callClaude(key, { system, messages: [{ role: "user", content: user }], max_tokens: 4096 });
  const raw = extractText(response);
  const cleaned = stripCodeFences(raw);
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    return JSON.parse(repairJson(cleaned));
  }
}

export async function POST(req: Request) {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) return NextResponse.json({ error: "CLAUDE_API_KEY is not set" }, { status: 500 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const description = String(body.description || "").trim();
  if (!description) return NextResponse.json({ error: "Missing description" }, { status: 400 });

  const existingFields = Array.isArray(body.existingFields) ? body.existingFields : [];
  const existingQuestions = Array.isArray(body.existingQuestions) ? body.existingQuestions : [];
  const variables = Array.isArray(body.variables) ? body.variables : [];
  const links = typeof body.links === "object" ? body.links : {};
  const aiInstructions = typeof body.aiInstructions === "object" ? body.aiInstructions : {};

  try {
    const system0 = buildSystemPrompt(existingFields, existingQuestions, variables, links, aiInstructions, 3, 0);

    const generationPrompt = `${description}

Return the required JSON schema. Use the "notesToUser" array to note any important assumptions.`;

    let parsed0: any;
    try {
      parsed0 = await callClaudeJson(key, system0, generationPrompt);
    } catch {
      return NextResponse.json({ error: "AI returned invalid JSON" }, { status: 502 });
    }

    if (typeof parsed0 !== "object" || !parsed0) {
      return NextResponse.json({ error: "AI response was not an object" }, { status: 502 });
    }

    const parsePass = (obj: any) => {
      const notesToUser = Array.isArray(obj.notesToUser) ? obj.notesToUser.filter((x: any) => typeof x === "string") : [];
      const newFields = Array.isArray(obj.newFields) ? obj.newFields.map(parseGeneratedField).filter(Boolean) as LandlordField[] : [];
      const questions = Array.isArray(obj.questions) ? obj.questions.map(parseGeneratedQuestion).filter(Boolean) as Question[] : [];
      const deletedQuestionIds = Array.isArray(obj.deletedQuestionIds) ? obj.deletedQuestionIds : [];
      return { notesToUser, newFields, questions, deletedQuestionIds, variables: obj.variables, links: obj.links, aiInstructions: obj.aiInstructions };
    };

    let result = parsePass(parsed0);
    let known = knownFieldIdSet(existingFields, result.newFields);
    let orphans = collectOrphanFieldIds(result.questions, known);

    if (orphans.length > 0) {
      log("Repairing orphans:", orphans);
      const repairSystem = buildRepairFieldsPrompt(orphans);
      const repairContext = `Prompt: ${description}\nQuestions: ${JSON.stringify(result.questions)}`;
      const parsedRepair: any = await callClaudeJson(key, repairSystem, repairContext);

      const repairFields = Array.isArray(parsedRepair?.newFields) ? parsedRepair.newFields.map(parseGeneratedField).filter(Boolean) as LandlordField[] : [];

      const augmentedFields = [...existingFields, ...result.newFields, ...repairFields];
      const system1 = buildSystemPrompt(augmentedFields, existingQuestions, variables, links, aiInstructions, 3, 1);

      let parsed1: any;
      try {
        parsed1 = await callClaudeJson(key, system1, generationPrompt);
        const result1 = parsePass(parsed1);
        const known1 = knownFieldIdSet(augmentedFields, result1.newFields);
        const orphans1 = collectOrphanFieldIds(result1.questions, known1);
        if (orphans1.length === 0) {
          result = result1;
          result.newFields = [...result.newFields, ...repairFields, ...result1.newFields].filter((v,i,a)=>a.findIndex(t=>(t.id===v.id))===i);
        }
      } catch (err) {
        log("Retry failed, using base with repaired fields");
        result.newFields = [...result.newFields, ...repairFields];
      }
    }

    // Apply the same condition checks the FlowEditor enforces for users
    const allFields: LandlordField[] = [
      ...existingFields.map((f: any) => ({
        id: f.id,
        label: f.label,
        value_kind: f.value_kind as LandlordField["value_kind"],
        options: f.options,
      })),
      ...result.newFields,
    ];
    result.questions = sanitizeQuestions(
      result.questions,
      allFields,
      variables,
      (qid, bid, reason) => log(`dropped branch ${bid} on ${qid}: ${reason}`),
    );

    return NextResponse.json({ ok: true, ...result });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
