import { callClaude, extractText, stripCodeFences } from "@/lib/anthropic";
import type { TestCase, AIQuestionOutput } from "./aiQuestionTestCases";

export type EvaluationResult = {
  pass: boolean;
  score: number;
  summary: string;
  passedRequirements: string[];
  failedRequirements: string[];
  concerns: string[];
  suggestedFixes: string[];
};

const SYSTEM_PROMPT = `You are an expert AI evaluator for a rental application question generation system.
Your job is to strictly evaluate the output of the generation system against a set of explicit requirements.

You will be given:
1. Test Case Name
2. Description & Prompt (context for what was asked)
3. Existing Fields & Questions (the pre-existing schema before generation — may be empty)
4. Requirements (the strict criteria the output MUST meet)
5. Generated Output (JSON object containing proposed fields, questions, rules, etc.)

Instructions:
- Carefully evaluate the Generated Output against EACH Requirement.
- Be strict about the Requirements. If a requirement says "Must collect a boolean field", check the value_kind in the output.
- Be lenient about exact wording if the meaning is intact, UNLESS the requirement specifies exact wording.
- Evaluate whether the output satisfies the core intent and all requirements.
- Calculate a score from 0 to 100. 100 means all requirements met perfectly. 0 means none met.

Do NOT raise concerns about:
- A field being re-declared in newFields that already appears in the existing schema. The generator receives existing context and should avoid redeclaring, but this is not a requirement failure.
- Value type formatting differences (e.g. "true" vs true, "3000" vs 3000) — as long as the value is semantically correct for the condition, treat it as passing.

DO raise concerns about:
- Genuine redundancy: e.g. asking the same information twice (in a top-level question text AND again in a sub-question), or duplicate fields capturing the same data under different names.
- Structural issues that would break the interview flow.

Return your evaluation ONLY as a valid JSON object matching this schema. Do not include markdown formatting or explanations outside the JSON.
{
  "pass": boolean, // true if ALL requirements are passed, false otherwise
  "score": number, // 0-100
  "summary": string, // short overall explanation
  "passedRequirements": string[], // list of requirements that passed
  "failedRequirements": string[], // list of requirements that failed
  "concerns": string[], // genuine concerns (redundancy, structural issues) — not formatting or redeclaration
  "suggestedFixes": string[] // what the generator should have done instead
}`;

export async function evaluateOutput(
  apiKey: string,
  testCase: TestCase,
  output: AIQuestionOutput
): Promise<EvaluationResult> {
  const variablesBlock = testCase.variables
    ? `\nVariables Context:\n${Object.entries(testCase.variables).map(([k, v]) => `- {{${k}}}: ${v}`).join("\n")}\n`
    : "";

  const existingBlock = (testCase.existingFields?.length || testCase.existingQuestions?.length)
    ? `\nExisting Schema (pre-generation state):\nFields: ${JSON.stringify(testCase.existingFields ?? [])}\nQuestions: ${JSON.stringify(testCase.existingQuestions ?? [])}\n`
    : "\nExisting Schema: (none — generating from scratch)\n";

  const userPrompt = `Test Case Name: ${testCase.name}

Description: ${testCase.description}

Prompt (User Intent): ${testCase.prompt}
${variablesBlock}${existingBlock}
Requirements:
${testCase.requirements.map(r => `- ${r}`).join("\n")}

Generated Output:
${JSON.stringify(output, null, 2)}
`;

  const response = await callClaude(apiKey, {
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
    max_tokens: 1024,
  });

  const raw = extractText(response);
  const cleaned = stripCodeFences(raw);

  try {
    const parsed = JSON.parse(cleaned) as EvaluationResult;
    return {
      pass: !!parsed.pass,
      score: typeof parsed.score === "number" ? parsed.score : 0,
      summary: parsed.summary || "No summary provided",
      passedRequirements: Array.isArray(parsed.passedRequirements) ? parsed.passedRequirements : [],
      failedRequirements: Array.isArray(parsed.failedRequirements) ? parsed.failedRequirements : [],
      concerns: Array.isArray(parsed.concerns) ? parsed.concerns : [],
      suggestedFixes: Array.isArray(parsed.suggestedFixes) ? parsed.suggestedFixes : [],
    };
  } catch (error) {
    throw new Error(`Evaluator returned invalid JSON: ${cleaned}\n\nError: ${(error as Error).message}`);
  }
}
