# Chatbot Approach

Single source of truth for the rental screening chatbot: client flow, Claude prompts, extraction, deterministic rule handling, lifecycle, and persistence.

Primary implementation files:

- `app/chat/[slug]/page.tsx`
- `app/api/chat/route.ts`
- `lib/anthropic.ts`

## Principles

1. **Tenant-friendly**: ask one conversational question at a time and answer property questions when the description contains the answer.
2. **Landlord-controlled**: use configured questions, branch rules, links, style guidance, examples, and AI behavior settings.
3. **Deterministic decisions**: Claude extracts values and writes replies; code validates data, walks the question tree, applies branches, updates counters, sets status, and persists state.

## Request Flow

```text
Applicant message
  -> client appends it locally and POSTs full visible history to /api/chat
  -> server normalizes property, fields, questions, answers, links, AI settings
  -> server loads session counters/status from Supabase
  -> Claude extracts field values with extract_fields
  -> server validates extracted values and merges answers
  -> server walks the question tree and applies branch rules
  -> server updates off-topic and qualified follow-up counters
  -> Claude writes the visible reply with screen_response
  -> server persists session, messages, counters, and answers
  -> client renders reply, merges extracted values, and applies terminal status
```

The client sends full chat history plus property context, field definitions, questions, links, `aiInstructions`, existing answers, `sessionId`, `propertyId`, and variables. New conversations use the same route by sending a synthetic first user message that asks the assistant to greet and start screening.

## Claude Integration

All calls go through `callClaude()` in `lib/anthropic.ts` using `claude-opus-4-7`, Anthropic version `2023-06-01`, `max_tokens: 1024`, a dynamic system prompt, and forced tool use.

The route uses two Claude phases instead of a single freeform response:

1. `extract_fields`: returns `extracted: { fieldId, value }[]` and `message_relevant`.
2. `screen_response`: returns `reply` and `end_conversation`.

Forced tools keep structured output out of prose, avoid JSON parsing cleanup, and make relevance and lifecycle signals typed.

## Dynamic Prompt

`buildSystemPrompt()` rebuilds the system prompt on every request from:

- property title and description
- field schema with valid IDs, value kind, options, and current answer state
- landlord question order and current done/pending status
- current collection status
- grounding behavior from `unknownInfoBehavior`
- next action from the question tree
- landlord style instructions and examples, when configured

The prompt tells Claude to extract only known fields, avoid inventing property details, follow the question order, ask follow-ups only for missing fields in the current question, and adopt the configured style.

Grounding behavior:

- `deflect`: answer from the property description only; if missing, say the detail is unavailable and suggest contacting the landlord.
- `ignore`: do not answer unknown property details; redirect to screening.

## Extraction and Validation

Claude may only extract into known field IDs. The server drops unknown IDs and invalid values before updating answers.

| Value kind | Validation |
| --- | --- |
| `number` | `Number(value)` is not `NaN` |
| `boolean` | lowercased value is `true` or `false` |
| `date` | `Date.parse(value)` is valid |
| `enum` | value matches a configured option, case-insensitive |
| `text` | always valid |

Only validated values reach `mergedAnswers`, branch evaluation, persistence, and the client answer state.

## Question Tree and Branches

The server sorts questions by `sort_order` and walks them in code:

1. The first question with any missing target field becomes the next question.
2. Completed questions evaluate their branches with `evalBranchCondition()`.
3. The first matching branch controls the outcome.
4. `reject` marks the applicant rejected.
5. `followups` recursively walks the branch sub-questions.
6. No pending question and no rejection means the interview is qualified.

Claude does not decide eligibility. It only sees the result through the next prompt and response context.

## Lifecycle

API statuses are `in_progress`, `qualified`, `completed`, and `rejected`.

```text
IN_PROGRESS
  -> REJECTED   when an off-topic limit or reject branch is hit
  -> QUALIFIED  when all required questions are complete and rules pass

QUALIFIED
  -> COMPLETED  when follow-up allowance is exhausted, follow-ups are disabled, or the applicant goes off-topic
```

`completed` is a successful terminal state. `rejected` is a failed terminal state. In the database, both `qualified` and `completed` are stored as `qualified`; API responses keep them distinct for the chat UI.

## Counters

Counters are server-authoritative and loaded from the `sessions` table when `sessionId` is present.

Off-topic handling:

- `message_relevant === false` increments `off_topic_count`; relevant messages reset it to `0`.
- `offTopicLimit` defaults to `3`; `0` means unlimited.
- Hitting the limit sets `sessionStatus = "rejected"`.
- Before the limit, the response context asks Claude to redirect back to screening.

Qualified follow-ups:

- Once the stored session is already `qualified`, each turn increments `qualified_follow_up_count`.
- `qualifiedFollowUps` defaults to `3`; `0` closes immediately on later qualified turns.
- Reaching the limit sets `sessionStatus = "completed"`.

## Qualified Responses

When the applicant qualifies, the response context tells Claude to say they meet requirements and include configured links:

- `videoUrl`
- `bookingUrl`

If no links exist, the assistant still acknowledges qualification. When the final qualified response is reached, the context explicitly says it is the final message.

## Persistence and Client Response

When `sessionId` exists, the server upserts `sessions` with listing title, DB status, merged answers, message count, property ID, counters, and `updated_at`. It also inserts the latest user message and assistant reply into `messages`; assistant rows include validated extractions when present.

Supabase write failures are logged but do not block the API response.

The API returns:

```json
{
  "reply": "Assistant message shown to applicant",
  "extracted": [{ "fieldId": "monthly_income", "value": "4200" }],
  "sessionStatus": "in_progress",
  "debugInfo": {
    "sessionStatus": "in_progress",
    "offTopicCount": 0,
    "branchOutcome": null
  }
}
```

The client appends the reply, merges extracted answers, stores `debugInfo` for `?debug=1`, and disables input for `rejected` or `completed`.

## Landlord Settings

AI behavior lives in `properties.ai_instructions`:

```ts
type AiInstructions = {
  style: string;
  examples: AiExample[];
  offTopicLimit: number;
  qualifiedFollowUps: number;
  unknownInfoBehavior: "deflect" | "ignore";
  rejectionPrompt?: string;
};
```

These settings are edited in the property AI Behavior UI alongside freeform style instructions and example conversations.
