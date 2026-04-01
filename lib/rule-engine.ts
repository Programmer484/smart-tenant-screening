import type { LandlordField } from "./landlord-field";
import type { LandlordRule } from "./landlord-rule";

export type RuleViolation = {
  rule: LandlordRule;
  field: LandlordField;
  actualValue: string;
};

/** Evaluates a single rule. Returns true if the applicant PASSES. */
function satisfies(
  actual: string,
  operator: string,
  target: string,
  value_kind: LandlordField["value_kind"],
): boolean {
  if (value_kind === "number") {
    const a = Number(actual);
    const t = Number(target);
    if (isNaN(a) || isNaN(t)) return true;
    switch (operator) {
      case "==": return a === t;
      case "!=": return a !== t;
      case ">":  return a > t;
      case ">=": return a >= t;
      case "<":  return a < t;
      case "<=": return a <= t;
    }
  }

  if (value_kind === "date") {
    const a = Date.parse(actual);
    const t = Date.parse(target);
    if (isNaN(a) || isNaN(t)) return true;
    switch (operator) {
      case "==": return a === t;
      case "!=": return a !== t;
      case ">":  return a > t;
      case ">=": return a >= t;
      case "<":  return a < t;
      case "<=": return a <= t;
    }
  }

  if (value_kind === "boolean") {
    return actual.toLowerCase() === target.toLowerCase();
  }

  // text / enum — case-insensitive
  switch (operator) {
    case "==": return actual.toLowerCase() === target.toLowerCase();
    case "!=": return actual.toLowerCase() !== target.toLowerCase();
  }

  return true;
}

/**
 * Returns every violated rule where the applicant has already provided an answer.
 * Rules for unanswered fields are skipped.
 */
export function evaluateRules(
  rules: LandlordRule[],
  fields: LandlordField[],
  answers: Record<string, string>,
): RuleViolation[] {
  const violations: RuleViolation[] = [];

  for (const rule of rules) {
    const actual = answers[rule.fieldId];
    if (actual === undefined) continue;

    const field = fields.find((f) => f.id === rule.fieldId);
    if (!field) continue;

    if (!satisfies(actual, rule.operator, rule.value, field.value_kind)) {
      violations.push({ rule, field, actualValue: actual });
    }
  }

  return violations;
}

const OP_PHRASES: Record<string, string> = {
  "==":  "must be",
  "!=":  "must not be",
  ">":   "must be greater than",
  ">=":  "must be at least",
  "<":   "must be less than",
  "<=":  "must be at most",
};

const DATE_OP_PHRASES: Record<string, string> = {
  "==":  "must be on",
  "!=":  "must not be on",
  ">":   "must be after",
  ">=":  "must be on or after",
  "<":   "must be before",
  "<=":  "must be on or before",
};

/** Human-readable description of a rule, e.g. "Monthly income must be at least 3000" */
export function describeViolation(v: RuleViolation): string {
  if (v.field.value_kind === "boolean") {
    const label = v.field.label.replace(/\?$/, "").trim();
    const expected = v.rule.value === "true";
    if (v.rule.operator === "==" || v.rule.operator === "!=") {
      const shouldBe = v.rule.operator === "==" ? expected : !expected;
      return shouldBe
        ? `applicants must be able to answer "yes" to: ${v.field.label}`
        : `applicants must answer "no" to: ${v.field.label}`;
    }
  }
  const phrases = v.field.value_kind === "date" ? DATE_OP_PHRASES : OP_PHRASES;
  const phrase = phrases[v.rule.operator] ?? v.rule.operator;
  return `${v.field.label} ${phrase} ${v.rule.value}`;
}
