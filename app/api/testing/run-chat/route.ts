import { NextResponse } from "next/server";
import { chatTestCases } from "@/lib/testing/chatTestCases";
import { runChatTests } from "@/lib/testing/chatRunner";

export async function POST(req: Request) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "CLAUDE_API_KEY is not set" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rec = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const selectedIds = Array.isArray(rec.testIds) ? rec.testIds : [];

  let testsToRun = chatTestCases;
  if (selectedIds.length > 0) {
    testsToRun = chatTestCases.filter((t) => selectedIds.includes(t.id));
  }

  if (testsToRun.length === 0) {
    return NextResponse.json({ error: "No tests found to run" }, { status: 400 });
  }

  try {
    const results = await runChatTests(apiKey, testsToRun);
    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function GET() {
  const tests = chatTestCases.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    property: t.property,
    initialAnswers: t.initialAnswers,
    initialMessages: t.initialMessages,
    userMessages: t.userMessages,
    requirements: t.requirements,
  }));
  return NextResponse.json({ tests });
}
