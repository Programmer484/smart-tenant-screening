import type { TestCase, AIQuestionOutput } from "./aiQuestionTestCases";
import { evaluateOutput, type EvaluationResult } from "./evaluator";

export type TestResult = {
  testId: string;
  testName: string;
  success: boolean; // True if generation succeeded AND evaluation passed
  error?: string; // If an exception was thrown
  evaluation?: EvaluationResult;
  output?: AIQuestionOutput;
};

export interface OutputProvider {
  name: string;
  generate(testCase: TestCase): Promise<AIQuestionOutput>;
}

export class MockOutputProvider implements OutputProvider {
  name = "MockOutputProvider";

  async generate(testCase: TestCase): Promise<AIQuestionOutput> {
    // In a mock provider, we just return the predefined mock output
    return testCase.mockOutput;
  }
}

import { POST as generateFields, buildSystemPrompt } from "@/app/api/generate-fields/route";
import { POST as clarifyPrompt } from "@/app/api/clarify-prompt/route";

// Stub for the real generation provider
export class RealGenerationOutputProvider implements OutputProvider {
  name = "RealGenerationOutputProvider";

  async generate(testCase: TestCase): Promise<AIQuestionOutput> {
    let prompt = testCase.prompt;
    if (testCase.variables) {
      for (const [k, v] of Object.entries(testCase.variables)) {
        prompt = prompt.replace(new RegExp(`{{${k}}}`, "g"), v);
      }
    }

    const sharedBody = {
      existingFields: testCase.existingFields ?? [],
      existingQuestions: testCase.existingQuestions ?? [],
      variables: testCase.propertyVariables ?? [],
    };

    // Phase 1: clarify (mirrors the property page UI flow). Fail-soft on error.
    let clarifyingQuestionsAsked: string[] = [];
    try {
      const clarifyReq = new Request("http://localhost/api/clarify-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: prompt, ...sharedBody }),
      });
      const clarifyRes = await clarifyPrompt(clarifyReq);
      const clarifyData = await clarifyRes.json();
      if (Array.isArray(clarifyData.questions)) {
        clarifyingQuestionsAsked = clarifyData.questions.filter((x: unknown): x is string => typeof x === "string");
      }
    } catch {
      // ignore — proceed to generate with the original prompt
    }

    const clarifyingAnswersUsed: string[] = [];
    let augmentedDescription = prompt;
    if (clarifyingQuestionsAsked.length > 0) {
      const supplied = testCase.clarifyAnswers ?? [];
      const qaPairs = clarifyingQuestionsAsked
        .map((q, i) => {
          const a = (supplied[i] ?? "").trim();
          clarifyingAnswersUsed.push(a);
          return { q, a };
        })
        .filter((qa) => qa.a.length > 0);
      if (qaPairs.length > 0) {
        augmentedDescription += `\n\nAdditional context (clarifying answers):\n${qaPairs.map((qa) => `Q: ${qa.q}\nA: ${qa.a}`).join("\n\n")}`;
      }
    }

    // Phase 2: generate.
    const req = new Request("http://localhost/api/generate-fields", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: augmentedDescription, ...sharedBody }),
    });

    const res = await generateFields(req);
    const data = await res.json();

    if (data.error) {
      throw new Error(data.error);
    }

    return {
      newFields: data.newFields,
      questions: data.questions,
      deletedQuestionIds: data.deletedQuestionIds,
      prompts: {
        // Mirror the actual context sent on attempt 0 so the preview matches what the AI saw.
        // Note: max-fields-per-question matches DEFAULT_MAX_FIELDS_PER_QUESTION in the route.
        system: buildSystemPrompt(
          (testCase.existingFields ?? []).map((f) => ({ id: f.id, label: f.label, value_kind: f.value_kind as string })),
          testCase.existingQuestions ?? [],
          3,
          0,
          testCase.propertyVariables ?? [],
        ),
        user: augmentedDescription,
      },
      clarifyingQuestionsAsked: clarifyingQuestionsAsked.length > 0 ? clarifyingQuestionsAsked : undefined,
      clarifyingAnswersUsed: clarifyingQuestionsAsked.length > 0 ? clarifyingAnswersUsed : undefined,
    };
  }
}

export async function runTests(
  apiKey: string,
  testCases: TestCase[],
  provider: OutputProvider,
  onProgress?: (index: number, total: number, testName: string) => void
): Promise<TestResult[]> {
  const results: TestResult[] = [];

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    if (onProgress) {
      onProgress(i, testCases.length, testCase.name);
    }

    try {
      // 1. Generate Output
      const output = await provider.generate(testCase);

      // 2. Evaluate Output
      const evaluation = await evaluateOutput(apiKey, testCase, output);

      results.push({
        testId: testCase.id,
        testName: testCase.name,
        success: evaluation.pass,
        evaluation,
        output,
      });
    } catch (error) {
      results.push({
        testId: testCase.id,
        testName: testCase.name,
        success: false,
        error: (error as Error).message,
      });
    }
  }

  return results;
}
