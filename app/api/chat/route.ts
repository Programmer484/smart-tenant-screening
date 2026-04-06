import { NextResponse } from "next/server";
import type { LandlordField, FieldValueKind } from "@/lib/landlord-field";
import type { LandlordRule } from "@/lib/landlord-rule";
import type { AiInstructions, PropertyLinks } from "@/lib/property";
import { resolveAiInstructions, DEFAULT_LINKS } from "@/lib/property";
import { createServiceClient } from "@/lib/supabase/service";
import { evaluateRules, evaluateRule, describeViolation } from "@/lib/rule-engine";
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

function getActiveFields(
  fields: LandlordField[],
  rules: LandlordRule[],
  answers: Record<string, string>,
): LandlordField[] {
  return fields.filter(f => {
     const askRules = rules.filter(r => r.action === "ask" && r.targetFieldId === f.id);
     if (askRules.length === 0) return true;
     return askRules.some(r => evaluateRule(r, fields, answers) === true);
  });
}

function buildSystemPrompt(
  title: string,
  description: string,
  fields: LandlordField[],
  rules: LandlordRule[],
  answers: Record<string, string>,
  ai: AiInstructions,
): string {
  const activeFields = getActiveFields(fields, rules, answers);
  const answered = fields.filter((f) => answers[f.id] !== undefined);
  const unanswered = activeFields.filter((f) => answers[f.id] === undefined);
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
          .filter(r => r.action === "reject")
          .map((r) => {
            const parts = r.conditions.map((c) => {
              const field = fields.find((f) => f.id === c.fieldId);
              return field ? `${field.label} ${c.operator} ${c.value}` : null;
            }).filter(Boolean);
            return parts.length > 0 ? `  - Reject if: ${parts.join(" AND ")}` : null;
          })
          .filter(Boolean)
          .join("\n")
      : "  None defined.";

  const groundingInstruction =
    ai.unknownInfoBehavior === "ignore"
      ? "Do not answer questions about details not covered above. Redirect the applicant back to the screening questions."
      : "Only answer property questions using the property description and applicant-facing summary above. If the information is not there, say you don't have that detail and suggest contacting the landlord. Never invent details.";


  let prompt = `You are a rental screening assistant for "${title}".

PROPERTY:
${description}

RULES:
${rulesBlock}

COLLECTED: ${answeredBlock}
REMAINING: ${unansweredBlock}`;

  if (ai.style) {
    prompt += `\n\nSTYLE (follow these instructions closely):\n${ai.style}`;
  }

  if (ai.examples?.length) {
    const pairs = ai.examples
      .filter((e) => e.user.trim() && e.assistant.trim())
      .map((e) => `Tenant: "${e.user}"\nYou: "${e.assistant}"`)
      .join("\n\n");
    if (pairs) {
      prompt += `\n\nEXAMPLES (match this tone and style):\n${pairs}`;
    }
  }

  prompt += `\n\nINSTRUCTIONS:
- ${groundingInstruction}
- Extract screening values from each message, including corrections to previous answers. Values: plain strings, numbers like "3500", booleans as "true"/"false".
- ${nextInstruction}
- One question at a time.
- Set end_conversation to true only if the applicant refuses info after 2+ asks, is clearly not applying, or the conversation has stalled. Include the reason in your closing message. Otherwise set it to false.`;

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
  const links: PropertyLinks = {
    ...DEFAULT_LINKS,
    ...(rec.links && typeof rec.links === "object" ? rec.links as Partial<PropertyLinks> : {}),
  };
  const sessionId = typeof rec.sessionId === "string" ? rec.sessionId : null;
  const propertyId =
    typeof rec.propertyId === "string" ? rec.propertyId : null;
  const ai = resolveAiInstructions(
    rec.aiInstructions as Partial<AiInstructions> | undefined,
  );

  // ── Load session state from DB (server-authoritative) ──
  let clarificationPending = false;
  let offTopicCount = 0;
  let qualifiedFollowUpCount = 0;
  let isQualified = false;

  if (sessionId) {
    const db = createServiceClient();
    const { data: ses } = await db
      .from("sessions")
      .select("status, clarification_pending, off_topic_count, qualified_follow_up_count")
      .eq("id", sessionId)
      .maybeSingle();
    if (ses) {
      clarificationPending = ses.clarification_pending === true;
      offTopicCount = ses.off_topic_count ?? 0;
      qualifiedFollowUpCount = ses.qualified_follow_up_count ?? 0;
      isQualified = ses.status === "qualified";
    }
  }

  if (messages.length === 0) {
    return NextResponse.json(
      { error: "No messages provided" },
      { status: 400 },
    );
  }

  // ── PHASE 1: Extract fields ──
  // Only send the last exchange (assistant + user) so the AI focuses on
  // the newest message and doesn't re-extract from old ones.

  const extractSystem = buildSystemPrompt(
    title, description, fields, rules, answers, ai,
  );

  const lastUserIdx = messages.findLastIndex((m) => m.role === "user");
  const extractMessages: IncomingMessage[] = lastUserIdx >= 0
    ? messages.slice(Math.max(0, lastUserIdx - 1))
    : messages;

  let extractData;
  try {
    extractData = await callClaude(key, {
      system: extractSystem + "\n\nYour only job right now is to extract field values from the applicant's latest message. Do not write a reply.",
      messages: extractMessages,
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
  const activeFieldsForCompletion = getActiveFields(fields, rules, mergedAnswers);
  const allCollected =
    activeFieldsForCompletion.length > 0 &&
    activeFieldsForCompletion.every((f) => mergedAnswers[f.id] !== undefined);

  // ── Update counters ──

  if (!messageRelevant) {
    offTopicCount += 1;
  } else {
    offTopicCount = 0; // reset on relevant message
  }

  if (isQualified) {
    qualifiedFollowUpCount += 1;
  }

  // ── Determine session status ──

  let sessionStatus:
    | "in_progress"
    | "clarifying"
    | "rejected"
    | "qualified"
    | "completed" = "in_progress";

  let responseContext = "";

  // Off-topic limit exceeded → reject
  if (ai.offTopicLimit > 0 && offTopicCount >= ai.offTopicLimit) {
    sessionStatus = "rejected";
    responseContext = `\n\nIMPORTANT — OFF-TOPIC REJECTION:\nThe applicant has sent ${offTopicCount} consecutive off-topic messages (limit: ${ai.offTopicLimit}). Close the conversation and state the reason.`;
  } else if (firstViolation) {
    const req = describeViolation(firstViolation, fields);
    if (clarificationPending) {
      sessionStatus = "rejected";
      responseContext = `\n\nIMPORTANT — REJECTION:\nRequirement not met: ${req}. They already had a chance to clarify.\n${ai.rejectionPrompt}`;
    } else {
      sessionStatus = "clarifying";
      responseContext = `\n\nIMPORTANT — ELIGIBILITY CONCERN:\nRequirement not met: ${req}.\n${ai.clarificationPrompt}`;
    }
  } else if (isQualified || allCollected) {
    const limit = ai.qualifiedFollowUps;

    if (
      (limit === 0 && isQualified) ||
      (limit > 0 && qualifiedFollowUpCount >= limit) ||
      (!messageRelevant && isQualified)
    ) {
      sessionStatus = "completed";
    } else {
      sessionStatus = "qualified";
    }

    // Build links context for qualified applicants
    const linkLines: string[] = [];
    if (links.videoUrl) linkLines.push(`- Video tour: ${links.videoUrl}`);
    if (links.bookingUrl) linkLines.push(`- Book a viewing: ${links.bookingUrl}`);
    if (linkLines.length > 0) {
      responseContext = `\n\nIMPORTANT — QUALIFIED:\nThe applicant meets all requirements. Share these links:\n${linkLines.join("\n")}\nInclude the full URLs.`;
      if (sessionStatus === "completed") {
        responseContext += `\nThis is the final message.`;
      }
    } else if (sessionStatus === "completed") {
      responseContext = `\n\nIMPORTANT — QUALIFIED (FINAL MESSAGE):\nThe applicant meets all requirements. This is the final message.`;
    } else {
      responseContext = `\n\nNOTE: The applicant is qualified and meets all requirements.`;
    }
  } else if (!messageRelevant && offTopicCount > 0) {
    responseContext = `\n\nNOTE: Off-topic message (${offTopicCount}/${ai.offTopicLimit || "∞"}). Redirect to screening questions.`;
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

  // Update clarification_pending for next round
  const nextClarificationPending = sessionStatus === "clarifying";

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
          off_topic_count: offTopicCount,
          qualified_follow_up_count: qualifiedFollowUpCount,
          clarification_pending: nextClarificationPending,
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
