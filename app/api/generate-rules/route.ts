import { NextResponse } from "next/server";
import { FIELD_VALUE_KINDS, type LandlordField } from "@/lib/landlord-field";
import {
  type LandlordRule,
  normalizeRulesList,
  OPERATORS_BY_KIND,
  validateRule,
} from "@/lib/landlord-rule";
import { callClaude, ClaudeApiError, extractToolUse } from "@/lib/anthropic";

const FIELD_INPUT_SCHEMA = {
  type: "object",
  properties: {
    id: {
      type: "string",
      pattern: "^[a-z][a-z0-9_]*$",
      description: "snake_case identifier; must start with a letter",
    },
    label: { type: "string" },
    value_kind: { type: "string", enum: [...FIELD_VALUE_KINDS] },
    options: { type: "array", items: { type: "string" } },
  },
  required: ["id", "label", "value_kind"],
} as const;

const CONDITION_INPUT_SCHEMA = {
  type: "object",
  properties: {
    fieldId: { type: "string" },
    operator: { type: "string" },
    value: {
      type: "string",
      description: "Boolean values must be the literal strings 'true' or 'false'",
    },
  },
  required: ["fieldId", "operator"],
} as const;

const NEW_RULE_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["reject", "require"] },
    conditions: {
      type: "array",
      minItems: 1,
      items: CONDITION_INPUT_SCHEMA,
    },
  },
  required: ["kind", "conditions"],
} as const;

const MODIFIED_RULE_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", description: "Existing rule id from EXISTING RULES" },
    kind: { type: "string", enum: ["reject", "require"] },
    conditions: {
      type: "array",
      minItems: 1,
      items: CONDITION_INPUT_SCHEMA,
    },
  },
  required: ["id", "kind", "conditions"],
} as const;

const PROPOSE_TOOL = {
  name: "propose_rules",
  description:
    "Submit screening rule additions, modifications, deletions, and any newly required schema fields.",
  input_schema: {
    type: "object",
    properties: {
      newRules: { type: "array", items: NEW_RULE_SCHEMA },
      modifiedRules: { type: "array", items: MODIFIED_RULE_SCHEMA },
      deletedRuleIds: { type: "array", items: { type: "string" } },
      newFields: {
        type: "array",
        items: FIELD_INPUT_SCHEMA,
        description: "Fields the rules need that are not yet in Available fields",
      },
    },
    required: ["newRules", "modifiedRules", "deletedRuleIds", "newFields"],
  },
} as const;

function buildSystemPrompt(fields: LandlordField[], existingRules: LandlordRule[]): string {
  const fieldDescriptions = fields
    .filter((f) => {
      if (!OPERATORS_BY_KIND[f.value_kind]) {
        console.warn(`[generate-rules] skipping field "${f.id}" with unknown value_kind "${f.value_kind}"`);
        return false;
      }
      return true;
    })
    .map((f) => {
      const base = `  - id: "${f.id}", value_kind: "${f.value_kind}", label: "${f.label}"`;
      const ops = OPERATORS_BY_KIND[f.value_kind].join(", ");
      const opLine = `    valid operators: [${ops}]`;
      const valLine =
        f.value_kind === "boolean"
          ? `    valid values: "true" or "false"`
          : f.value_kind === "enum" && f.options?.length
            ? `    valid values: ${JSON.stringify(f.options)}`
            : f.value_kind === "number"
              ? `    valid values: numeric strings e.g. "3000"`
              : f.value_kind === "date"
                ? `    valid values: ISO date strings e.g. "2025-01-01"`
                : `    valid values: any string`;
      return [base, opLine, valLine].join("\n");
    })
    .join("\n");

  let existingBlock = "";
  if (existingRules.length > 0) {
    existingBlock = `\n\nEXISTING RULES (You may modify or delete these if the prompt explicitly asks for it):\n${JSON.stringify(existingRules, null, 2)}`;
  }

  return `You are a rental application assistant. Given a property description and a list of applicant fields, generate screening rules.

You MUST respond by calling the "${PROPOSE_TOOL.name}" tool. Do not write any prose; the tool input is the entire response.

There are two types of rules:
1. "reject" — instant rejection. If the condition evaluates to true, the applicant is rejected.
   Example: reject if smoking == true, reject if monthly_income < 3000.
2. "require" — acceptance profile. The applicant must match AT LEAST ONE "require" rule to pass.
   Use these for complex eligibility criteria where multiple valid profiles exist.

Tool input fields:
- "newRules": new rule objects. Each has "kind" ("reject" | "require") and "conditions" (each with "fieldId", "operator", "value").
- "modifiedRules": updated rule objects. MUST include the original "id" from EXISTING RULES, plus updated "kind" and "conditions".
- "deletedRuleIds": IDs of EXISTING RULES to completely remove, if requested.
- "newFields": fields you NEED for the rules but which are NOT in Available fields. First pick the natural human-facing label, then derive a snake_case id. Only include fields that are actually missing.

Available fields:
${fieldDescriptions}
${existingBlock}

STRICT RULES:
- ONLY generate rules for constraints explicitly stated in the property description.
- Do NOT invent or assume constraints that are not mentioned.
- If a rule requires a field that doesn't exist yet, add it to "newFields" and STILL include the rule (it will be validated separately).
- Do NOT duplicate any existing rules listed above.
- If no changes are needed, call the tool with all four arrays empty.`;
}

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

