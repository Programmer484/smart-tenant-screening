# AI Generation Process

This document explains how the app uses AI to generate and update screening fields, interview questions, branch rules, and variables after a landlord enters a prompt in the property editor.

The main implementation points are:

- `app/(dashboard)/property/[id]/page.tsx`
- `app/api/clarify-prompt/route.ts`
- `app/api/generate-property/route.ts`
- `app/api/generate-fields/route.ts`
- `app/components/RuleProposalModal.tsx`
- `lib/question.ts`
- `lib/landlord-field.ts`
- `lib/rule-engine.ts`

## Core Concepts

The generated screening configuration has four main pieces.

### Fields

Fields are the data schema. They are the atomic values the chat will extract and store.

```ts
type LandlordField = {
  id: string;
  label: string;
  value_kind: "text" | "number" | "date" | "boolean" | "enum";
  collect_hint?: string;
  options?: string[];
};
```

Field IDs must be `snake_case`, start with a letter, and contain only lowercase letters, numbers, and underscores. Enum fields must include at least two distinct options.

### Questions

Questions are the interview flow. Each question collects one or more fields.

```ts
type Question = {
  id: string;
  text: string;
  fieldIds: string[];
  sort_order: number;
  branches: Branch[];
};
```

The default maximum is three fields per question. The generator is told to merge related fields into one question when practical, but to split unrelated topics.

### Branch Rules

Rules are encoded as question branches, not as a separate generated rules table.

```ts
type Branch = {
  id: string;
  condition: {
    fieldId: string;
    operator: string;
    value: string;
  };
  outcome: "continue" | "followups" | "reject";
  subQuestions: Question[];
  customMessage?: string;
};
```

Branch outcomes mean:

- `continue`: normal flow continues.
- `followups`: matching applicants are asked branch-specific sub-questions.
- `reject`: matching applicants are rejected by the chat flow.

Valid operators depend on field type:

| Field type | Operators |
| --- | --- |
| `number` | `==`, `!=`, `>`, `>=`, `<`, `<=` |
| `date` | `==`, `!=`, `>`, `>=`, `<`, `<=` |
| `boolean` | `==`, `!=` |
| `text` | `==`, `!=` |
| `enum` | `==`, `!=` |

### Variables

Variables are landlord-defined values that can be reused in question text or branch conditions.

```ts
type PropertyVariable = {
  id: string;
  key: string;
  label: string;
  value: string;
  value_kind?: "text" | "number" | "date" | "boolean" | "enum";
};
```

A question can reference a variable with `{{key}}`. Branch condition values can also use simple expressions for date and number fields:

```text
{{key}}
{{key}} + N
{{key}} - N
{{key}} + {{other_key}}
{{key}} - {{other_key}}
```

For dates, offsets are days. For numbers, offsets are numeric.

## High-Level Flow

```text
Landlord enters an AI prompt
  -> UI expands prompt with referenced questions when @mentions are used
  -> UI asks /api/clarify-prompt whether more context is needed
  -> If clarification is needed, landlord answers or skips
  -> UI sends the final description to /api/generate-property
  -> AI creates a short screening requirement plan
  -> AI converts that plan into JSON changes
  -> Server parses, validates, and repairs the proposal
  -> UI shows the proposal in a review modal
  -> Landlord accepts or cancels
  -> Accepted changes are merged into local property state
  -> Normal save/publish flow persists the property
```

AI generation produces proposals. It does not silently mutate the property. The landlord reviews and accepts changes before they are applied.

## Prompt Preparation

The property editor builds the prompt in `buildDescription()`.

If the landlord includes a question mention like:

```text
Update @[Do you have pets?] to reject cats.
```

the UI appends the full JSON for matching referenced questions:

```text
REFERENCED QUESTIONS (with full branch structure - modify or extend these as needed):
[
  {
    "id": "q_pets",
    "text": "Do you have pets?",
    "fieldIds": ["has_pets"],
    "branches": []
  }
]
```

