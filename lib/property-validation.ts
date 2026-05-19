import {
  validateEnumOptions,
  validateLandlordFieldId,
  validateLandlordFieldLabel,
  type LandlordField,
} from "./landlord-field";
import { validateBranchCondition } from "./condition-utils";
import type { Question } from "./question";
import type { PropertyVariable } from "./property";

export type PublishValidationIssue = {
  section: "fields" | "questions" | "variables";
  /** Short identifier shown as a pill, e.g. "Q2" or "Field 3" */
  label: string;
  message: string;
  target?: {
    questionId?: string;
    branchId?: string;
  };
};

function toRoman(n: number): string {
  const map: [number, string][] = [
    [1000,"m"],[900,"cm"],[500,"d"],[400,"cd"],[100,"c"],[90,"xc"],
    [50,"l"],[40,"xl"],[10,"x"],[9,"ix"],[5,"v"],[4,"iv"],[1,"i"],
  ];
  return map.reduce((s, [v, r]) => { while (n >= v) { s += r; n -= v; } return s; }, "");
}

function computeLabel(indices: number[]): string {
  if (indices.length === 1) return `Q${indices[0] + 1}`;
  if (indices.length === 2) return `Q${indices[0] + 1}${String.fromCharCode(97 + indices[1])}`;
  return `Q${indices[0] + 1}${String.fromCharCode(97 + indices[1])}.${toRoman(indices[2] + 1)}`;
}

function validateBranches(
  question: Question,
  fields: LandlordField[],
  variables: PropertyVariable[],
  qLabel: string,
  myIndices: number[],
  issues: PublishValidationIssue[],
) {
  const branches = question.branches ?? [];
  let nextIdx = 0;
  branches.forEach((branch, index) => {
    const branchSuffix = branches.length > 1 ? ` (branch ${index + 1})` : "";
    const conditionError = validateBranchCondition(branch.condition, fields, variables);

    if (conditionError) {
      issues.push({
        section: "questions",
        label: qLabel,
        message: `condition${branchSuffix} is incomplete (${conditionError}).`,
        target: { questionId: question.id, branchId: branch.id },
      });
    }

    if (branch.outcome === "followups") {
      const subQuestions = branch.subQuestions ?? [];
      if (!subQuestions.length) {
        issues.push({
          section: "questions",
          label: qLabel,
          message: `add at least one follow-up question${branchSuffix} or change the outcome.`,
          target: { questionId: question.id, branchId: branch.id },
        });
      }
      validateQuestions(subQuestions, fields, variables, myIndices, nextIdx, issues);
      nextIdx += subQuestions.length;
    }
  });
}

function validateQuestions(
  questions: Question[],
  fields: LandlordField[],
  variables: PropertyVariable[],
  parentIndices: number[],
  startIdx: number,
  issues: PublishValidationIssue[],
) {
  questions.forEach((question, index) => {
    const myIndices = [...parentIndices, startIdx + index];
    const label = computeLabel(myIndices);

    if (!question.text.trim()) {
      issues.push({
        section: "questions",
        label,
        message: "question text is required.",
        target: { questionId: question.id },
      });
    }
    if (question.fieldIds.length === 0) {
      issues.push({
        section: "questions",
        label,
        message: "link at least one field.",
        target: { questionId: question.id },
      });
    }
    for (const fieldId of question.fieldIds) {
      if (!fields.some((field) => field.id === fieldId)) {
        issues.push({
          section: "questions",
          label,
          message: `linked field "${fieldId}" does not exist.`,
          target: { questionId: question.id },
        });
      }
    }
    validateBranches(question, fields, variables, label, myIndices, issues);
  });
}

export function validatePublishableProperty(input: {
  fields: LandlordField[];
  questions: Question[];
  variables?: import("./property").PropertyVariable[];
}): PublishValidationIssue[] {
  const issues: PublishValidationIssue[] = [];
  const { fields, questions, variables = [] } = input;

  if (fields.length === 0) {
    issues.push({ section: "fields", label: "Fields", message: "add at least one field." });
  }
  fields.forEach((field, index) => {
    const label = `Field ${index + 1}`;
    const idError = validateLandlordFieldId(field.id);
    if (idError) issues.push({ section: "fields", label, message: idError + "." });
    const labelError = validateLandlordFieldLabel(field.label);
    if (labelError) issues.push({ section: "fields", label, message: labelError + "." });
    if (field.value_kind === "enum") {
      const optionsError = validateEnumOptions(field.options);
      if (optionsError) issues.push({ section: "fields", label, message: optionsError + "." });
    }
  });

  const fieldIds = fields.map((field) => field.id).filter(Boolean);
  const duplicateFieldIds = fieldIds.filter((fieldId, index) => fieldIds.indexOf(fieldId) !== index);
  for (const fieldId of [...new Set(duplicateFieldIds)]) {
    issues.push({ section: "fields", label: "Fields", message: `field id "${fieldId}" is used more than once.` });
  }

  variables.forEach((variable, index) => {
    if (!variable.label.trim()) {
      issues.push({ section: "variables", label: `Variable ${index + 1}`, message: "label is required." });
    }
  });

  if (questions.length === 0) {
    issues.push({ section: "questions", label: "Questions", message: "add at least one question." });
  }
  validateQuestions(questions, fields, variables, [], 0, issues);

  return issues;
}