function parseGeneratedRule(
  v: unknown,
  fields: LandlordField[],
  allowMissingFields = false,
): LandlordRule | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;

  const kindRaw = r.kind ?? r.action;
  if (kindRaw !== "reject" && kindRaw !== "require") return null;
  const kind = kindRaw as LandlordRule["kind"];

  if (Array.isArray(r.conditions)) {
    const conditions = r.conditions
      .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
      .map((c) => {
        if (typeof c.fieldId !== "string" || typeof c.operator !== "string" || c.value == null) return null;
        return { id: generateId(), fieldId: c.fieldId, operator: c.operator, value: String(c.value) };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    if (conditions.length === 0) return null;

    const rule: LandlordRule = { id: typeof r.id === "string" ? r.id : generateId(), kind, conditions };
    // Only validate against existing fields
    if (!allowMissingFields && validateRule(rule, fields) !== null) return null;
    return rule;
  }

  if (typeof r.fieldId === "string" && typeof r.operator === "string" && r.value != null) {
    const rule: LandlordRule = {
      id: typeof r.id === "string" ? r.id : generateId(),
      kind,
      conditions: [{
        id: generateId(),
        fieldId: r.fieldId,
        operator: r.operator,
        value: String(r.value),
      }]
    };
    if (!allowMissingFields && validateRule(rule, fields) !== null) return null;
    return rule;
  }

  return null;
}

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

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const rec = body as Record<string, unknown>;

  const description =
    typeof rec.description === "string" ? rec.description.trim() : "";
  if (!description) {
    return NextResponse.json({ error: "Missing description" }, { status: 400 });
  }

  if (!Array.isArray(rec.fields) || rec.fields.length === 0) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  const fields = rec.fields as LandlordField[];

  const existingRules: LandlordRule[] = Array.isArray(rec.existingRules)
    ? normalizeRulesList(rec.existingRules)
    : [];

  try {
    const first = await callProposeRulesTool(key, fields, existingRules, description);

    const newRulesArray = first.newRules;
    const modifiedRulesArray = first.modifiedRules;
    const deletedRuleIds = first.deletedRuleIds;
    const missingFields = first.newFields;

    // If the first call announced new fields, re-call with the augmented field
    // list so it can use them in conditions with full operator/value validation.
    if (missingFields.length > 0) {
      const augmentedFields: LandlordField[] = [
        ...fields,
        ...missingFields.map((mf) => ({
          id: mf.id,
          label: mf.label,
          value_kind: mf.value_kind,
        } as LandlordField)),
      ];

      try {
        const second = await callProposeRulesTool(key, augmentedFields, existingRules, description);
        const newRules = second.newRules
          .map((v) => parseGeneratedRule(v, augmentedFields, false))
          .filter((r): r is LandlordRule => r !== null);
        const modifiedRules = second.modifiedRules
          .map((v) => parseGeneratedRule(v, augmentedFields, false))
          .filter((r): r is LandlordRule => r !== null);
        return NextResponse.json({
          newRules,
          modifiedRules,
          deletedRuleIds: second.deletedRuleIds.length > 0 ? second.deletedRuleIds : deletedRuleIds,
          newFields: missingFields,
        });
      } catch {
        // If the second call fails, fall back to first-call rules (allow missing fields).
        const newRules = newRulesArray.map((v) => parseGeneratedRule(v, fields, true)).filter((r): r is LandlordRule => r !== null);
        const modifiedRules = modifiedRulesArray.map((v) => parseGeneratedRule(v, fields, true)).filter((r): r is LandlordRule => r !== null);
        return NextResponse.json({ newRules, modifiedRules, deletedRuleIds, newFields: missingFields });
      }
    }

    const newRules = newRulesArray
      .map((v) => parseGeneratedRule(v, fields, false))
      .filter((r): r is LandlordRule => r !== null);
    const modifiedRules = modifiedRulesArray
      .map((v) => parseGeneratedRule(v, fields, false))
      .filter((r): r is LandlordRule => r !== null);

    return NextResponse.json({ newRules, modifiedRules, deletedRuleIds, newFields: missingFields });
  } catch (err) {
    if (err instanceof ClaudeApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

type ProposeRulesToolInput = {
  newRules: unknown[];
  modifiedRules: unknown[];
  deletedRuleIds: string[];
  newFields: { id: string; label: string; value_kind: string }[];
};

async function callProposeRulesTool(
  key: string,
  fields: LandlordField[],
  existingRules: LandlordRule[],
  description: string,
): Promise<ProposeRulesToolInput> {
  const response = await callClaude(key, {
    system: buildSystemPrompt(fields, existingRules),
    messages: [{ role: "user", content: description }],
    tools: [PROPOSE_TOOL as unknown as { name: string; description: string; input_schema: Record<string, unknown> }],
    tool_choice: { type: "tool", name: PROPOSE_TOOL.name },
  });

  const input = extractToolUse<Record<string, unknown>>(response, PROPOSE_TOOL.name);
  if (!input) {
    throw new ClaudeApiError(`Model did not invoke ${PROPOSE_TOOL.name} tool`, 502);
  }

  return {
    newRules: Array.isArray(input.newRules) ? input.newRules : [],
    modifiedRules: Array.isArray(input.modifiedRules) ? input.modifiedRules : [],
    deletedRuleIds: Array.isArray(input.deletedRuleIds)
      ? input.deletedRuleIds.filter((x): x is string => typeof x === "string")
      : [],
    newFields: Array.isArray(input.newFields)
      ? (input.newFields as unknown[]).filter(
          (x): x is { id: string; label: string; value_kind: string } => {
            if (typeof x !== "object" || x === null) return false;
            const o = x as Record<string, unknown>;
            return (
              typeof o.id === "string" &&
              typeof o.label === "string" &&
              typeof o.value_kind === "string"
            );
          },
        )
      : [],
  };
}