This gives the generator enough context to modify existing branches or follow-ups instead of creating duplicates.

## Clarification Preflight

Before generating the proposal, `handleGenerateQuestions()` calls `/api/clarify-prompt`.

The clarification route asks Claude to decide whether the landlord prompt has enough context to create a strong schema. It is explicitly told not to generate fields or questions yet.

The system prompt asks for up to four short clarification questions only when the answer would materially change the schema. Examples include:

- Unit availability date.
- Income threshold.
- Maximum occupant count.
- Whether a condition should reject or only flag for review.

The route includes existing fields, existing questions, and variables so the model does not ask for context that already exists.

Expected response:

```json
{
  "questions": [
    "What income threshold should trigger rejection?"
  ]
}
```

If the clarification call fails, returns invalid JSON, or returns no questions, the UI proceeds directly to generation. This is intentionally fail-soft.

If clarification questions are returned, the landlord can answer them or skip them. Non-skipped answers are appended to the generation prompt:

```text
Additional context (clarifying answers):
Q: What income threshold should trigger rejection?
A: Less than 3x monthly rent.
```

## Property-Wide Generation

The main generator is `/api/generate-property`.

The UI sends:

```json
{
  "description": "final landlord prompt",
  "existingFields": [
    { "id": "monthly_income", "label": "Monthly income", "value_kind": "number" }
  ],
  "existingQuestions": [
    { "id": "q_income", "text": "What is your monthly income?", "fieldIds": ["monthly_income"] }
  ],
  "variables": [
    { "key": "monthly_rent", "label": "Monthly rent", "value": "1800", "value_kind": "number" }
  ],
  "links": {
    "videoUrl": "",
    "bookingUrl": ""
  },
  "aiInstructions": {
    "offTopicLimit": 3,
    "qualifiedFollowUps": 3
  }
}
```

The property-wide generator can propose changes to `newFields`, `questions`, `deletedQuestionIds`, `variables`, `links`, `aiInstructions`, and `notesToUser`.

## Step 1: Screening Requirement Plan

`/api/generate-property` first asks Claude to create a concise plan before asking for JSON.

The planning prompt says the model is a rental application expert and must:

- Determine the fields, questions, and AI behaviors needed.
- Encode screening criteria as reject branches on questions.
- Stay minimalist.
- Avoid adding standard rental questions unless explicitly requested.
- Note only important assumptions, missing critical variables, or skipped checks.
- Avoid JSON in this planning step.

The user message for this phase includes:

```text
USER PROMPT:
{description}

CURRENT STATE:
Fields: {existingFields.length}
Questions: {existingQuestions.length}
```

The plan is logged in development and returned to the UI as `debugPlan`.

## Step 2: JSON Generation

The second property-wide call asks Claude to implement the plan as JSON.

The user message includes:

```text
Here is the user's original prompt:
{description}

Here is the detailed Screening Requirement Plan we've developed based on that prompt:
{expandedPlan}

Implement this plan and return the required JSON schema. Use the "notesToUser" array to explain to the user the standard practices or assumptions you applied.
```

The system prompt tells the model it can update data fields, interview questions, variables, links, and AI settings.

Important generation rules:

- Only return arrays or objects that need modification.
- A question can collect multiple fields, with a default max of three.
- Every `fieldIds` entry must refer to an existing field or a new field in `newFields`.
- Updated questions must return the full `fieldIds` list.
- New question IDs should start with `q_`.
- Replaced or merged questions should be listed in `deletedQuestionIds`.
- The schema must stay flat: no arrays, nested objects, or collection fields.
- Screening criteria should be encoded directly as question branches.
- Variables can be created or modified; if variables change, return the full `variables` array.
- Links and AI behavior settings should be included only when changed.

Expected response shape:

