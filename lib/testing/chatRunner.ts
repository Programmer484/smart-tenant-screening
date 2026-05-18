import type { ChatTestCase } from "./chatTestCases";
import { evaluateChatTranscript, type EvaluationResult } from "./evaluator";
import { POST as chatRoute } from "@/app/api/chat/route";

export type ChatTurnResult = {
  userMessage: string;
  assistantReply: string;
  extracted: { fieldId: string; value: string }[];
  sessionStatus: string;
  debugInfo?: unknown;
};

export type ChatTestResult = {
  testId: string;
  testName: string;
  /** True if all turns ran without error AND the evaluator passes. */
  success: boolean;
  error?: string;
  evaluation?: EvaluationResult;
  turns?: ChatTurnResult[];
  /** Final answers state after all turns. */
  finalAnswers?: Record<string, string>;
};

type ChatRouteResponse = {
  error?: string;
  reply?: string;
  extracted?: unknown;
  sessionStatus?: string;
  debugInfo?: unknown;
};

function isExtraction(value: unknown): value is { fieldId: string; value: string } {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.fieldId === "string" && typeof item.value === "string";
}

function buildBody(
  testCase: ChatTestCase,
  answers: Record<string, string>,
  messages: { role: "user" | "assistant"; content: string }[],
) {
  const p = testCase.property;
  return {
    title: p.title ?? "Test Property",
    description: p.description ?? "",
    fields: p.fields,
    questions: p.questions,
    variables: p.variables ?? [],
    aiInstructions: p.aiInstructions ?? {},
    answers,
    messages,
    // intentionally NO sessionId / propertyId — the chat route stays in-memory
  };
}

export async function runChatTest(
  apiKey: string,
  testCase: ChatTestCase,
): Promise<ChatTestResult> {
  const turns: ChatTurnResult[] = [];
  const answers: Record<string, string> = { ...(testCase.initialAnswers ?? {}) };
  const messages: { role: "user" | "assistant"; content: string }[] = [
    ...(testCase.initialMessages ?? []),
  ];

  try {
    for (const userMsg of testCase.userMessages) {
      const turnMessages = [...messages, { role: "user" as const, content: userMsg }];
      const body = buildBody(testCase, answers, turnMessages);

      const req = new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const res = await chatRoute(req);
      const data = (await res.json()) as ChatRouteResponse;

      if (data.error) {
        throw new Error(data.error);
      }

      const reply = typeof data.reply === "string" ? data.reply : "";
      const extracted: { fieldId: string; value: string }[] = Array.isArray(data.extracted)
        ? data.extracted.filter(isExtraction)
        : [];
      const sessionStatus = typeof data.sessionStatus === "string" ? data.sessionStatus : "unknown";

      // Update running state
      for (const ex of extracted) answers[ex.fieldId] = ex.value;
      messages.push({ role: "user", content: userMsg });
      messages.push({ role: "assistant", content: reply });

      turns.push({
        userMessage: userMsg,
        assistantReply: reply,
        extracted,
        sessionStatus,
        debugInfo: data.debugInfo,
      });
    }

    const evaluation = await evaluateChatTranscript(apiKey, testCase, turns, answers);

    return {
      testId: testCase.id,
      testName: testCase.name,
      success: evaluation.pass,
      evaluation,
      turns,
      finalAnswers: answers,
    };
  } catch (err) {
    return {
      testId: testCase.id,
      testName: testCase.name,
      success: false,
      error: (err as Error).message,
      turns,
      finalAnswers: answers,
    };
  }
}

export async function runChatTests(
  apiKey: string,
  testCases: ChatTestCase[],
  onProgress?: (index: number, total: number, name: string) => void,
): Promise<ChatTestResult[]> {
  const results: ChatTestResult[] = [];
  for (let i = 0; i < testCases.length; i++) {
    onProgress?.(i, testCases.length, testCases[i].name);
    results.push(await runChatTest(apiKey, testCases[i]));
  }
  return results;
}
