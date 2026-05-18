import type { LandlordField } from "@/lib/landlord-field";
import type { PropertyVariable } from "@/lib/property";
import { operatorLabel, OPERATORS_BY_KIND } from "@/lib/landlord-rule";
import type { Question } from "@/lib/question";

const BRANCH_EXPR_RE = /^\{\{([a-z][a-z0-9_]*)\}\}/;

/**
 * Same rules the FlowEditor enforces for users:
 * - operator valid for field type
 * - value non-empty
 * - {{var}} expressions type-match the field
 * - literal numbers/booleans/enum options are well-formed
 */
export function validateBranchCondition(
  cond: { fieldId: string; operator: string; value: string },
  fields: LandlordField[],
  variables: PropertyVariable[],
): string | null {
  const field = fields.find((f) => f.id === cond.fieldId);
  if (!field) return "field not found";

  const ops = OPERATORS_BY_KIND[field.value_kind];
  if (!ops?.includes(cond.operator)) return `invalid operator "${cond.operator}" for ${field.value_kind}`;

  const val = cond.value.trim();
  if (!val) return "value is required";

  // Variable expression — validate existence and type match
  const exprKey = BRANCH_EXPR_RE.exec(val)?.[1];
  if (exprKey) {
    const variable = variables.find((v) => v.id === exprKey);
    if (!variable) return `variable "{{${exprKey}}}" not found`;
    if (variable.value_kind !== field.value_kind) {
      return `variable type (${variable.value_kind}) doesn't match field type (${field.value_kind})`;
    }
    return null;
  }

  if (field.value_kind === "number" && isNaN(Number(val))) return "value must be a number";
  if (field.value_kind === "boolean" && val !== "true" && val !== "false") return "value must be true or false";
  if (field.value_kind === "enum" && field.options?.length && !field.options.includes(val)) {
    return `value "${val}" not in enum options [${field.options.join(", ")}]`;
  }

  return null;
}

/** Recursively drop any branches whose conditions fail validation. */
export function sanitizeQuestions(
  questions: Question[],
  fields: LandlordField[],
  variables: PropertyVariable[],
  onDropped?: (questionId: string, branchId: string, reason: string) => void,
): Question[] {
  return questions.map((q) => ({
    ...q,
    branches: q.branches
      .filter((branch) => {
        const err = validateBranchCondition(branch.condition, fields, variables);
        if (err) {
          onDropped?.(q.id, branch.id, err);
          return false;
        }
        return true;
      })
      .map((branch) => ({
        ...branch,
        subQuestions: sanitizeQuestions(branch.subQuestions, fields, variables, onDropped),
      })),
  }));
}

/** Replaces {{key}} tokens with the variable's human label (falls back to the key itself). */
export function resolveVarTokens(text: string, variables: PropertyVariable[]): string {
  return text.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (_, key) => {
    const v = variables.find((v) => v.id === key);
    return v?.label ?? key;
  });
}

export function describeCondition(
  cond: { fieldId: string; operator: string; value: string },
  fields: LandlordField[],
  variables: PropertyVariable[] = [],
): string {
  const field = fields.find((f) => f.id === cond.fieldId);
  const label = field?.label ?? cond.fieldId ?? "?";
  if (field?.value_kind === "boolean") {
    const isYes = cond.value === "true";
    const expected = cond.operator === "!=" ? !isYes : isYes;
    return `${label} is ${expected ? "Yes" : "No"}`;
  }
  const op = operatorLabel(cond.operator, field?.value_kind);
  const displayValue = variables.length ? resolveVarTokens(cond.value, variables) : cond.value;
  return `${label} ${op} ${displayValue || "…"}`;
}
