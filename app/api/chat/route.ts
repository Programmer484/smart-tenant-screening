import { NextResponse } from "next/server";
import type { LandlordField, FieldValueKind } from "@/lib/landlord-field";
import type { LandlordRule } from "@/lib/landlord-rule";
import type { AiInstructions } from "@/lib/property";
import { resolveAiInstructions } from "@/lib/property";
import { createServiceClient } from "@/lib/supabase/service";
import { evaluateRules, describeViolation } from "@/lib/rule-engine";
import { callClaude, ClaudeApiError } from "@/lib/anthropic";

type IncomingMessage = { role: "user" | "assistant"; content: string };
type Extraction = { fieldId: string; value: string };

// ─── Tool definitions ───────────────────────────────────────────────

const EXTRACT_TOOL = {
  name: "extract_fields",
  description:
    "Extract screening field values from the applicant's message and classify relevance.",
  input_schema: {
    type: "object" as const,
    properties: {
      extracted: {
        type: "array",
        description:
          "Field values found in the applicant's message. Empty array if none.",
        items: {
          type: "object",
          properties: {
            fieldId: { type: "string" },
            value: { type: "string" },
          },
          required: ["fieldId", "value"],
        },
      },
      message_relevant: {
        type: "boolean",
        description:
          "true if the message is a screening answer OR a property question. false if completely off-topic.",
      },
    },
    required: ["extracted", "message_relevant"],
  },
};

const RESPOND_TOOL = {
  name: "screen_response",
  description:
    "Write a conversational reply to the applicant based on the current screening state.",
  input_schema: {
    type: "object" as const,
    properties: {
      reply: {
        type: "string",
        description: "Your conversational message to the applicant.",
      },
      end_conversation: {
        type: "boolean",
        description:
          "true if the conversation should end — e.g. the applicant refuses to provide required info, is uncooperative, or the conversation clearly isn't progressing. Your reply should be a polite closing message.",
      },
    },
    required: ["reply", "end_conversation"],
  },
};

// ─── Value validation ───────────────────────────────────────────────

function isValidExtraction(
  value: string,
  kind: FieldValueKind,
  options?: string[],
): boolean {
  switch (kind) {
    case "number":
      return !isNaN(Number(value));
    case "boolean":
      return ["true", "false"].includes(value.toLowerCase());
    case "date":
      return !isNaN(Date.parse(value));
    case "enum":
      return (options ?? []).some(
        (o) => o.toLowerCase() === value.toLowerCase(),
      );
    case "text":
      return true;
    default:
      return true;
  }
}

// ─── System prompt ──────────────────────────────────────────────────

