/**
 * Profiles bundle fields + questions together for reuse across properties.
 *
 * A landlord can save a profile (e.g. "Standard Rental") and apply it
 * to any property, which copies the fields + questions into that property.
 */

import type { LandlordField } from "./landlord-field";
import type { Question } from "./question";

export type Profile = {
  /** Unique id (DB primary key) */
  id: string;
  /** Owner user id */
  user_id: string;
  /** Human-readable name, e.g. "Standard Rental" */
  name: string;
  /** Bundled fields (data schema) */
  fields: LandlordField[];
  /** Bundled questions (interview flow, linked to fields) */
  questions: Question[];
  created_at: string;
  updated_at: string;
};
