import { NextResponse } from "next/server";
import type { LandlordField, FieldValueKind } from "@/lib/landlord-field";
import { normalizeRulesList, type LandlordRule } from "@/lib/landlord-rule";
import type { Question } from "@/lib/question";
import type { AiInstructions, PropertyLinks } from "@/lib/property";
import { resolveAiInstructions, DEFAULT_LINKS } from "@/lib/property";
import { createServiceClient } from "@/lib/supabase/service";
import { evaluateRules, evalBranchCondition, describeViolation } from "@/lib/rule-engine";
import { callClaude, ClaudeApiError } from "@/lib/anthropic";

type IncomingMessage = { role: "user" | "assistant"; content: string };
type Extraction = { fieldId: string; value: string };

// ─── Tool definitions ────────────────────────────────────────────────────────

const EXTRACT_TOOL = {
  name: "extract_fields",
  description:
    "Extract screening field values from the applicant's message. Only extract into known field IDs.",
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
          "true ONLY if the applicant is explicitly hostile, refuses to answer after multiple attempts, or spamming. NEVER set this to true simply because you finished collecting all questions. If the interview is complete, set this to false.",
      },
    },
    required: ["reply", "end_conversation"],
  },
};

// ─── Value validation ─────────────────────────────────────────────────────────

function isValidExtraction(
  value: string,
  kind: FieldValueKind,
  options?: string[],
): boolean {
  switch (kind) {
    case "number":  return !isNaN(Number(value));
    case "boolean": return ["true", "false"].includes(value.toLowerCase());
    case "date":    return !isNaN(Date.parse(value));
    case "enum":    return (options ?? []).some((o) => o.toLowerCase() === value.toLowerCase());
    case "text":    return true;
    default:        return true;
  }
}

// ─── Tree walker ──────────────────────────────────────────────────────────────

type WalkResult = {
  nextQuestion: Question | null;
  /** Non-null when a branch outcome ends the interview early. */
  branchOutcome: "reject" | "review" | null;
};

/**
 * Walks the question tree depth-first in sort_order and returns:
 * - The next question that still needs its fields answered, OR
 * - A branch-level outcome (reject/review) that overrides normal flow.
 *
 * "Continue" and "followups" outcomes keep the walk going;
 * sub-questions from a matched "followups" branch are walked before
 * moving on to the next sibling question.
 */
