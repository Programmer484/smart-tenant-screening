import { NextResponse } from "next/server";
import { callClaude, ClaudeApiError, extractText, stripCodeFences } from "@/lib/anthropic";
import type { PropertyVariable } from "@/lib/property";

const SYSTEM_PROMPT = `You help a landlord plan their rental application questions.

Look at the landlord's prompt (under "PROMPT"). They want another assistant to generate fields and screening questions from it. Your job RIGHT NOW is NOT to generate anything — only to decide whether the prompt has enough context to produce a strong schema.

If the prompt is already specific (clear thresholds, dates, allowed/disallowed values, max counts, what happens on edge cases), return an EMPTY questions array.

If anything important is ambiguous, return up to 4 SHORT clarifying questions. Each must be one whose answer would meaningfully change the generated schema. Good clarifications:
- "What is the unit's availability date?"
- "What income threshold should trigger a co-signer?"
- "How many occupants are allowed at most?"
- "If the applicant smokes, should that reject them or flag for review?"

Rules:
- Don't ask about anything already defined in EXISTING FIELDS, EXISTING QUESTIONS, or PROPERTY VARIABLES.
- Don't ask vague open-ended questions ("anything else?").
- Don't ask follow-ups the next agent could reasonably default — only ones with real schema impact.
- When in doubt, prefer fewer or zero questions. Friction has a cost.

Output ONLY valid JSON, no code fences, no commentary:
{"questions": ["...", "..."]}`;

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

  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const description = typeof rec.description === "string" ? rec.description.trim() : "";
  if (!description) {
    return NextResponse.json({ error: "Missing description" }, { status: 400 });
  }

  const existingFields = Array.isArray(rec.existingFields)
    ? (rec.existingFields as { id: string; label: string; value_kind: string }[])
    : [];
  const existingQuestions = Array.isArray(rec.existingQuestions)
    ? (rec.existingQuestions as { id: string; text: string; fieldIds: string[] }[])
    : [];
  const variables = Array.isArray(rec.variables) ? (rec.variables as PropertyVariable[]) : [];

  let userPrompt = `PROMPT:\n${description}`;
  if (existingFields.length) {
    userPrompt += `\n\nEXISTING FIELDS:\n${existingFields.map(f => `- ${f.id} (${f.value_kind}): ${f.label}`).join("\n")}`;
  }
  if (existingQuestions.length) {
    userPrompt += `\n\nEXISTING QUESTIONS:\n${existingQuestions.map(q => `- ${q.id}: ${q.text}`).join("\n")}`;
  }
  if (variables.length) {
    userPrompt += `\n\nPROPERTY VARIABLES:\n${variables.map(v => `- {{${v.id}}} (${v.value_kind ?? "text"}) = ${v.value}`).join("\n")}`;
  }

  try {
    const response = await callClaude(key, {
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      max_tokens: 512,
    });
    const raw = extractText(response);
    const cleaned = stripCodeFences(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ questions: [] });
    }
    if (typeof parsed !== "object" || parsed === null) {
      return NextResponse.json({ questions: [] });
    }
    const arr = (parsed as Record<string, unknown>).questions;
    const questions = Array.isArray(arr)
      ? arr.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 4)
      : [];
    return NextResponse.json({ questions });
  } catch (err) {
    if (err instanceof ClaudeApiError) {
      return NextResponse.json({ questions: [] });
    }
    return NextResponse.json({ questions: [] });
  }
}
