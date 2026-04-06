import type { FieldValueKind, LandlordField } from "./landlord-field";

/**
 * Comparison operators available for each field value type.
 * The rule engine evaluates these deterministically — no AI involvement.
 */
export const OPERATORS_BY_KIND: Record<FieldValueKind, readonly string[]> = {
  number: ["==", "!=", ">", ">=", "<", "<="],
  boolean: ["=="],
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

export type RuleAction = "reject" | "ask";

export type LandlordRule = {
  /** Unique id for this rule row */
  id: string;
  action: RuleAction;
  /** The field to ask if action === "ask" */
  targetFieldId?: string;
  /** Evaluated with AND logic */
  conditions: RuleCondition[];
};

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
  if (rule.action === "ask" && !rule.targetFieldId) return "Select a question to ask";
  if (rule.conditions.length === 0) return "Add at least one condition";
  for (const c of rule.conditions) {
    const err = validateCondition(c, fields);
    if (err) return err;
  }
  return null;
}
