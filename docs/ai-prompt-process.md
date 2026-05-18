# AI Prompt Process

This document explains what happens after an applicant enters a message in the rental screening chat. It focuses on the prompts, context, tool calls, validation, and persistence steps used by the AI workflow.

The live tenant-facing flow is implemented mainly in:

- `app/chat/[slug]/page.tsx`
- `app/api/chat/route.ts`
- `lib/anthropic.ts`

## High-level flow

```text
Applicant enters a message
  -> Chat page appends it to local message history
  -> Chat page POSTs the full chat context to /api/chat
  -> Server rebuilds screening state
  -> Server asks Claude to extract field values
  -> Server validates extracted values in code
  -> Server evaluates question tree and branch rules
  -> Server builds response context
  -> Server asks Claude to write the next assistant reply
  -> Server persists session, messages, counters, and answers
  -> Chat page renders reply and updates local answer state
```

The model does not make the final eligibility decision by itself. The model extracts values and writes conversational text. The application code validates values, walks the question tree, applies branch outcomes, updates counters, and chooses the session status.

## Client-side submission

When the applicant presses Enter or clicks Send, the chat page runs `send()` in `app/chat/[slug]/page.tsx`.

The client:

1. Trims the current input.
2. Stops if the input is empty, already sending, missing configuration, closed, or missing a session id.
3. Appends the applicant message to the visible message list immediately.
4. Converts visible messages into API history:

```ts
[
  { role: "assistant", content: "..." },
  { role: "user", content: "..." }
]
```

5. Sends a POST request to `/api/chat`.

The request body includes:

```json
{
  "title": "Property title",
  "description": "Property description",
  "fields": ["screening field definitions"],
  "questions": ["interview question tree"],
  "links": {
    "videoUrl": "optional video tour URL",
    "bookingUrl": "optional booking URL"
  },
  "aiInstructions": {
    "style": "landlord style instructions",
    "examples": ["example tenant/assistant pairs"],
    "offTopicLimit": 3,
    "qualifiedFollowUps": 3,
    "unknownInfoBehavior": "deflect",
    "rejectionPrompt": "custom rejection language"
  },
  "variables": ["property variables used by rule conditions"],
  "answers": {
    "field_id": "previously collected value"
  },
  "messages": [
    { "role": "assistant", "content": "Previous assistant reply" },
    { "role": "user", "content": "Applicant's new message" }
  ],
  "sessionId": "browser-stored session id",
  "propertyId": "property id"
}
```

The client sends the full visible conversation history, not only the latest message. The latest user message is the last `user` item in `messages`.

## New conversation prompt

Before the applicant types anything, the chat page starts the conversation by sending a synthetic user message to `/api/chat`.

If the URL contains a `name` query parameter:

```text
(new conversation - the applicant's name is {tenantName}. greet them by name and ask the next screening question)
```

Otherwise:

```text
(new conversation - very concisely introduce yourself and ask the first screening question)
```

This means the same server-side AI pipeline handles both the greeting and normal applicant responses.

## Anthropic request wrapper

All Claude calls go through `callClaude()` in `lib/anthropic.ts`.

The wrapper sends:

```json
{
  "model": "claude-opus-4-7",
  "max_tokens": 1024,
  "system": "dynamic system prompt",
  "messages": ["conversation history"],
  "tools": ["optional tool definitions"],
  "tool_choice": "optional forced tool"
}
```

The Anthropic API version is:

```text
2023-06-01
```

If Claude returns a non-2xx response, the wrapper throws `ClaudeApiError`. Server errors from Claude are mapped to HTTP `502`; client errors preserve their status code.

## Server request normalization

The `/api/chat` route starts by reading and normalizing the request body.

Defaults:

- `title`: `"Rental Property"` if missing.
- `description`: empty string if missing.
- `fields`: empty array if missing.
- `questions`: empty array if missing; each question gets `branches: []` if absent.
- `answers`: empty object if missing.
- `messages`: empty array if missing.
- `links`: merged with `DEFAULT_LINKS`.
- `aiInstructions`: normalized with `resolveAiInstructions()`.
- `variables`: empty array if missing.

If `CLAUDE_API_KEY` is missing, the route returns `500`.

If `messages` is empty, the route returns `400`.

## Server-authoritative session state

If the request includes `sessionId`, the server loads the existing session from Supabase:

