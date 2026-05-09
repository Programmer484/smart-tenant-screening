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

    const req = new Request("http://localhost/api/generate-fields", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: prompt,
        existingFields: testCase.existingFields ?? [],
        existingQuestions: testCase.existingQuestions ?? [],
        variables: testCase.propertyVariables ?? [],
      }),
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
        system: buildSystemPrompt([], [], 3, 0),
        user: prompt,
      },
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