function buildSystemPrompt(
  title: string,
  description: string,
  fields: LandlordField[],
  rules: LandlordRule[],
  answers: Record<string, string>,
  ai: AiInstructions,
): string {
  const answered = fields.filter((f) => answers[f.id] !== undefined);
  const unanswered = fields.filter((f) => answers[f.id] === undefined);
  const nextField = unanswered[0] ?? null;

  const answeredBlock =
    answered.length > 0
      ? answered
          .map((f) => `  - ${f.label} (${f.id}): ${answers[f.id]}`)
          .join("\n")
      : "  None yet.";

  const unansweredBlock =
    unanswered.length > 0
      ? unanswered
          .map((f) => {
            let line = `  - ${f.label} (${f.id}), type: ${f.value_kind}`;
            if (f.options?.length) line += `, options: ${f.options.join(", ")}`;
            if (f.collect_hint) line += ` [hint: ${f.collect_hint}]`;
            return line;
          })
          .join("\n")
      : "  All collected.";

  const nextInstruction = nextField
    ? `After addressing the applicant's message, ask this question next: "${nextField.label}"`
    : "All screening questions have been collected. Thank the applicant and let them know their application is complete and will be reviewed.";

  const rulesBlock =
    rules.length > 0
      ? rules
          .map((r) => {
            const field = fields.find((f) => f.id === r.fieldId);
            return field
              ? `  - ${field.label} ${r.operator} ${r.value}`
              : null;
          })
          .filter(Boolean)
          .join("\n")
      : "  None defined.";

  const groundingInstruction =
    ai.unknownInfoBehavior === "ignore"
      ? "Do not answer questions about details not covered above. Redirect the applicant back to the screening questions."
      : "Only answer property questions using the property description and applicant-facing summary above. If the information is not there, say you don't have that detail and suggest contacting the landlord. Never invent details.";


  let prompt = `You are a warm and professional rental screening assistant for the following property.

Property: ${title}
---
${description}
---

ELIGIBILITY REQUIREMENTS:
${rulesBlock}

COLLECTED SO FAR:
${answeredBlock}

STILL NEED:
${unansweredBlock}

YOUR JOB:
1. ${groundingInstruction}
2. Extract ALL screening values from the applicant's message — for BOTH unanswered fields AND corrections to already-collected fields. If the applicant contradicts a previous answer (e.g. changes "no pets" to "I have a bird"), you MUST extract the updated value. Values should be plain strings: numbers like "3500", booleans as "true" or "false".
3. ${nextInstruction}

Keep your reply concise and conversational. One question at a time.

ENDING CONVERSATIONS:
Set end_conversation to true when the conversation is no longer productive:
- The applicant repeatedly refuses to provide required information after being asked 2+ times.
- The applicant is clearly uncooperative, trolling, or not genuinely applying.
- The conversation has stalled and isn't making progress toward completing the screening.
When ending, your closing message MUST include the specific reason why the conversation is being closed (e.g. "because we weren't able to collect the required information" or "because the property requires no pets"). Then thank them for their time and let them know they can start a new conversation if they change their mind.
In all other cases, set end_conversation to false.`;

  if (ai.style) {
    prompt += `\n\nLANDLORD STYLE INSTRUCTIONS:\n${ai.style}`;
  }

  if (ai.examples?.length) {
    const pairs = ai.examples
      .filter((e) => e.user.trim() && e.assistant.trim())
      .map((e) => `Tenant: "${e.user}"\nYou: "${e.assistant}"`)
      .join("\n\n");
    if (pairs) {
      prompt += `\n\nEXAMPLE CONVERSATIONS (match this style):\n${pairs}`;
    }
  }

  return prompt;
}

// ─── POST handler ───────────────────────────────────────────────────

