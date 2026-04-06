import type { LandlordField } from "./landlord-field";
import type { LandlordRule } from "./landlord-rule";

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

export type RuleViolation = {
  rule: LandlordRule;
};

/**
 * Evaluates an AND block of conditions.
 * Returns true if ALL conditions match.
 * Returns false if ANY condition definitely fails.
 * Returns null if the block could still match but depends on missing answers.
 */
export function evaluateRule(
  rule: LandlordRule,
  fields: LandlordField[],
  answers: Record<string, string>
): boolean | null {
  if (!rule.conditions || rule.conditions.length === 0) return false;

  let hasUnknown = false;

  for (const cond of rule.conditions) {
    const actual = answers[cond.fieldId];
    if (actual === undefined) {
      hasUnknown = true;
      continue;
    }

    const field = fields.find((f) => f.id === cond.fieldId);
    if (!field) {
      hasUnknown = true;
      continue;
    }

    if (!satisfies(actual, cond.operator, cond.value, field.value_kind)) {
      return false; // one false makes the AND block false
    }
  }

  if (hasUnknown) return null;
  return true;
}

/**
 * Returns every rejection rule that evaluates to TRUE (meaning the applicant hit a rejection criteria).
 * Rules with unanswered fields return null and are skipped.
 */
export function evaluateRules(
  rules: LandlordRule[],
  fields: LandlordField[],
  answers: Record<string, string>,
): RuleViolation[] {
  const violations: RuleViolation[] = [];

  for (const rule of rules) {
    if (rule.action !== "reject") continue;
    const isMet = evaluateRule(rule, fields, answers);
    if (isMet === true) {
      violations.push({ rule });
    }
  }

  return violations;
}

const OP_PHRASES: Record<string, string> = {
  "==":  "is equal to",
  "!=":  "is not equal to",
  ">":   "is greater than",
  ">=":  "is at least",
  "<":   "is less than",
  "<=":  "is at most",
};

const DATE_OP_PHRASES: Record<string, string> = {
  "==":  "is on",
  "!=":  "is not on",
  ">":   "is after",
  ">=":  "is on or after",
  "<":   "is before",
  "<=":  "is on or before",
};

/** Human-readable description of a rule, e.g. "Monthly income is at most 3000 AND Credit is less than 600" */
export function describeViolation(v: RuleViolation, fields: LandlordField[]): string {
  const parts = v.rule.conditions.map(cond => {
    const field = fields.find(f => f.id === cond.fieldId);
    if (!field) return `[Unknown field] ${cond.operator} ${cond.value}`;

    if (field.value_kind === "boolean") {
      const label = field.label.replace(/\?$/, "").trim();
      const expected = cond.value === "true";
      if (cond.operator === "==") return `"${label}" is ${expected ? "Yes" : "No"}`;
      if (cond.operator === "!=") return `"${label}" is not ${expected ? "Yes" : "No"}`;
    }

    const phrases = field.value_kind === "date" ? DATE_OP_PHRASES : OP_PHRASES;
    const phrase = phrases[cond.operator] ?? cond.operator;
    return `${field.label} ${phrase} ${cond.value}`;
  });

  return parts.join(" AND ");
}