```text
status
off_topic_count
qualified_follow_up_count
```

These counters are server-authoritative. The client renders state, but the server decides whether a session is still in progress, qualified, completed, or rejected.

The server treats the session as already qualified when the stored session status is `qualified`.

## Dynamic system prompt

Both AI phases use `buildSystemPrompt()` from `app/api/chat/route.ts`.

The prompt is rebuilt for every request. It includes the current property, field schema, interview question order, collected answer state, landlord style instructions, landlord examples, and the next action the assistant should take.

### System prompt structure

```text
You are a rental screening assistant for "{title}".

PROPERTY:
{description}

FIELD SCHEMA (data to collect):
  - {field.id}: {field.value_kind} ("{field.label}"), options: [{option list}] = {known value or unknown}

INTERVIEW QUESTIONS (ask in this order):
  1. "{question.text}" -> fields: [{fieldIds}] {done or pending}

STATUS: {answeredFields.length}/{fields.length} fields collected.

STYLE (follow these instructions closely):
{ai.style}

EXAMPLES (match this tone and style):
Tenant: "{example.user}"
You: "{example.assistant}"

INSTRUCTIONS:
- {grounding instruction}
- Extract screening values from each message into the FIELD SCHEMA. Values: plain strings, numbers like "3500", booleans as "true"/"false".
- {next question instruction}
- NEVER invent new fields or ask about topics not in the FIELD SCHEMA.
- NEVER deviate from the INTERVIEW QUESTIONS order, EXCEPT to follow up on missing fields from a previous question.
- CRITICAL STYLE ENFORCEMENT: You must adopt the following persona/style explicitly: "{ai.style}".
```

The `STYLE`, `EXAMPLES`, and final critical style enforcement sections are only included when the landlord configured them.

### Field schema block

Each field is rendered with:

- Field id.
- Value kind: `text`, `number`, `boolean`, `date`, or `enum`.
- Label, when available.
- Enum options, when available.
- Current answer state.

Conceptual example:

```text
  - monthly_income: number ("Monthly income") = "4200"
  - move_in_date: date ("Move-in date") = ?
  - has_pets: boolean ("Has pets") = ?
```

The field schema tells Claude exactly which IDs are valid extraction targets.

### Interview question block

Questions are sorted by `sort_order` and shown with their target fields.

Conceptual example:

```text
  1. "What is your monthly household income?" -> fields: [monthly_income] done
  2. "When are you hoping to move in?" -> fields: [move_in_date] pending
  3. "Do you have any pets?" -> fields: [has_pets] pending
```

This block keeps Claude aligned with the landlord-defined interview order.

### Grounding instruction

The grounding instruction depends on `ai.unknownInfoBehavior`.

When `unknownInfoBehavior` is `"ignore"`:

```text
Do not answer questions about details not covered above. Redirect the applicant back to the screening questions.
```

Otherwise, the default behavior is `"deflect"`:

```text
Only answer property questions using the property description above. If the information is not there, say you don't have that detail and suggest contacting the landlord. Never invent details.
```

This is the anti-hallucination control for property questions.

### Next question instruction

The server walks the question tree before each model call and tells Claude the next action.

If the next question has not been answered at all:

```text
NEXT QUESTION: Ask exactly this: "{nextQuestion.text}". This question collects fields: [{field id and value kind list}].
```

If a multi-field question was partially answered:

```text
FOLLOW-UP REQUIRED: The applicant's previous answer didn't cover all fields. Ask a follow-up to collect these missing fields: "{field label}" ({field id}, type: {value kind}). Be conversational - don't just list the fields, ask naturally.
```

If all screening questions have been collected and no reject branch fired:

```text
All screening questions have been collected. Do not ask any more questions. Thank the applicant and let them know their application is complete and will be reviewed.
```

## Phase 1: extraction

The first Claude call extracts structured field values and classifies whether the applicant's message is relevant.

The system prompt is:

```text
{buildSystemPrompt output}

Your only job right now is to extract field values from the applicant's message into the FIELD SCHEMA. Only use field IDs from the schema. If a value was implied earlier but not yet extracted, extract it now. Do not write a reply.
```

The full conversation history is passed as `messages`.

Claude is forced to use the `extract_fields` tool:

```json
{
  "type": "tool",
  "name": "extract_fields"
}
```

