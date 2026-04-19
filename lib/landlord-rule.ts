import type { FieldValueKind, LandlordField } from "./landlord-field";

/**
 * Comparison operators available for each field value type.
 * The rule engine evaluates these deterministically — no AI involvement.
 */
export const OPERATORS_BY_KIND: Record<FieldValueKind, readonly string[]> = {
  number: ["==", "!=", ">", ">=", "<", "<=", "is_empty", "is_not_empty"],
  boolean: ["==", "is_empty", "is_not_empty"],
  text: ["==", "!=", "contains", "is_empty", "is_not_empty"],
  date: ["==", "!=", ">", ">=", "<", "<=", "is_empty", "is_not_empty"],
  enum: ["==", "!=", "is_empty", "is_not_empty"],
};

/** Operators that evaluate against the answer alone — no comparison value needed. */
export const VALUELESS_OPERATORS: ReadonlySet<string> = new Set(["is_empty", "is_not_empty"]);

export const OPERATOR_LABELS: Record<string, string> = {
  "==": "equals",
  "!=": "not equals",
  ">": "greater than",
  ">=": "greater than or equal to",
  "<": "less than",
  "<=": "less than or equal to",
  "contains": "contains",
  "is_empty": "is empty",
  "is_not_empty": "is not empty",
};

const DATE_OPERATOR_LABELS: Record<string, string> = {
  "==": "is on",
  "!=": "is not on",
  ">": "is after",
  ">=": "is on or after",
  "<": "is before",
  "<=": "is on or before",
  "is_empty": "is empty",
  "is_not_empty": "is not empty",
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

/** Screening rule kinds. Field visibility (formerly "ask") now lives on the
 *  Question itself via `parentQuestionId` + `trigger` — see lib/question.ts. */
export type RuleKind = "reject" | "require";

/** @deprecated Use {@link RuleKind} */
export type RuleAction = RuleKind;

export type LandlordRule = {
  /** Unique id for this rule row */
  id: string;
  /** reject (instant fail) or require (acceptance profile, OR'd across rules) */
  kind: RuleKind;
  /** Evaluated with AND logic */
  conditions: RuleCondition[];
};

/** Normalize a rule object from DB/API (supports legacy `action` key).
 *  Legacy `kind: "ask"` field-visibility rules are discarded — visibility now
 *  lives on the Question (parentQuestionId + trigger). */
export function normalizeLandlordRule(raw: unknown): LandlordRule | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const kind = (r.kind ?? r.action) as string | undefined;
  if (kind !== "reject" && kind !== "require") return null;
  if (!Array.isArray(r.conditions)) return null;
  return {
    id: typeof r.id === "string" ? r.id : "",
    kind,
    conditions: r.conditions as LandlordRule["conditions"],
  };
}

function generateCondId(): string {
  return Math.random().toString(36).slice(2, 9);
}

/** Normalize an array of rules from storage. Drops legacy `kind: "ask"` rows. */
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
  if (VALUELESS_OPERATORS.has(cond.operator)) return null;
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
  if (rule.conditions.length === 0) return "Add at least one condition";
  for (const c of rule.conditions) {
    const err = validateCondition(c, fields);
    if (err) return err;
    if (c.fieldId && !fields.find((f) => f.id === c.fieldId)) {
      return "References a missing field";
    }
  }
  return null;
}

export function countInvalidRuleConditions(rules: LandlordRule[], fields: LandlordField[]): number {
  let count = 0;
  for (const r of rules) {
    for (const c of r.conditions) {
      if (validateCondition(c, fields) || (c.fieldId && !fields.find((f) => f.id === c.fieldId))) {
        count++;
      }
    }
  }
  return count;
}

/** First invalid condition id in rule list order (matches Rules UI / `-error` anchor ids). */
export function getFirstInvalidRuleConditionId(rules: LandlordRule[], fields: LandlordField[]): string | null {
  for (const r of rules) {
    for (const c of r.conditions) {
      if (validateCondition(c, fields) || (c.fieldId && !fields.find((f) => f.id === c.fieldId))) {
        return c.id;
      }
    }
  }
  return null;
}