```json
{
  "notesToUser": [
    "Used monthly rent as the income baseline."
  ],
  "newFields": [
    {
      "id": "monthly_income",
      "label": "Monthly income",
      "value_kind": "number"
    }
  ],
  "questions": [
    {
      "id": "q_income",
      "text": "What is your monthly household income?",
      "fieldIds": ["monthly_income"],
      "branches": [
        {
          "condition": {
            "fieldId": "monthly_income",
            "operator": "<",
            "value": "{{minimum_income}}"
          },
          "outcome": "reject",
          "subQuestions": []
        }
      ]
    }
  ],
  "deletedQuestionIds": [],
  "variables": [
    {
      "key": "minimum_income",
      "label": "Minimum monthly income",
      "value": "5400",
      "value_kind": "number"
    }
  ],
  "links": {
    "bookingUrl": "https://example.com/book"
  },
  "aiInstructions": {
    "rejectionPrompt": "Let the applicant know they do not meet the listed requirement and close politely."
  }
}
```

The rule engine supports `{{key}}`, `{{key}} + N`, `{{key}} - N`, and variable-to-variable offsets. It does not evaluate multiplication expressions, so generated rules should use concrete variables such as `minimum_income` when a computed threshold is needed.

## Field and Question Validation

After the model returns JSON, the server parses it and drops invalid items.

Field validation checks:

- `id` exists and passes `validateLandlordFieldId()`.
- `label` exists and passes `validateLandlordFieldLabel()`.
- `value_kind` is one of the supported kinds.
- Enum fields include valid normalized options.

Question validation checks:

- `id` is a string.
- `text` is a non-empty string.
- `fieldIds` is a non-empty string array.
- Branches have a condition, operator, value, and valid outcome.
- Branch sub-questions are parsed recursively.

Generated branch IDs are assigned server-side with `generateId()`.

## Orphan Field Repair

The generator sometimes references a field ID in a question or branch condition but forgets to define that field. These are called orphan field IDs.

The server collects orphan IDs by walking top-level question `fieldIds`, branch condition `fieldId`, sub-question `fieldIds`, and nested branch structures.

If orphans exist, `/api/generate-property` runs a repair prompt:

```text
You are a rental application schema assistant. The generator referenced field IDs that are not yet defined.
Return ONLY valid JSON:
{ "newFields": [ { "id": "exact_snake_case_id", "label": "Human label", "value_kind": "text|number|boolean|date|enum", "options": ["only","for","enum"] } ] }

Missing field ids to define:
  - "{missing_id}"
```

Then the route retries generation with the repaired fields added to the existing schema and a retry instruction:

```text
GENERATION ATTEMPT: 2 (retry). A previous pass referenced field IDs that were not in the schema; missing definitions were added to EXISTING FIELDS. Regenerate a complete, consistent proposal.
```

If the retry has no orphans, the server uses the retried result and merges in repaired fields, de-duplicated by field ID. If retry fails, the route may fall back to the first result plus repaired fields.

## Targeted Question Generation

There is also a narrower endpoint: `/api/generate-fields`.

The property editor uses it for targeted edits to a specific question from the flow editor. The prompt is shaped like:

```text
Modify this specific question and its branches to: {prompt}.

IMPORTANT: Return EXACTLY ONE question in the 'questions' array, which must have the id "{question.id}".
Here is the current JSON of the question:
{question JSON}
```

The targeted endpoint can generate `newFields`, `questions`, and `deletedQuestionIds`. It does not handle property links or AI settings.

The endpoint has stricter failure behavior than `/api/generate-property`:

- Invalid JSON returns `502`.
- Repair failure returns `422`.
- Remaining orphan field references after retry return `422`.
- Questions exceeding `maxFieldsPerQuestion` return `422`.

When a targeted question update succeeds, the UI forces the updated question to keep the original question ID so the flow editor replaces the exact question.

## Flat Schema Rules

The prompts explicitly prevent arrays and nested objects. Repeating entities are represented with numbered scalar fields.

Good:

```text
occupant_2_name
occupant_2_relationship
occupant_3_name
occupant_3_relationship
```

Bad:

