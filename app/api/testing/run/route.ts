import { NextResponse } from "next/server";
import { testCases } from "@/lib/testing/aiQuestionTestCases";
import { runTests, MockOutputProvider, RealGenerationOutputProvider } from "@/lib/testing/runner";

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

  let testsToRun = testCases;
  if (selectedIds.length > 0) {
    testsToRun = testCases.filter((t) => selectedIds.includes(t.id));
  }

  if (testsToRun.length === 0) {
    return NextResponse.json({ error: "No tests found to run" }, { status: 400 });
  }

  const provider = rec.useRealAI ? new RealGenerationOutputProvider() : new MockOutputProvider();

  try {
    const results = await runTests(apiKey, testsToRun, provider);
    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function GET() {
  // Return the list of available tests
  const tests = testCases.map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    prompt: t.prompt,
    requirements: t.requirements,
  }));
  return NextResponse.json({ tests });
}
