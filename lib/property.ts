import type { LandlordField, FieldValueKind } from "./landlord-field";
import type { Question } from "./question";

export type PropertyStatus = "draft" | "published";

export type PropertyLinks = {
  videoUrl: string;
  bookingUrl: string;
};

export const DEFAULT_LINKS: PropertyLinks = { videoUrl: "", bookingUrl: "" };

export type AiExample = { user: string; assistant: string };
export type AiInstructions = {
  style: string;
  examples: AiExample[];
  /** Off-topic messages before auto-rejection (0 = unlimited) */
  offTopicLimit: number;
  /** Follow-up messages allowed after qualification (0 = close immediately) */
  qualifiedFollowUps: number;
  /** How to handle questions not covered by the property description */
  unknownInfoBehavior: "deflect" | "ignore";
  /** Instruction for the AI when an applicant's answer first fails a rule */
  clarificationPrompt: string;
  /** Instruction for the AI when an applicant still fails after clarification */
  rejectionPrompt: string;
  /** Custom opening instruction when the applicant's name is known */
  greetingWithName: string;
  /** Custom opening instruction when the applicant's name is unknown */
  greetingWithoutName: string;
};

export const DEFAULT_AI_INSTRUCTIONS: AiInstructions = {
  style: "",
  examples: [],
  offTopicLimit: 3,
  qualifiedFollowUps: 3,
  unknownInfoBehavior: "deflect",
  clarificationPrompt: "Let the applicant know their answer doesn't meet the requirement and give them a chance to correct it.",
  rejectionPrompt: "Let the applicant know they don't meet the requirement, state the reason, and close the conversation.",
  greetingWithName: "",
  greetingWithoutName: "",
};

/** Merge partial/missing settings with defaults */
export function resolveAiInstructions(
  raw: Partial<AiInstructions> | null | undefined,
): AiInstructions {
  return { ...DEFAULT_AI_INSTRUCTIONS, ...raw };
}

export type PropertyVariable = {
  id: string;
  key: string;
  label: string;
  value: string;
  value_kind?: FieldValueKind;
};

export type PublishedState = {
  title: string;
  description: string;
  fields: LandlordField[];
  questions: Question[];
  links: PropertyLinks;
  ai_instructions: AiInstructions;
  variables: PropertyVariable[];
};

/** Raw shape as stored in the `properties` table */
export type PropertyRecord = {
  id: string;
  user_id: string;
  slug: string;
  status: PropertyStatus;
  title: string;
  description: string;
  /** Canonical data fields (the truth layer) */
  fields: LandlordField[];
  /** Ordered questions for the interview flow, with conditional branches */
  questions: Question[];
  links: PropertyLinks;
  ai_instructions: AiInstructions;
  /** Landlord-defined template variables inserted into question text */
  variables: PropertyVariable[];
  published_state?: PublishedState | null;
  created_at: string;
  updated_at: string;
};
