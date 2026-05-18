import { callClaude, extractText, stripCodeFences } from "@/lib/anthropic";
import type { TestCase, AIQuestionOutput } from "./aiQuestionTestCases";
import type { ChatTestCase } from "./chatTestCases";

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

## Data model notes — read carefully before evaluating

**Operators:** Branch conditions use raw operator symbols in the JSON: "==", "!=", ">", ">=", "<", "<=".
- Boolean fields support both "==" and "!=" operators. "has_pets == true" and "has_pets != false" are equivalent and both valid.
- Number fields support all six operators.
- Date fields support all six operators.
- Text/enum fields support "==" and "!=" only.

**Variable expressions in condition values:** The condition \`value\` field may be a variable expression instead of a plain literal. Valid formats:
- \`{{key}}\` — resolves to the current value of that variable
- \`{{key}} + N\` — variable value plus N days (for date fields) or plus N (for number fields)
- \`{{key}} - N\` — variable value minus N days (for date fields) or minus N (for number fields)
- \`{{key1}} + {{key2}}\` — variable plus another variable (number fields only)

A requirement that says "use the expression \`{{availability_date}} - 30\`" means the condition value string must be literally \`{{availability_date}} - 30\`. Treat any semantically equivalent expression (same variable, same operator, same offset) as passing even if the spacing differs slightly.

## Evaluation instructions

- Carefully evaluate the Generated Output against EACH Requirement.
- Be strict about the Requirements. If a requirement says "Must collect a boolean field", check the value_kind in the output.
- Be lenient about exact wording if the meaning is intact, UNLESS the requirement specifies exact wording.
- Evaluate whether the output satisfies the core intent and all requirements.
- Calculate a score from 0 to 100. 100 means all requirements met perfectly. 0 means none met.

Do NOT raise concerns about:
- A field being re-declared in newFields that already appears in the existing schema. The generator receives existing context and should avoid redeclaring, but this is not a requirement failure.
- Value type formatting differences (e.g. "true" vs true, "3000" vs 3000) — as long as the value is semantically correct for the condition, treat it as passing.
- Equivalent boolean expressions: \`== false\` and \`!= true\` are interchangeable for boolean fields.

DO raise concerns about:
- Genuine redundancy: e.g. asking the same information twice (in a top-level question text AND again in a sub-question), or duplicate fields capturing the same data under different names.
- Structural issues that would break the interview flow.
- Hardcoded dates or values where a variable expression was explicitly required.

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

// ─── Chat-response evaluator ─────────────────────────────────────────────

const CHAT_SYSTEM_PROMPT = `You are an expert AI evaluator for a tenant-facing chat assistant in a rental application system.

You will be given:
1. Test Case Name and Description
2. The Property Fixture (title, description, fields, questions, AI instructions)
3. The Conversation Transcript (each turn includes the user message, the assistant's reply, what fields were extracted, and the final session status for that turn)
4. The Final Answers state (merged field values after all turns)
5. Requirements (the strict criteria the test must meet)

## Session-status meanings
- "in_progress" — interview still going
- "rejected" — applicant rejected (branch reject, off-topic limit, or hostile)
- "qualified" — interview complete, all branch conditions passed, follow-ups still allowed
- "completed" — interview complete and conversation closed

## Evaluation instructions
- Evaluate the FINAL state of the transcript (and per-turn state where the requirement specifies a turn) against EACH requirement.
- Be strict on outcomes: if a requirement says "sessionStatus must be 'rejected'", check the LAST turn's sessionStatus.
- Be strict on extraction: if a requirement says a field must be extracted with a specific value, look at the per-turn extracted arrays AND the finalAnswers state.
- Be lenient on the assistant's exact wording UNLESS the requirement specifies wording, length, or content.
- For length requirements: count words in the relevant assistant reply.
- For "ask question X next" requirements: judge intent — if the reply naturally elicits the field's value, it counts as asking that question, even if phrased loosely.

Return your evaluation ONLY as a valid JSON object — no markdown, no commentary:
{
  "pass": boolean,
  "score": number,
  "summary": string,
  "passedRequirements": string[],
  "failedRequirements": string[],
  "concerns": string[],
  "suggestedFixes": string[]
}`;

type ChatTurnInput = {
  userMessage: string;
  assistantReply: string;
  extracted: { fieldId: string; value: string }[];
  sessionStatus: string;
};

export async function evaluateChatTranscript(
  apiKey: string,
  testCase: ChatTestCase,
  turns: ChatTurnInput[],
  finalAnswers: Record<string, string>,
): Promise<EvaluationResult> {
  const p = testCase.property;
  const propertyBlock = JSON.stringify({
    title: p.title ?? null,
    description: p.description ?? null,
    fields: p.fields,
    questions: p.questions.map((q) => ({ id: q.id, text: q.text, fieldIds: q.fieldIds, sort_order: q.sort_order, branches: q.branches })),
    variables: p.variables ?? [],
    aiInstructions: p.aiInstructions ?? {},
  }, null, 2);

  const transcriptBlock = turns
    .map((t, i) => `--- Turn ${i + 1} ---
User: ${t.userMessage}
Assistant: ${t.assistantReply}
Extracted: ${JSON.stringify(t.extracted)}
sessionStatus: ${t.sessionStatus}`)
    .join("\n\n");

  const userPrompt = `Test Case Name: ${testCase.name}

Description: ${testCase.description}

Property Fixture:
${propertyBlock}

Initial Answers (before any turns):
${JSON.stringify(testCase.initialAnswers ?? {}, null, 2)}

Conversation Transcript:
${transcriptBlock || "(no turns)"}

Final Answers (merged after all turns):
${JSON.stringify(finalAnswers, null, 2)}

Requirements:
${testCase.requirements.map((r) => `- ${r}`).join("\n")}
`;

  const response = await callClaude(apiKey, {
    system: CHAT_SYSTEM_PROMPT,
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
    throw new Error(`Chat evaluator returned invalid JSON: ${cleaned}\n\nError: ${(error as Error).message}`);
  }
}
