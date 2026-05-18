/**
 * Fields defined by the landlord for this listing (no global catalog).
 * Used for UI and future validation / question generation.
 */
export const FIELD_VALUE_KINDS = [
  "text",
  "number",
  "date",
  "boolean",
  "enum",
] as const;

export type FieldValueKind = (typeof FIELD_VALUE_KINDS)[number];

export type LandlordField = {
  id: string;
  label: string;
  value_kind: FieldValueKind;
  collect_hint?: string;
  /** Required when value_kind is "enum": allowed choices for the applicant */
  options?: string[];
  /** Permanent fields cannot be deleted or reordered below position 0 */
  permanent?: boolean;
};

/** The built-in name field — always present on every property */
export const NAME_FIELD: LandlordField = {
  id: "name",
  label: "Full Name",
  value_kind: "text",
  permanent: true,
};

const ID_RE = /^[a-z][a-z0-9_]*$/;

export function validateLandlordFieldId(id: string): string | null {
  const t = id.trim();
  if (!t) return "Id is required";
  if (!ID_RE.test(t)) {
    return "Use snake_case: letters, numbers, underscores; start with a letter";
  }
  return null;
}

export function validateLandlordFieldLabel(label: string): string | null {
  if (!label.trim()) return "Label is required";
  return null;
}

/** Normalize option strings: trim, drop empties, enforce uniqueness + min count */
export function normalizeEnumOptions(options: string[] | undefined): string[] {
  if (!options?.length) return [];
  const trimmed = options.map((o) => o.trim()).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of trimmed) {
    const key = o.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(o);
  }
  return out;
}

export function validateEnumOptions(options: string[] | undefined): string | null {
  const normalized = normalizeEnumOptions(options);
  if (normalized.length < 2) {
    return "Options: add at least two different choices";
  }
  return null;
}
