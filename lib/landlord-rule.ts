import type { FieldValueKind, LandlordField } from "./landlord-field";

/**
 * Comparison operators available for each field value type.
 * The rule engine evaluates these deterministically — no AI involvement.
 */
export const OPERATORS_BY_KIND: Record<FieldValueKind, readonly string[]> = {
  number: ["==", "!=", ">", ">=", "<", "<="],
  boolean: ["==", "!="],
  text: ["==", "!="],
  date: ["==", "!=", ">", ">=", "<", "<="],
  enum: ["==", "!="],
};

export const OPERATOR_LABELS: Record<string, string> = {
  "==": "equals",
  "!=": "not equals",
  ">": "greater than",
  ">=": "greater than or equal to",
  "<": "less than",
  "<=": "less than or equal to",
};

const DATE_OPERATOR_LABELS: Record<string, string> = {
  "==": "is on",
  "!=": "is not on",
  ">": "is after",
  ">=": "is on or after",
  "<": "is before",
  "<=": "is on or before",
};

export function operatorLabel(op: string, kind?: FieldValueKind): string {
  if (kind === "date") return DATE_OPERATOR_LABELS[op] ?? op;
  return OPERATOR_LABELS[op] ?? op;
}

export type RuleCondition = {
  id: string;
  fieldId: string;
  operator: string;
  value: string;
};

/** What kind of screening rule this row is (stored as `kind` in JSON). */
export type RuleKind = "reject" | "ask" | "require";

/** @deprecated Use {@link RuleKind} */
export type RuleAction = RuleKind;

export type LandlordRule = {
  /** Unique id for this rule row */
  id: string;
  /** Discriminator: reject / require (eligibility) or ask (field visibility). */
  kind: RuleKind;
  /** When this is a field-visibility rule: which field’s question it applies to */
  targetFieldId?: string;
  /** Evaluated with AND logic */
  conditions: RuleCondition[];
  /** Optional custom message when rule is violated */
  customMessage?: string;
};

/**
 * JSON value for field-visibility rules (when to show a field’s question). Kept as `"ask"` for stored data.
 */
export const RULE_KIND_FIELD_VISIBILITY = "ask" as const satisfies RuleKind;

/** @deprecated Use {@link RULE_KIND_FIELD_VISIBILITY} */
export const RULE_ACTION_FIELD_VISIBILITY = RULE_KIND_FIELD_VISIBILITY;

/** Rules that gate whether a field is included in the interview. */
export function isFieldVisibilityRule(rule: LandlordRule): boolean {
  return rule.kind === RULE_KIND_FIELD_VISIBILITY;
}

/** Normalize a rule object from DB/API (supports legacy `action` key). */
export function normalizeLandlordRule(raw: unknown): LandlordRule | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const kind = (r.kind ?? r.action) as RuleKind | undefined;
  if (kind !== "reject" && kind !== "require" && kind !== "ask") return null;
  if (!Array.isArray(r.conditions)) return null;
  return {
    id: typeof r.id === "string" ? r.id : "",
    kind,
    targetFieldId: typeof r.targetFieldId === "string" ? r.targetFieldId : undefined,
    conditions: r.conditions as LandlordRule["conditions"],
    customMessage: typeof r.customMessage === "string" ? r.customMessage : undefined,
  };
}

function generateCondId(): string {
  return Math.random().toString(36).slice(2, 9);
}

/** Normalize an array of rules from storage (legacy `action`, legacy single-condition rows). */
export function normalizeRulesList(input: unknown): LandlordRule[] {
  if (!Array.isArray(input)) return [];
  const out: LandlordRule[] = [];
  for (const item of input) {
    const n = normalizeLandlordRule(item);
    if (n) {
      out.push(n);
      continue;
    }
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.fieldId === "string" && typeof r.operator === "string" && r.value != null) {
      out.push({
        id: typeof r.id === "string" ? r.id : generateCondId(),
        kind: "reject",
        conditions: [
          {
            id: generateCondId(),
            fieldId: r.fieldId,
            operator: r.operator,
            value: String(r.value),
          },
        ],
      });
    }
  }
  return out;
}

export function defaultOperatorForKind(kind: FieldValueKind): string {
  // Defensive: stale DB/user data may contain unknown value_kind values at runtime.
  return OPERATORS_BY_KIND[kind]?.[0] ?? "==";
}

export function defaultValueForKind(kind: FieldValueKind): string {
  if (kind === "boolean") return "true";
  return "";
}

export function validateCondition(
  cond: RuleCondition,
  fields: LandlordField[],
): string | null {
  if (!cond.fieldId) return "Select a field";
  const field = fields.find((f) => f.id === cond.fieldId);
  if (!field) return "Field not found";
  const ops = OPERATORS_BY_KIND[field.value_kind];
  if (!ops) return `Invalid field type "${field.value_kind}"`;
  if (!ops.includes(cond.operator)) return "Invalid operator for this field type";
  if (!cond.value.trim()) return "Value is required";
  if (field.value_kind === "number" && isNaN(Number(cond.value))) {
    return "Value must be a number";
  }
  if (field.value_kind === "enum" && field.options && !field.options.includes(cond.value)) {
    return "Value must be one of the allowed options";
  }
  return null;
}

export function validateRule(
  rule: LandlordRule,
  fields: LandlordField[],
): string | null {
  if (isFieldVisibilityRule(rule) && !rule.targetFieldId) {
    return "Choose which field this visibility rule applies to";
  }
  if (rule.conditions.length === 0) return "Add at least one condition";
  for (const c of rule.conditions) {
    const err = validateCondition(c, fields);
    if (err) return err;
  }
  return null;
}