```text
occupants
occupants[]
occupants.name
```

Additional rules:

- Occupant 1 is always the applicant, so generated additional occupant fields start at `occupant_2`.
- If the landlord gives a maximum count, generate exactly that many slots.
- If no maximum is given, default to a sensible cap, usually three.
- Relationship fields should usually be enum fields.
- Do not ask redundant booleans when a relationship or enum answer already implies the fact.

## Variable Expressions in Rules

Branch conditions are evaluated by `evalBranchCondition()` in `lib/rule-engine.ts`.

Before comparison, condition values are resolved through `resolveExpression()` when they match the variable expression syntax.

Examples:

```json
{
  "fieldId": "move_in_date",
  "operator": "<",
  "value": "{{availability_date}} - 30"
}
```

If `availability_date` is `2026-07-01`, the resolved comparison value is `2026-06-01`.

```json
{
  "fieldId": "monthly_income",
  "operator": "<",
  "value": "{{minimum_income}}"
}
```

If `minimum_income` is `5400`, the resolved comparison value is `5400`.

If a variable is missing or invalid for the field type, the engine falls back to the original or base variable value rather than throwing.

## Proposal Review

The UI never applies generated changes immediately. It stores the proposal in `ruleProposal` and opens `RuleProposalModal`.

The modal shows:

- AI notes and assumptions.
- New fields.
- Variable additions, edits, and removals.
- Questions to remove.
- New or modified questions.
- Branch rules and follow-up sub-questions.

The landlord can cancel or choose `Accept & Apply`.

## Applying a Proposal

`applyProposal()` merges accepted changes into local property editor state.

### Fields

New fields are added only if:

- ID is present and valid.
- Label is present and valid.
- ID is not already used.
- Label is not already used case-insensitively.
- Enum options are valid when `value_kind` is `enum`.

Accepted fields get local UI metadata such as `_isNew` and `_clientId`.

### Questions

Question application is a delete-then-upsert process:

1. Recursively delete any question whose ID appears in `deletedQuestionIds`.
2. For each proposed question:
   - If the ID already exists, update its text and field IDs.
   - Use proposed branches only when the AI provided branches.
   - Otherwise preserve the existing branches.
   - If the ID does not exist, append it as a new question.
3. Recompute top-level `sort_order`.

### Variables

When the proposal includes `variables`, the UI treats it as the proposed full variable list, but protects existing variables that are still referenced in question text and omitted by the AI.

The merge behavior is:

```text
protected existing variables still referenced by {{key}}
  + proposed variables
```

### Links

Generated links are shallow-merged into the existing `links` object.

### AI Instructions

Generated AI instructions are shallow-merged into existing settings.

Before applying:

- `offTopicLimit` is rounded and clamped to `>= 0`.
- `qualifiedFollowUps` is rounded and clamped to `>= 0`.
- Missing or non-numeric values for those settings are ignored.

## Persistence

Accepting a proposal updates local React state in the editor. The normal property save flow persists these values to Supabase:

- `fields`
- `questions`
- `variables`
- `links`
- `ai_instructions`

Publishing stores the active configuration in `published_state` as well.

## Responsibility Split

| Responsibility | Owner |
| --- | --- |
| Decide whether clarification is useful | Claude via `/api/clarify-prompt` |
| Draft high-level screening plan | Claude via `/api/generate-property` |
| Generate JSON proposal | Claude via `/api/generate-property` or `/api/generate-fields` |
| Parse JSON and repair common formatting issues | Server code |
| Validate field and question shapes | Server code |
| Detect orphan field references | Server code |
| Repair missing field definitions | Claude plus server validation |
| Display proposal for review | React UI |
| Decide whether to accept generated changes | Landlord |
| Merge accepted proposal into editor state | React UI |
| Evaluate branches during applicant chat | Server rule engine |

The AI is responsible for proposing a configuration. The app is responsible for validating, repairing, presenting, applying, and later enforcing that configuration.
