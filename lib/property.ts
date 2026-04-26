import type { LandlordField } from "./landlord-field";
import type { LandlordRule } from "./landlord-rule";
import type { Question } from "./question";

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
};

export const DEFAULT_AI_INSTRUCTIONS: AiInstructions = {
  style: "",
  examples: [],
  offTopicLimit: 3,
  qualifiedFollowUps: 3,
  unknownInfoBehavior: "deflect",
  clarificationPrompt: "Let the applicant know their answer doesn't meet the requirement and give them a chance to correct it.",
  rejectionPrompt: "Let the applicant know they don't meet the requirement, state the reason, and close the conversation.",
};

/** Merge partial/missing settings with defaults */
export function resolveAiInstructions(
  raw: Partial<AiInstructions> | null | undefined,
): AiInstructions {
  return { ...DEFAULT_AI_INSTRUCTIONS, ...raw };
}

export const DEFAULT_MAX_FIELDS_PER_QUESTION = 3;

export type PropertyVariable = {
  id: string; // e.g. "date_available"
  value: string; // e.g. "June 1st, 2026"
};

/** Raw shape as stored in the `properties` table */
export type PropertyRecord = {
  id: string;
  user_id: string;
  title: string;
  description: string;
  /** Custom landlord-defined variables for text interpolation */
  variables: PropertyVariable[];
  /** Canonical data fields (the truth layer) */
  fields: LandlordField[];
  /** Ordered questions for the interview flow (maps to fields via fieldIds) */
  questions: Question[];
  /** Deterministic rules over fields */
  rules: LandlordRule[];
  links: PropertyLinks;
  ai_instructions: AiInstructions;
  /** AI + UI cap for how many fields one question may collect */
  max_fields_per_question: number;
  /** When set, applicant-facing chat and share link are allowed. Omitted/null = draft only. */
  published_at?: string | null;
  created_at: string;
  updated_at: string;
};

/** Interpolate variables into a string, replacing {{var_id}} with the variable's value */
export function interpolateVariables(text: string, variables: PropertyVariable[]): string {
  if (!text || variables.length === 0) return text;
  return text.replace(/\{\{([^}]+)\}\}/g, (match, p1) => {
    const key = p1.trim();
    const variable = variables.find(v => v.id === key);
    return variable ? variable.value : match;
  });
}