### Extraction tool

```json
{
  "name": "extract_fields",
  "description": "Extract screening field values from the applicant's message. Only extract into known field IDs.",
  "input_schema": {
    "type": "object",
    "properties": {
      "extracted": {
        "type": "array",
        "description": "Field values found in the applicant's message. Empty array if none.",
        "items": {
          "type": "object",
          "properties": {
            "fieldId": { "type": "string" },
            "value": { "type": "string" }
          },
          "required": ["fieldId", "value"]
        }
      },
      "message_relevant": {
        "type": "boolean",
        "description": "true if the message is a screening answer OR a property question. false if completely off-topic."
      }
    },
    "required": ["extracted", "message_relevant"]
  }
}
```

Expected tool output:

```json
{
  "extracted": [
    { "fieldId": "monthly_income", "value": "4200" }
  ],
  "message_relevant": true
}
```

### Relevance classification

`message_relevant` should be:

- `true` when the message answers a screening question.
- `true` when the message asks a property question.
- `false` only when the message is completely off-topic.

The server treats any missing value as relevant by default:

```ts
const messageRelevant = extractInput?.message_relevant !== false;
```

## Extraction validation

The server validates every extracted value before merging it into `answers`.

Validation rules:

| Value kind | Rule |
| --- | --- |
| `number` | `Number(value)` must not be `NaN` |
| `boolean` | Lowercased value must be `"true"` or `"false"` |
| `date` | `Date.parse(value)` must produce a valid date |
| `enum` | Value must match one configured option, case-insensitive |
| `text` | Always accepted |

Invalid extractions are dropped. Unknown field IDs are also dropped. Dropped values do not reach the rule engine, session answers, or client state.

After validation, the server merges values:

```text
mergedAnswers = previous answers + validated extracted values
```

## Question tree and branch evaluation

The server walks questions in `sort_order`.

For each question:

1. If any target field is missing, that question becomes the next question.
2. If all target fields are filled, the server evaluates the question's branches.
3. The first matching branch determines the branch outcome.
4. A branch outcome of `reject` immediately marks the applicant as rejected.
5. A branch outcome of `followups` recursively walks the branch's sub-questions.
6. If no pending question and no reject branch remain, the interview is done.

The model is not responsible for this control flow. Claude only sees the result through the next system prompt and response context.

## Counter updates

After extraction, the server updates counters.

Off-topic counter:

```text
if message_relevant is false:
  offTopicCount += 1
else:
  offTopicCount = 0
```

Qualified follow-up counter:

```text
if the stored session was already qualified:
  qualifiedFollowUpCount += 1
```

This means follow-up limits apply after an applicant has already reached the qualified phase.

## Session status decision

The server sets one of these API statuses:

- `in_progress`
- `qualified`
- `completed`
- `rejected`

The status decision happens before the response-writing call, so the second Claude prompt can include the correct response context.

### Off-topic rejection

If `ai.offTopicLimit > 0` and the counter reaches the limit:

```text
sessionStatus = rejected
```

Response context added to the second prompt:

```text
IMPORTANT - OFF-TOPIC REJECTION:
The applicant has sent {offTopicCount} consecutive off-topic messages (limit: {ai.offTopicLimit}). Close the conversation and state the reason.
```

### Branch rejection

If the question tree returns `branchOutcome === "reject"`:

```text
sessionStatus = rejected
```

Response context added to the second prompt:

```text
IMPORTANT - REJECTION (BRANCH RULE):
Based on the applicant's answers, they do not meet the requirements for this listing. {custom branch message or rejection prompt}
```

### Qualified or completed

If the applicant was already qualified or the interview is now done:

```text
sessionStatus = qualified or completed
```

The session becomes `completed` when:

- `qualifiedFollowUps` is `0` and the applicant was already qualified.
- `qualifiedFollowUpCount` reaches the configured limit.
- The applicant sends an off-topic message while already qualified.

If property links exist, response context includes:

```text
IMPORTANT - QUALIFIED:
The applicant meets all requirements. Share these links:
- Video tour: {links.videoUrl}
- Book a viewing: {links.bookingUrl}
Include the full URLs.
```

If the message is final, the prompt also says:

```text
This is the final message.
```

If no links exist and the session is only qualified:

```text
NOTE: The applicant is qualified and meets all requirements.
```

