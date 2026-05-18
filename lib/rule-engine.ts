import type { LandlordField } from "./landlord-field";
import type { LandlordRule } from "./landlord-rule";
import type { PropertyVariable } from "./property";
import { resolveVarTokens } from "./condition-utils";

// Matches: {{key}}  or  {{key}} +/- N  or  {{key}} +/- {{key2}}
const EXPR_RE = /^\{\{([a-z][a-z0-9_]*)\}\}(?:\s*([+-])\s*(?:(\d+)|\{\{([a-z][a-z0-9_]*)\}\}))?$/;

/**
 * Resolves a condition value that may be a variable expression.
 * Returns the original string if it isn't an expression or the variable is unknown.
 */
export function resolveExpression(
  expr: string,
  variables: PropertyVariable[],
  value_kind: LandlordField["value_kind"],
): string {
  const m = expr.trim().match(EXPR_RE);
  if (!m) return expr;
  const [, key, op, offsetStr, offsetKey] = m;
  const variable = variables.find((v) => v.id === key);
  if (!variable) return expr;
  if (!op) return variable.value;
  let offsetNum: number;
  if (offsetKey !== undefined) {
    const offsetVar = variables.find((v) => v.id === offsetKey);
    if (!offsetVar) return variable.value;
    offsetNum = parseInt(offsetVar.value, 10);
    if (isNaN(offsetNum)) return variable.value;
  } else {
    offsetNum = parseInt(offsetStr, 10);
  }
  if (value_kind === "date") {
    const ts = Date.parse(variable.value);
    if (isNaN(ts)) return variable.value;
    return new Date(ts + (op === "+" ? 1 : -1) * offsetNum * 86_400_000).toISOString().slice(0, 10);
  }
  if (value_kind === "number") {
    const num = Number(variable.value);
    if (isNaN(num)) return variable.value;
    return String(op === "+" ? num + offsetNum : num - offsetNum);
  }
  return variable.value;
}

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
    const match = actual.toLowerCase() === target.toLowerCase();
    return operator === "!=" ? !match : match;
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
  message?: string;
  customMessage?: string;
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
  answers: Record<string, string>,
  variables: PropertyVariable[] = [],
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

    const resolvedValue = variables.length
      ? resolveExpression(cond.value, variables, field.value_kind)
      : cond.value;

    if (!satisfies(actual, cond.operator, resolvedValue, field.value_kind)) {
      return false;
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
  variables: PropertyVariable[] = [],
): RuleViolation[] {
  const violations: RuleViolation[] = [];

  for (const rule of rules) {
    if (rule.kind !== "reject") continue;
    const isMet = evaluateRule(rule, fields, answers, variables);
    if (isMet === true) {
      violations.push({ rule, customMessage: rule.customMessage });
    }
  }

  const requireRules = rules.filter((r) => r.kind === "require");
  if (requireRules.length > 0) {
    let someMet = false;
    let someUnknown = false;
    for (const rule of requireRules) {
      const isMet = evaluateRule(rule, fields, answers, variables);
      if (isMet === true) {
        someMet = true;
        break;
      } else if (isMet === null) {
        someUnknown = true;
      }
    }

    if (!someMet && !someUnknown) {
      const p = requireRules.map(r => r.conditions.map(c => {
        const f = fields.find(x => x.id === c.fieldId);
        const op = f?.value_kind === 'date' ? DATE_OP_PHRASES[c.operator] : OP_PHRASES[c.operator];
        const displayValue = variables.length ? resolveVarTokens(c.value, variables) : c.value;
        return `${f?.label} ${op || c.operator} ${displayValue}`;
      }).join(" AND ")).join(" OR ");

      violations.push({
        rule: { id: "require_failed", kind: "require", conditions: [] },
        message: `Did not meet any allowed profile. Allowed profiles: ${p}`
      });
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

/**
 * A condition is valid when both sides are the same type:
 * if the value references a variable, that variable's type must match the field's type.
 */
export function isConditionValid(
  condition: { fieldId: string; operator: string; value: string },
  fields: LandlordField[],
  variables: PropertyVariable[] = [],
): boolean {
  const field = fields.find((f) => f.id === condition.fieldId);
  if (!field) return false;
  const varKey = condition.value.trim().match(/^\{\{([a-z][a-z0-9_]*)\b/)?.[1];
  if (varKey) {
    const variable = variables.find((v) => v.id === varKey);
    if (variable && variable.value_kind !== field.value_kind) return false;
  }
  return true;
}

/** Evaluates a single branch condition against the current answers. Returns false if the field is unanswered. */
export function evalBranchCondition(
  condition: { fieldId: string; operator: string; value: string },
  fields: LandlordField[],
  answers: Record<string, string>,
  variables: PropertyVariable[] = [],
): boolean {
  const actual = answers[condition.fieldId];
  if (actual === undefined) return false;
  const field = fields.find((f) => f.id === condition.fieldId);
  if (!field) return false;
  const resolvedValue = variables.length
    ? resolveExpression(condition.value, variables, field.value_kind)
    : condition.value;
  return satisfies(actual, condition.operator, resolvedValue, field.value_kind);
}

/** Human-readable description of a rule, e.g. "Monthly income is at most 3000 AND Credit is less than 600" */
export function describeViolation(v: RuleViolation, fields: LandlordField[], variables: PropertyVariable[] = []): string {
  if (v.message) return v.message;

  const parts = v.rule.conditions.map(cond => {
    const field = fields.find(f => f.id === cond.fieldId);
    const displayValue = variables.length ? resolveVarTokens(cond.value, variables) : cond.value;
    if (!field) return `[Unknown field] ${cond.operator} ${displayValue}`;

    if (field.value_kind === "boolean") {
      const label = field.label.replace(/\?$/, "").trim();
      const expected = cond.value === "true";
      if (cond.operator === "==") return `"${label}" is ${expected ? "Yes" : "No"}`;
      if (cond.operator === "!=") return `"${label}" is not ${expected ? "Yes" : "No"}`;
    }

    const phrases = field.value_kind === "date" ? DATE_OP_PHRASES : OP_PHRASES;
    const phrase = phrases[cond.operator] ?? cond.operator;
    return `${field.label} ${phrase} ${displayValue}`;
  });

  return parts.join(" AND ");
}
