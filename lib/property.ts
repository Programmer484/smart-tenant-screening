import type { LandlordField } from "./landlord-field";
import type { LandlordRule } from "./landlord-rule";

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
};

export const DEFAULT_AI_INSTRUCTIONS: AiInstructions = {
  style: "",
  examples: [],
  offTopicLimit: 3,
  qualifiedFollowUps: 3,
  unknownInfoBehavior: "deflect",
};

/** Merge partial/missing settings with defaults */
export function resolveAiInstructions(
  raw: Partial<AiInstructions> | null | undefined,
): AiInstructions {
  return { ...DEFAULT_AI_INSTRUCTIONS, ...raw };
}

/** Raw shape as stored in the `properties` table */
export type PropertyRecord = {
  id: string;
  user_id: string;
  title: string;
  description: string;
  /** Ordered list of shared_fields IDs included in this listing */
  shared_field_ids: string[];
  /** Fields defined specifically for this property */
  own_fields: LandlordField[];
  rules: LandlordRule[];
  links: PropertyLinks;
  ai_instructions: AiInstructions;
  created_at: string;
  updated_at: string;
};


/**
 * Merge shared fields + own fields into a single ordered list.
 * All shared fields are included first, then property-specific fields.
 */
export function resolveFields(
  property: Pick<PropertyRecord, "own_fields">,
  sharedFields: LandlordField[],
): LandlordField[] {
  const own = property.own_fields ?? [];
  return [...sharedFields, ...own];
}