export async function POST(req: Request) {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "CLAUDE_API_KEY is not set" },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const rec = body as Record<string, unknown>;

  const title =
    typeof rec.title === "string" ? rec.title.trim() : "Rental Property";
  const description =
    typeof rec.description === "string" ? rec.description.trim() : "";
  const fields = Array.isArray(rec.fields)
    ? (rec.fields as LandlordField[])
    : [];
  const rules = Array.isArray(rec.rules)
    ? (rec.rules as LandlordRule[])
    : [];
  const answers =
    rec.answers && typeof rec.answers === "object"
      ? (rec.answers as Record<string, string>)
      : {};
  const messages = Array.isArray(rec.messages)
    ? (rec.messages as IncomingMessage[])
    : [];
  const sessionId = typeof rec.sessionId === "string" ? rec.sessionId : null;
  const propertyId =
    typeof rec.propertyId === "string" ? rec.propertyId : null;
  const clarificationPending = rec.clarificationPending === true;
  const offTopicCount =
    typeof rec.offTopicCount === "number" ? rec.offTopicCount : 0;
  const qualifiedFollowUpCount =
    typeof rec.qualifiedFollowUpCount === "number"
      ? rec.qualifiedFollowUpCount
      : 0;
  const isQualified = rec.isQualified === true;
  const ai = resolveAiInstructions(
    rec.aiInstructions as Partial<AiInstructions> | undefined,
  );

  if (messages.length === 0) {
    return NextResponse.json(
      { error: "No messages provided" },
      { status: 400 },
    );
  }

  // ── PHASE 1: Extract fields ──

  const extractSystem = buildSystemPrompt(
    title, description, fields, rules, answers, ai,
  );

  let extractData;
  try {
    extractData = await callClaude(key, {
      system: extractSystem + "\n\nYour only job right now is to extract field values from the applicant's latest message. Do not write a reply.",
      messages,
      tools: [EXTRACT_TOOL],
      tool_choice: { type: "tool", name: "extract_fields" },
    });
  } catch (err) {
    if (err instanceof ClaudeApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const extractBlock = extractData.content?.find((b) => b.type === "tool_use");
  const extractInput = extractBlock?.input as {
    extracted?: Extraction[];
    message_relevant?: boolean;
  } | undefined;

  const rawExtracted = Array.isArray(extractInput?.extracted) ? extractInput.extracted : [];
  const messageRelevant = extractInput?.message_relevant !== false;

  // ── Validate extractions ──

  const extracted: Extraction[] = [];
  for (const ex of rawExtracted) {
    const field = fields.find((f) => f.id === ex.fieldId);
    if (!field) continue;
    if (!isValidExtraction(ex.value, field.value_kind, field.options)) {
      console.warn(
        `[chat] Dropped invalid extraction: ${ex.fieldId}="${ex.value}" (expected ${field.value_kind})`,
      );
      continue;
    }
    extracted.push(ex);
  }

  // ── Merge answers + evaluate rules ──

  const mergedAnswers = { ...answers };
  for (const { fieldId, value } of extracted) {
    mergedAnswers[fieldId] = value;
  }

  const violations = evaluateRules(rules, fields, mergedAnswers);
  const firstViolation = violations[0] ?? null;
  const allCollected =
    fields.length > 0 &&
    fields.every((f) => mergedAnswers[f.id] !== undefined);

  // ── Determine session status ──

  let sessionStatus:
    | "in_progress"
    | "clarifying"
    | "rejected"
    | "qualified"
    | "completed" = "in_progress";

  // Build context for the response call based on rule evaluation
  let responseContext = "";

  if (firstViolation) {
    const req = describeViolation(firstViolation);
    if (clarificationPending) {
      sessionStatus = "rejected";
      responseContext = `\n\nIMPORTANT — REJECTION:\nThe applicant still doesn't meet this requirement: ${req}. They were already given a chance to clarify. Kindly let them know you can't move forward — state the specific reason and wish them well.`;
    } else {
      sessionStatus = "clarifying";
      responseContext = `\n\nIMPORTANT — ELIGIBILITY CONCERN:\nThe applicant's answer doesn't meet this requirement: ${req}. Gently let them know about the issue and give them a chance to correct themselves. Describe the requirement in natural, human-friendly language.`;
    }
  } else if (isQualified || allCollected) {
    const followUps = qualifiedFollowUpCount + (isQualified ? 1 : 0);
    const limit = ai.qualifiedFollowUps;

    if (
      (limit === 0 && isQualified) ||
      (limit > 0 && followUps >= limit) ||
      (!messageRelevant && isQualified)
    ) {
      sessionStatus = "completed";
    } else {
      sessionStatus = "qualified";
    }
  }

  // ── PHASE 2: Generate response (with full context) ──

  const respondSystem = buildSystemPrompt(
    title, description, fields, rules, mergedAnswers, ai,
  ) + responseContext;

  let respondData;
  try {
    respondData = await callClaude(key, {
      system: respondSystem,
      messages,
      tools: [RESPOND_TOOL],
      tool_choice: { type: "tool", name: "screen_response" },
    });
  } catch (err) {
    if (err instanceof ClaudeApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const respondBlock = respondData.content?.find((b) => b.type === "tool_use");
  const respondInput = respondBlock?.input as {
    reply?: string;
    end_conversation?: boolean;
  } | undefined;

  const reply = respondInput?.reply ?? "I'm sorry, something went wrong. Could you try again?";
  const endConversation = respondInput?.end_conversation === true;

  // AI-driven end_conversation overrides status
  if (endConversation && sessionStatus === "in_progress") {
    sessionStatus = "rejected";
  }

  // ── Persist to Supabase (best-effort) ──

  const dbStatus =
    sessionStatus === "rejected"
      ? "rejected"
      : sessionStatus === "qualified" || sessionStatus === "completed"
        ? "qualified"
        : "in_progress";

  if (sessionId) {
    try {
      const db = createServiceClient();
      const lastUserMsg = [...messages]
        .reverse()
        .find((m) => m.role === "user");

      await db.from("sessions").upsert(
        {
          id: sessionId,
          listing_title: title,
          status: dbStatus,
          answers: mergedAnswers,
          message_count: messages.length + 1,
          property_id: propertyId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );

      const toInsert = [];
      if (lastUserMsg) {
        toInsert.push({
          session_id: sessionId,
          role: "user",
          content: lastUserMsg.content,
        });
      }
      toInsert.push({
        session_id: sessionId,
        role: "assistant",
        content: reply,
        extracted: extracted.length ? extracted : null,
      });
      await db.from("messages").insert(toInsert);
    } catch (err) {
      console.error("[chat] Supabase write failed:", err);
    }
  }

  return NextResponse.json({
    reply,
    extracted,
    sessionStatus,
  });
}