### Off-topic redirect

If the message is off-topic but does not yet hit the rejection limit:

```text
NOTE: Off-topic message ({offTopicCount}/{limit}). Redirect to screening questions.
```

## Phase 2: response generation

The second Claude call writes the assistant's visible reply.

The system prompt is:

```text
{buildSystemPrompt using mergedAnswers}
{responseContext from status decision}
```

The full conversation history is passed again as `messages`.

Claude is forced to use the `screen_response` tool:

```json
{
  "type": "tool",
  "name": "screen_response"
}
```

### Response tool

```json
{
  "name": "screen_response",
  "description": "Write a conversational reply to the applicant based on the current screening state.",
  "input_schema": {
    "type": "object",
    "properties": {
      "reply": {
        "type": "string",
        "description": "Your conversational message to the applicant."
      },
      "end_conversation": {
        "type": "boolean",
        "description": "true ONLY if the applicant is explicitly hostile, refuses to answer after multiple attempts, or spamming. NEVER set this to true simply because you finished collecting all questions. If the interview is complete, set this to false."
      }
    },
    "required": ["reply", "end_conversation"]
  }
}
```

Expected tool output:

```json
{
  "reply": "Thanks. When are you hoping to move in?",
  "end_conversation": false
}
```

If the response tool sets `end_conversation` to `true` while the session is still `in_progress`, the server changes the session status to `rejected`.

## Persistence

After Claude writes the reply, the server persists the result when `sessionId` is available.

The `sessions` table is upserted with:

```text
id
listing_title
status
answers
message_count
property_id
off_topic_count
qualified_follow_up_count
updated_at
```

The database status is simplified:

```text
API rejected  -> DB rejected
API qualified -> DB qualified
API completed -> DB qualified
API in_progress -> DB in_progress
```

The `messages` table receives:

1. The latest user message.
2. The assistant reply.

The assistant message also stores validated extractions when any were found.

Supabase write failures are logged but do not prevent the API from returning the reply.

## API response to the client

The route returns:

```json
{
  "reply": "Assistant message shown to applicant",
  "extracted": [
    { "fieldId": "monthly_income", "value": "4200" }
  ],
  "sessionStatus": "in_progress",
  "debugInfo": {
    "sessionStatus": "in_progress",
    "offTopicCount": 0,
    "branchOutcome": null
  }
}
```

The client then:

1. Appends the assistant reply to the visible chat.
2. Merges extracted values into local `answers`.
3. Stores `debugInfo` for the `?debug=1` panel.
4. Disables input if `sessionStatus` is `rejected` or `completed`.

## Debug behavior

When the chat URL includes `?debug=1`, the UI can show:

- Local `answers` state.
- Server `debugInfo`.
- Per-message extraction logs for assistant messages.

This debug panel is only a UI aid. It does not change the AI prompt, validation, or session lifecycle.

## Example turn

Assume the current missing question is:

```text
What is your monthly household income?
```

The applicant sends:

```text
I make about $4,200 a month.
```

The client sends the full history to `/api/chat`.

The extraction phase asks Claude to use `extract_fields`. A valid result would be:

```json
{
  "extracted": [
    { "fieldId": "monthly_income", "value": "4200" }
  ],
  "message_relevant": true
}
```

The server validates `4200` as a number, merges it into `answers`, walks the question tree, and finds the next missing question.

The response phase prompt now includes:

```text
STATUS: 1/3 fields collected.
NEXT QUESTION: Ask exactly this: "When are you hoping to move in?"
```

Claude returns:

```json
{
  "reply": "Thanks. When are you hoping to move in?",
  "end_conversation": false
}
```

The server stores the turn and returns the reply to the client.

## Prompt responsibilities

The workflow deliberately splits responsibilities:

| Responsibility | Owner |
| --- | --- |
| Conversational wording | Claude response phase |
| Field extraction | Claude extraction phase |
| Field ID allow-list | Tool schema plus server validation |
| Type validation | Server code |
| Question order | Server `walkTree()` plus system prompt |
| Branch rejection | Server rule engine |
| Off-topic counting | Server code |
| Qualified follow-up counting | Server code |
| Final API status | Server code |
| Persistence | Server code |

This split keeps the AI useful for language tasks while keeping important screening decisions deterministic and auditable.

