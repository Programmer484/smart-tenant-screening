import { NextResponse } from "next/server";
import { callClaude, extractText, ClaudeApiError } from "@/lib/anthropic";
import type { LandlordField } from "@/lib/landlord-field";
import type { Question } from "@/lib/question";

function buildSystemPrompt(
  title: string,
  description: string,
  fields: LandlordField[],
  questions: Question[],
): string {
  const fieldList = fields
    .map((f) => {
      let line = `  - ${f.id} (${f.value_kind}): "${f.label}"`;
      if (f.options?.length) line += ` — options: [${f.options.join(", ")}]`;
      return line;
    })
    .join("\n");

  const questionList = [...questions]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((q, i) => `  ${i + 1}. "${q.text}" → collects: [${q.fieldIds.join(", ")}]`)
    .join("\n");

  return `You are generating a simulated tenant screening conversation for testing purposes.

PROPERTY: ${title}
${description}

FIELDS TO COLLECT:
${fieldList || "  None."}

SCREENING QUESTIONS (in order):
${questionList || "  None."}

Your job:
1. Generate a realistic back-and-forth conversation between a screening AI and a tenant applicant that matches the described scenario.
2. Also output the field values that would be extracted from the conversation.

Return ONLY valid JSON in this exact shape, with no markdown fences:
{
  "messages": [
    {"role": "assistant", "content": "..."},
    {"role": "user", "content": "..."}
  ],
  "answers": {
    "field_id": "value"
  }
}

Rules for the JSON output:
- Start with the assistant greeting
- The conversation should naturally cover all screening questions
- Tenant answers should match the scenario described by the user
- Field values must use the correct type (numbers as numeric strings, booleans as "true"/"false", dates as YYYY-MM-DD, enums must match one of the listed options exactly)
- Only include fields that were actually answered in the conversation
- Keep the conversation natural and concise — 6 to 12 message pairs is ideal`;
}

export async function POST(req: Request) {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) return NextResponse.json({ error: "CLAUDE_API_KEY is not set" }, { status: 500 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rec = body as Record<string, unknown>;
  const scenario    = typeof rec.scenario === "string" ? rec.scenario.trim() : "";
  const title       = typeof rec.title === "string" ? rec.title.trim() : "Rental Property";
  const description = typeof rec.description === "string" ? rec.description.trim() : "";
  const fields      = Array.isArray(rec.fields) ? (rec.fields as LandlordField[]) : [];
  const questions   = Array.isArray(rec.questions) ? (rec.questions as Question[]).map((q) => ({ ...q, branches: q.branches ?? [] })) : [];

  if (!scenario) return NextResponse.json({ error: "scenario is required" }, { status: 400 });

  const system = buildSystemPrompt(title, description, fields, questions);
  const userPrompt = `Generate a test conversation for this scenario: ${scenario}`;

  let raw: string;
  try {
    const res = await callClaude(key, {
      system,
      messages: [{ role: "user", content: userPrompt }],
      max_tokens: 2048,
    });
    raw = extractText(res);
  } catch (err) {
    if (err instanceof ClaudeApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }

  let parsed: { messages: { role: string; content: string }[]; answers: Record<string, string> };
  try {
    const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    parsed = JSON.parse(clean);
  } catch {
    return NextResponse.json({ error: "AI returned invalid JSON", raw }, { status: 502 });
  }

  const messages = (parsed.messages ?? []).map((m) => ({
    role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
    content: String(m.content ?? ""),
  }));
  const answers = (parsed.answers ?? {}) as Record<string, string>;

  const outcome: "qualified" | "in_progress" =
    fields.length > 0 && Object.keys(answers).length >= fields.length * 0.8
      ? "qualified"
      : "in_progress";

  return NextResponse.json({ messages, answers, outcome });
}