function walkTree(
  qs: Question[],
  fields: LandlordField[],
  answers: Record<string, string>,
): WalkResult {
  const sorted = [...qs].sort((a, b) => a.sort_order - b.sort_order);

  for (const q of sorted) {
    const allFilled = q.fieldIds.every((fid) => answers[fid] !== undefined);

    if (!allFilled) {
      return { nextQuestion: q, branchOutcome: null };
    }

    // Question answered — find the first branch whose condition matches
    const matchingBranch = q.branches.find((b) =>
      evalBranchCondition(b.condition, fields, answers),
    );
    const outcome = matchingBranch?.outcome ?? "continue";

    if (outcome === "reject") return { nextQuestion: null, branchOutcome: "reject" };
    if (outcome === "review") return { nextQuestion: null, branchOutcome: "review" };

    if (outcome === "followups" && matchingBranch?.subQuestions.length) {
      const sub = walkTree(matchingBranch.subQuestions, fields, answers);
      // Bubble up any pending question or terminal outcome from the sub-tree
      if (sub.nextQuestion || sub.branchOutcome) return sub;
      // Sub-tree complete — fall through to the next sibling question
    }
    // "continue" or no matching branch: proceed to next question in this level
  }

  return { nextQuestion: null, branchOutcome: null }; // interview complete
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(
  title: string,
  description: string,
  fields: LandlordField[],
  questions: Question[],
  rules: LandlordRule[],
  answers: Record<string, string>,
  ai: AiInstructions,
): string {
  const { nextQuestion } = walkTree(questions, fields, answers);

  // Field schema block
  const fieldSchemaBlock = fields.length > 0
    ? fields
        .map((f) => {
          let line = `  - ${f.id}: ${f.value_kind}`;
          if (f.label) line += ` ("${f.label}")`;
          if (f.options?.length) line += `, options: [${f.options.join(", ")}]`;
          const val = answers[f.id];
          line += val !== undefined ? ` = "${val}" ✅` : ` = ? ❌`;
          return line;
        })
        .join("\n")
    : "  None defined.";

  const answeredFields = fields.filter((f) => answers[f.id] !== undefined);

  // Rejection rules block (global eligibility — still enforced at end)
  const rulesBlock = rules.some((r) => r.kind === "reject")
    ? rules
        .filter((r) => r.kind === "reject")
        .map((r) => {
          const parts = r.conditions
            .map((c) => {
              const f = fields.find((x) => x.id === c.fieldId);
              return f ? `${f.label || f.id} ${c.operator} ${c.value}` : null;
            })
            .filter(Boolean);
          return parts.length > 0 ? `  - Reject if: ${parts.join(" AND ")}` : null;
        })
        .filter(Boolean)
        .join("\n")
    : "  None defined.";

  // Top-level interview flow block
  const questionsBlock = questions.length > 0
    ? [...questions]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((q, i) => {
          const allFilled = q.fieldIds.every((fid) => answers[fid] !== undefined);
          const status = allFilled ? "✅ done" : "❌ pending";
          return `  ${i + 1}. "${q.text}" → fields: [${q.fieldIds.join(", ")}] ${status}`;
        })
        .join("\n")
    : "  None defined.";

  const groundingInstruction =
    ai.unknownInfoBehavior === "ignore"
      ? "Do not answer questions about details not covered above. Redirect the applicant back to the screening questions."
      : "Only answer property questions using the property description above. If the information is not there, say you don't have that detail and suggest contacting the landlord. Never invent details.";

  // Next question instruction — handle partial extraction within a question
  let nextInstruction: string;
  if (nextQuestion) {
    const missingFieldIds = nextQuestion.fieldIds.filter((fid) => answers[fid] === undefined);
    const partiallyAnswered = nextQuestion.fieldIds.some((fid) => answers[fid] !== undefined);

    if (partiallyAnswered && missingFieldIds.length > 0) {
      const missingList = missingFieldIds
        .map((fid) => {
          const f = fields.find((x) => x.id === fid);
          return f ? `"${f.label || f.id}" (${f.id}, type: ${f.value_kind})` : fid;
        })
        .join(", ");
      nextInstruction = `FOLLOW-UP REQUIRED: The applicant's previous answer didn't cover all fields. Ask a follow-up to collect these missing fields: ${missingList}. Be conversational — don't just list the fields, ask naturally.`;
    } else {
      const fieldDetails = missingFieldIds
        .map((fid) => {
          const f = fields.find((x) => x.id === fid);
          return f ? `${f.id} (${f.value_kind})` : fid;
        })
        .join(", ");
      nextInstruction = `NEXT QUESTION: Ask exactly this: "${nextQuestion.text}". This question collects fields: [${fieldDetails}].${nextQuestion.extract_hint ? ` Hint: ${nextQuestion.extract_hint}` : ""}`;
    }
  } else {
    nextInstruction =
      "All screening questions have been collected. Do not ask any more questions. Thank the applicant and let them know their application is complete and will be reviewed.";
  }

  let prompt = `You are a rental screening assistant for "${title}".

PROPERTY:
${description}

FIELD SCHEMA (data to collect):
${fieldSchemaBlock}

INTERVIEW QUESTIONS (ask in this order):
${questionsBlock}

STRICT RULES:
${rulesBlock}

STATUS: ${answeredFields.length}/${fields.length} fields collected.`;

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
- Extract screening values from each message into the FIELD SCHEMA. Values: plain strings, numbers like "3500", booleans as "true"/"false".
- ${nextInstruction}
- NEVER invent new fields or ask about topics not in the FIELD SCHEMA.
- NEVER deviate from the INTERVIEW QUESTIONS order, EXCEPT to follow up on missing fields from a previous question.
- CRITICAL: NEVER evaluate applicant eligibility against the STRICT RULES yourself. The system backend evaluates them automatically.`;

  if (ai.style) {
    prompt += `\n- CRITICAL STYLE ENFORCEMENT: You must adopt the following persona/style explicitly: "${ai.style.trim()}". Tone, formatting, and especially length constraints must be followed strictly on every single message.`;
  }

  return prompt;
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "CLAUDE_API_KEY is not set" }, { status: 500 });
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

  const title       = typeof rec.title === "string" ? rec.title.trim() : "Rental Property";
  const description = typeof rec.description === "string" ? rec.description.trim() : "";
  const fields      = Array.isArray(rec.fields)    ? (rec.fields as LandlordField[]) : [];
  const questions   = Array.isArray(rec.questions) ? (rec.questions as Question[]).map((q) => ({ ...q, branches: q.branches ?? [] })) : [];
  const rules       = Array.isArray(rec.rules)     ? normalizeRulesList(rec.rules) : [];
  const answers     = rec.answers && typeof rec.answers === "object" ? (rec.answers as Record<string, string>) : {};
  const messages    = Array.isArray(rec.messages)  ? (rec.messages as IncomingMessage[]) : [];
  const links: PropertyLinks = { ...DEFAULT_LINKS, ...(rec.links && typeof rec.links === "object" ? rec.links as Partial<PropertyLinks> : {}) };
  const sessionId   = typeof rec.sessionId === "string" ? rec.sessionId : null;
  const propertyId  = typeof rec.propertyId === "string" ? rec.propertyId : null;
  const ai          = resolveAiInstructions(rec.aiInstructions as Partial<AiInstructions> | undefined);

  // ── Load server-authoritative session state ──

  let clarificationPending    = false;
  let offTopicCount           = 0;
  let qualifiedFollowUpCount  = 0;
  let isQualified             = false;

  if (sessionId) {
    const db = createServiceClient();
    const { data: ses } = await db
      .from("sessions")
      .select("status, clarification_pending, off_topic_count, qualified_follow_up_count")
      .eq("id", sessionId)
      .maybeSingle();
    if (ses) {
      clarificationPending   = ses.clarification_pending === true;
      offTopicCount          = ses.off_topic_count ?? 0;
      qualifiedFollowUpCount = ses.qualified_follow_up_count ?? 0;
      isQualified            = ses.status === "qualified";
    }
  }

  if (messages.length === 0) {
    return NextResponse.json({ error: "No messages provided" }, { status: 400 });
  }

  // ── PHASE 1: Extract fields ──

  const extractSystem = buildSystemPrompt(title, description, fields, questions, rules, answers, ai);

  let extractData;
  try {
    extractData = await callClaude(key, {
      system: extractSystem + "\n\nYour only job right now is to extract field values from the applicant's message into the FIELD SCHEMA. Only use field IDs from the schema. If a value was implied earlier but not yet extracted, extract it now. Do not write a reply.",
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
  const extractInput = extractBlock?.input as { extracted?: Extraction[]; message_relevant?: boolean } | undefined;

  const rawExtracted   = Array.isArray(extractInput?.extracted) ? extractInput.extracted : [];
  const messageRelevant = extractInput?.message_relevant !== false;

  // ── Validate extractions ──

  const extracted: Extraction[] = [];
  for (const ex of rawExtracted) {
    const field = fields.find((f) => f.id === ex.fieldId);
    if (!field) { console.warn(`[chat] Dropped unknown field: ${ex.fieldId}`); continue; }
    if (!isValidExtraction(ex.value, field.value_kind, field.options)) {
      console.warn(`[chat] Dropped invalid extraction: ${ex.fieldId}="${ex.value}" (expected ${field.value_kind})`);
      continue;
    }
    extracted.push(ex);
  }

  // ── Merge answers, evaluate rules and tree ──

  const mergedAnswers = { ...answers };
  for (const { fieldId, value } of extracted) {
    mergedAnswers[fieldId] = value;
  }

  const violations    = evaluateRules(rules, fields, mergedAnswers);
  const firstViolation = violations[0] ?? null;

  const { nextQuestion, branchOutcome } = walkTree(questions, fields, mergedAnswers);
  const interviewDone = !nextQuestion && branchOutcome === null;

  // ── Update counters ──

  if (!messageRelevant) {
    offTopicCount += 1;
  } else {
    offTopicCount = 0;
  }

  if (isQualified) {
    qualifiedFollowUpCount += 1;
  }

  // ── Determine session status ──

  type SessionStatus = "in_progress" | "clarifying" | "rejected" | "review" | "qualified" | "completed";
  let sessionStatus: SessionStatus = "in_progress";
  let responseContext = "";

  if (ai.offTopicLimit > 0 && offTopicCount >= ai.offTopicLimit) {
    sessionStatus = "rejected";
    responseContext = `\n\nIMPORTANT — OFF-TOPIC REJECTION:\nThe applicant has sent ${offTopicCount} consecutive off-topic messages (limit: ${ai.offTopicLimit}). Close the conversation and state the reason.`;
  } else if (branchOutcome === "reject") {
    sessionStatus = "rejected";
    responseContext = `\n\nIMPORTANT — REJECTION (BRANCH RULE):\nBased on the applicant's answers, they do not meet the requirements for this listing. ${ai.rejectionPrompt}`;
  } else if (branchOutcome === "review") {
    sessionStatus = "review";
    responseContext = `\n\nIMPORTANT — MANUAL REVIEW:\nThis applicant's answers require manual review by the landlord. Let them know their application has been received and will be reviewed shortly. Close the screening conversation.`;
  } else if (firstViolation) {
    const req = describeViolation(firstViolation, fields);
    if (clarificationPending) {
      sessionStatus = "rejected";
      responseContext = `\n\nIMPORTANT — REJECTION:\nRequirement not met: ${req}. They already had a chance to clarify.\n${ai.rejectionPrompt}`;
    } else {
      sessionStatus = "clarifying";
      responseContext = `\n\nIMPORTANT — ELIGIBILITY CONCERN:\nRequirement not met: ${req}.\n${ai.clarificationPrompt}`;
    }
  } else if (isQualified || interviewDone) {
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

    const linkLines: string[] = [];
    if (links.videoUrl)  linkLines.push(`- Video tour: ${links.videoUrl}`);
    if (links.bookingUrl) linkLines.push(`- Book a viewing: ${links.bookingUrl}`);

    if (linkLines.length > 0) {
      responseContext = `\n\nIMPORTANT — QUALIFIED:\nThe applicant meets all requirements. Share these links:\n${linkLines.join("\n")}\nInclude the full URLs.`;
      if (sessionStatus === "completed") responseContext += `\nThis is the final message.`;
    } else if (sessionStatus === "completed") {
      responseContext = `\n\nIMPORTANT — QUALIFIED (FINAL MESSAGE):\nThe applicant meets all requirements. This is the final message.`;
    } else {
      responseContext = `\n\nNOTE: The applicant is qualified and meets all requirements.`;
    }
  } else if (!messageRelevant && offTopicCount > 0) {
    responseContext = `\n\nNOTE: Off-topic message (${offTopicCount}/${ai.offTopicLimit || "∞"}). Redirect to screening questions.`;
  }

  // ── PHASE 2: Generate response ──

  const respondSystem = buildSystemPrompt(title, description, fields, questions, rules, mergedAnswers, ai) + responseContext;

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
  const respondInput = respondBlock?.input as { reply?: string; end_conversation?: boolean } | undefined;

  const reply           = respondInput?.reply ?? "I'm sorry, something went wrong. Could you try again?";
  const endConversation = respondInput?.end_conversation === true;

  if (endConversation && sessionStatus === "in_progress") {
    sessionStatus = "rejected";
  }

  const nextClarificationPending = sessionStatus === "clarifying";

  // ── Persist to Supabase ──

  const dbStatus =
    sessionStatus === "rejected"                                    ? "rejected" :
    sessionStatus === "review"                                      ? "review"   :
    sessionStatus === "qualified" || sessionStatus === "completed"  ? "qualified" :
    "in_progress";

  if (sessionId) {
    try {
      const db = createServiceClient();
      const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");

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
        toInsert.push({ session_id: sessionId, role: "user", content: lastUserMsg.content });
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
    debugInfo: {
      sessionStatus,
      offTopicCount,
      clarificationPending: nextClarificationPending,
      firstViolation: firstViolation ? describeViolation(firstViolation, fields) : null,
      branchOutcome,
    },
  });
}
