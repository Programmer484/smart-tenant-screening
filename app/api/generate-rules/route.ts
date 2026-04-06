import { NextResponse } from "next/server";
import type { LandlordField } from "@/lib/landlord-field";
import {
  type LandlordRule,
  OPERATORS_BY_KIND,
  validateRule,
} from "@/lib/landlord-rule";
import { callClaude, ClaudeApiError, extractText, stripCodeFences } from "@/lib/anthropic";

function buildSystemPrompt(fields: LandlordField[]): string {
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

  return `You are a rental application assistant. Given a property description and a list of applicant fields, generate eligibility rules the landlord wants to enforce.

Each rule is a check that an applicant must pass. If any rule fails, the applicant is rejected.

Return ONLY a valid JSON array — no explanation, no markdown, no code fences. Each element must have:
  - "fieldId": must be one of the field ids listed below (copy exactly)
  - "operator": must be one of the valid operators for that field
  - "value": must satisfy the value constraints for that field

Available fields:
${fieldDescriptions}

STRICT RULES:
- ONLY generate rules for constraints explicitly stated in the property description (e.g. "no pets", "minimum income $3000", "no smoking").
- Do NOT invent or assume constraints that are not mentioned. If the description doesn't set a threshold, don't create one.
- You may generate multiple rules for the same field if the description specifies a range (e.g. income >= X and income <= Y).
- Return an empty array [] if the description contains no explicit eligibility constraints.

Example output:
[
  { "fieldId": "monthly_income", "operator": ">=", "value": "4500" },
  { "fieldId": "has_pets", "operator": "==", "value": "false" }
]`;
}

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

function parseGeneratedRule(
  v: unknown,
  fields: LandlordField[],
): LandlordRule | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  if (
    typeof r.fieldId !== "string" ||
    typeof r.operator !== "string" ||
    typeof r.value !== "string"
  ) {
    return null;
  }
  const rule: LandlordRule = {
    id: generateId(),
    action: "reject",
    conditions: [{
      id: generateId(),
      fieldId: r.fieldId,
      operator: r.operator,
      value: r.value,
    }]
  };
  if (validateRule(rule, fields) !== null) return null;
  return rule;
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

  try {
    const response = await callClaude(key, {
      system: buildSystemPrompt(fields),
      messages: [{ role: "user", content: description }],
    });

    const raw = extractText(response);
    const cleaned = stripCodeFences(raw);

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ error: "AI returned invalid JSON", raw: cleaned }, { status: 502 });
    }

    if (!Array.isArray(parsed)) {
      return NextResponse.json({ error: "AI response was not an array", raw: cleaned }, { status: 502 });
    }

    const rules = parsed
      .map((v) => parseGeneratedRule(v, fields))
      .filter((r): r is LandlordRule => r !== null);

    return NextResponse.json({ rules });
  } catch (err) {
    if (err instanceof ClaudeApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
