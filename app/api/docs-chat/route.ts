import { NextResponse } from "next/server";
import { callClaude, extractText, ClaudeApiError } from "@/lib/anthropic";
import { DOCS_FULL_TEXT } from "@/lib/docs-content";

const SYSTEM_PROMPT = `You are a helpful support assistant for RentScreen, an AI-powered tenant screening platform.

Answer the user's questions using only the documentation below. Be concise and direct. If the answer isn't in the docs, say so honestly and suggest they reach out to support.

Do not make up features or behaviors that aren't described. Do not use bullet points unless it genuinely helps clarity. Keep responses short — 2-4 sentences for simple questions, a short paragraph for complex ones.

---

${DOCS_FULL_TEXT}`;

type Message = { role: "user" | "assistant"; content: string };

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

  const rec = body as Record<string, unknown>;
  const messages: Message[] = Array.isArray(rec.messages) ? rec.messages as Message[] : [];

  if (messages.length === 0) {
    return NextResponse.json({ error: "No messages provided" }, { status: 400 });
  }

  try {
    const response = await callClaude(key, {
      system: SYSTEM_PROMPT,
      messages,
      max_tokens: 512,
    });
    return NextResponse.json({ reply: extractText(response) });
  } catch (err) {
    if (err instanceof ClaudeApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
