import type { LandlordField } from "@/lib/landlord-field";
import type { Question } from "@/lib/question";
import type { AiInstructions, PropertyVariable } from "@/lib/property";

export type ChatPropertyFixture = {
  title?: string;
  description?: string;
  fields: LandlordField[];
  questions: Question[];
  variables?: PropertyVariable[];
  aiInstructions?: Partial<AiInstructions>;
};

export type ChatTestCase = {
  id: string;
  name: string;
  description: string;
  property: ChatPropertyFixture;
  /** Optional pre-existing answers (start the test mid-interview). */
  initialAnswers?: Record<string, string>;
  /** Optional pre-existing transcript (e.g. earlier landlord/applicant exchange). */
  initialMessages?: { role: "user" | "assistant"; content: string }[];
  /** User messages sent in order. The runner replays the assistant's reply between each. */
  userMessages: string[];
  /** What the LLM evaluator should verify about the final state. */
  requirements: string[];
};

// Common helpers for fixtures
const FIELD_INCOME: LandlordField = { id: "monthly_income", label: "Monthly income", value_kind: "number" };
const FIELD_PETS: LandlordField   = { id: "has_pets", label: "Do you have any pets?", value_kind: "boolean" };
const FIELD_SMOKES: LandlordField = { id: "smokes", label: "Do you smoke?", value_kind: "boolean" };
const FIELD_NAME: LandlordField   = { id: "applicant_name", label: "Your name", value_kind: "text" };
const FIELD_MOVE_DATE: LandlordField = { id: "move_in_date", label: "Desired move-in date", value_kind: "date" };

const Q = (
  id: string, text: string, fieldIds: string[], sort_order = 0, branches: Question["branches"] = []
): Question => ({ id, text, fieldIds, sort_order, branches });

export const chatTestCases: ChatTestCase[] = [
  // ─── 1. Style enforcement ───────────────────────────────────────
  {
    id: "style_concise",
    name: "Concise style — assistant respects length constraint",
    description: "Verifies that aiInstructions.style enforcing brevity is followed.",
    property: {
      title: "Studio Apartment",
      description: "A cozy studio in the city. Available Sept 1.",
      fields: [FIELD_INCOME],
      questions: [Q("q_income", "What is your monthly income?", ["monthly_income"])],
      aiInstructions: {
        style: "Be extremely concise. Replies must be one short sentence, under 15 words. No filler, no pleasantries beyond a 1-word greeting.",
      },
    },
    userMessages: [
      "Hi, I'm interested in renting this place. Can you tell me a bit about yourselves and the screening process you use?",
    ],
    requirements: [
      "The assistant's reply must be 25 words or fewer (allowing some buffer over the 15-word style guideline).",
      "Despite the chatty user message, the reply should redirect to the screening question (about income) within those 25 words.",
    ],
  },

  // ─── 2. Branch outcome: reject ──────────────────────────────────
  {
    id: "outcome_branch_reject",
    name: "Outcome: branch reject (smoking not allowed)",
    description: "An answer that triggers a branch with outcome='reject' must end the session as rejected.",
    property: {
      title: "Non-smoking unit",
      description: "Strictly non-smoking property.",
      fields: [FIELD_SMOKES],
      questions: [
        Q("q_smokes", "Do you smoke?", ["smokes"], 0, [
          {
            id: "b_smoker",
            condition: { fieldId: "smokes", operator: "==", value: "true" },
            outcome: "reject",
            subQuestions: [],
          },
        ]),
      ],
    },
    userMessages: ["Yes, I do smoke."],
    requirements: [
      "The 'smokes' field must be extracted with value 'true'.",
      "Final sessionStatus must be 'rejected'.",
      "The reply should communicate that the application can't proceed (rejection), without being aggressive.",
    ],
  },

  // ─── 3. Qualified ──────────────────────────────────────────────
  {
    id: "outcome_qualified",
    name: "Outcome: qualified (all questions answered)",
    description: "When the interview is complete, the session must be qualified.",
    property: {
      fields: [FIELD_NAME, FIELD_INCOME],
      questions: [
        Q("q_name", "What is your name?", ["applicant_name"], 0),
        Q("q_income", "What is your monthly income?", ["monthly_income"], 1),
      ],
    },
    initialAnswers: { applicant_name: "Alex" },
    userMessages: ["My income is 5000 a month."],
    requirements: [
      "monthly_income must be extracted as 5000.",
      "Final sessionStatus must be 'qualified' or 'completed' (interview finished).",
    ],
  },

  // ─── 4. Off-topic rejection ─────────────────────────────────────
  {
    id: "outcome_off_topic_reject",
    name: "Outcome: off-topic limit triggers rejection",
    description: "With offTopicLimit=1, a single off-topic message must close the session as rejected.",
    property: {
      title: "Studio for rent",
      description: "Two-bedroom available downtown.",
      fields: [FIELD_INCOME],
      questions: [Q("q_income", "What is your monthly income?", ["monthly_income"])],
      aiInstructions: { offTopicLimit: 1 },
    },
    userMessages: ["What's your favorite color? Also can you recommend some good Italian restaurants nearby?"],
    requirements: [
      "Final sessionStatus must be 'rejected' (off-topic limit was 1 and the user's first message is clearly off-topic).",
      "The reply should redirect/close politely rather than answer the off-topic question.",
    ],
  },

  // ─── 5. Multi-field extraction ──────────────────────────────────
  {
    id: "extract_multiple_fields",
    name: "Extract: assistant pulls multiple field values from one message",
    description: "When the user volunteers several field values at once, all should be extracted in a single turn.",
    property: {
      fields: [FIELD_NAME, FIELD_INCOME, FIELD_MOVE_DATE, FIELD_PETS],
      questions: [
        Q("q_name", "What's your name?", ["applicant_name"], 0),
        Q("q_income", "Monthly income?", ["monthly_income"], 1),
        Q("q_move_date", "Desired move-in date?", ["move_in_date"], 2),
        Q("q_pets", "Any pets?", ["has_pets"], 3),
      ],
    },
    userMessages: [
      "Hi, I'm Sam, I make about 4200 a month, I'd like to move in around 2025-06-15, and yes I have a cat.",
    ],
    requirements: [
      "applicant_name must be extracted as 'Sam'.",
      "monthly_income must be extracted as a number around 4200.",
      "move_in_date must be extracted as 2025-06-15 (or equivalent ISO date).",
      "has_pets must be extracted as 'true'.",
      "All four fields must be extracted in this single turn.",
    ],
  },

  // ─── 6. Question flow order ─────────────────────────────────────
  {
    id: "question_flow_order",
    name: "Flow: assistant asks questions in sort_order across turns",
    description: "Across multiple turns, the assistant asks question 1 first, then question 2 once the first is answered.",
    property: {
      fields: [FIELD_NAME, FIELD_INCOME],
      questions: [
        Q("q_name", "What is your name?", ["applicant_name"], 0),
        Q("q_income", "What is your monthly income?", ["monthly_income"], 1),
      ],
    },
    userMessages: [
      "Hi, I'd like to apply.",
      "I'm Jordan.",
    ],
    requirements: [
      "After the first user message ('Hi, I'd like to apply.'), the assistant's reply must ask for the applicant's name (not income).",
      "After the second user message ('I'm Jordan.'), applicant_name must be extracted as 'Jordan' and the assistant's reply must ask for monthly income next.",
    ],
  },
];
