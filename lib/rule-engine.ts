import type { LandlordField } from "./landlord-field";
import type { PropertyVariable } from "./property";
import { resolveVarTokens } from "./condition-utils";

// Matches: {{key}}  or  {{key}} +/- N  or  {{key}} +/- {{key2}}
const EXPR_RE = /^\{\{([a-z][a-z0-9_]*)\}\}(?:\s*([+-])\s*(?:(\d+)|\{\{([a-z][a-z0-9_]*)\}\}))?$/;

/**
 * Resolves a condition value that may be a variable expression.
 * Returns the original string if it isn't an expression or the variable is unknown.
 */
function resolveExpression(
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

