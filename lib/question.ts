/**
 * Questions are the tenant-facing collection layer.
 * Each question maps to one or more fields (the truth/data layer).
 *
 * - A question can collect multiple fields (compound questions)
 * - A field is owned by EXACTLY ONE question (enforced by validateQuestionTree)
 * - Conditional follow-ups live on the question via `parentQuestionId` + `trigger`
 * - The chat engine walks questions in `sort_order`, gating each by its trigger
 */

import type { LandlordField } from "./landlord-field";
import {
  OPERATORS_BY_KIND,
  VALUELESS_OPERATORS,
  validateCondition,
  type RuleCondition,
} from "./landlord-rule";

/** Condition that gates a child question on the parent's answer.
 *  `fieldId` MUST be one of the parent question's fieldIds. */
export type QuestionTrigger = {
  fieldId: string;
  operator: string;
  /** Empty for valueless operators (is_empty / is_not_empty). */
  value: string;
};

export type Question = {
  id: string;
  text: string;
  fieldIds: string[];
  sort_order: number;
  extract_hint?: string;
  /** Undefined → root question, always asked. */
  parentQuestionId?: string;
  /** Required iff `parentQuestionId` is set. Evaluated against parent's answer. */
  trigger?: QuestionTrigger;
};

/** Suggested `<textarea rows>` from explicit newlines so long prompts stay readable. */
export function questionTextEditorRows(text: string, opts?: { min?: number; max?: number }) {
  const min = opts?.min ?? 1;
  const max = opts?.max ?? 14;
  const n = text.split("\n").length;
  return Math.min(max, Math.max(min, n));
}

/** DFS walk of the question tree. Siblings keep their input order (i.e. the
 *  order they appear in the incoming array). Orphans (parent id doesn't
 *  resolve) are treated as roots so they're still reachable.
 *  Used by {@link findNextQuestion} and {@link normalizeQuestionOrder} to make
 *  sure we ask a parent's whole subtree before moving to the next root. */
export function questionsInTreeOrder(questions: Question[]): Question[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const children = new Map<string, Question[]>();
  const roots: Question[] = [];

  for (const q of questions) {
    const parentId = q.parentQuestionId;
    if (parentId && parentId !== q.id && byId.has(parentId)) {
      const arr = children.get(parentId) ?? [];
      arr.push(q);
      children.set(parentId, arr);
    } else {
      roots.push(q);
    }
  }

  const seen = new Set<string>();
  const out: Question[] = [];
  const walk = (q: Question) => {
    if (seen.has(q.id)) return;
    seen.add(q.id);
    out.push(q);
    for (const child of children.get(q.id) ?? []) walk(child);
  };
  for (const r of roots) walk(r);
  // Safety net: any cycle-orphaned node that wasn't reached (shouldn't happen
  // after the orphan-as-root rule, but keeps behaviour total).
  for (const q of questions) if (!seen.has(q.id)) out.push(q);
  return out;
}

/** Reorder questions into tree-DFS order and reassign `sort_order` so the
 *  flat array matches the visual hierarchy. Safe to call after any mutation
 *  (add / delete / reparent / manual reorder). */
export function normalizeQuestionOrder(questions: Question[]): Question[] {
  return questionsInTreeOrder(questions).map((q, i) => ({ ...q, sort_order: i }));
}

/** Validate a single question's intrinsic shape (text, field refs).
 *  Tree-level rules (exclusivity, parent ref, trigger validity) are checked
 *  separately by {@link validateQuestionTree}. */
export function validateQuestion(
  question: Question,
  fieldIds: string[],
): string | null {
  if (!question.text.trim()) return "Question text is required";
  if (question.fieldIds.length === 0) return "Link at least one field to this question";
  for (const fid of question.fieldIds) {
    if (!fieldIds.includes(fid)) {
      return `Field "${fid}" not found`;
    }
  }
  return null;
}

/** Lift a {@link QuestionTrigger} into a {@link RuleCondition} so we can reuse
 *  the existing condition validator (operator/value type checks). */
function triggerAsCondition(trigger: QuestionTrigger): RuleCondition {
  return {
    id: "trigger",
    fieldId: trigger.fieldId,
    operator: trigger.operator,
    value: trigger.value,
  };
}

/** Validate a child's trigger against the parent question's fields. */
export function validateTrigger(
  trigger: QuestionTrigger,
  parent: Question,
  fields: LandlordField[],
): string | null {
  if (!parent.fieldIds.includes(trigger.fieldId)) {
    return `Trigger field "${trigger.fieldId}" is not owned by parent question "${parent.id}"`;
  }
  const parentField = fields.find((f) => f.id === trigger.fieldId);
  if (!parentField) return `Parent field "${trigger.fieldId}" not found in schema`;
  const ops = OPERATORS_BY_KIND[parentField.value_kind];
  if (!ops?.includes(trigger.operator)) {
    return `Operator "${trigger.operator}" is not valid for ${parentField.value_kind} field`;
  }
  if (VALUELESS_OPERATORS.has(trigger.operator)) return null;
  return validateCondition(triggerAsCondition(trigger), [parentField]);
}

/** Tree-level validation: field exclusivity, parent refs, trigger sanity, no cycles. */
export function validateQuestionTree(
  questions: Question[],
  fields: LandlordField[],
): string | null {
  const fieldIds = new Set(fields.map((f) => f.id));
  const byId = new Map(questions.map((q) => [q.id, q]));
  const fieldOwner = new Map<string, string>();

  for (const q of questions) {
    const intrinsic = validateQuestion(q, [...fieldIds]);
    if (intrinsic) return `Question "${q.id}": ${intrinsic}`;
    for (const fid of q.fieldIds) {
      const owner = fieldOwner.get(fid);
      if (owner && owner !== q.id) {
        return `Field "${fid}" is owned by both "${owner}" and "${q.id}" — fields can belong to only one question`;
      }
      fieldOwner.set(fid, q.id);
    }
    if (q.parentQuestionId !== undefined) {
      if (q.parentQuestionId === q.id) return `Question "${q.id}" cannot be its own parent`;
      const parent = byId.get(q.parentQuestionId);
      if (!parent) return `Question "${q.id}" references missing parent "${q.parentQuestionId}"`;
      if (!q.trigger) return `Conditional question "${q.id}" must define a trigger`;
      const triggerErr = validateTrigger(q.trigger, parent, fields);
      if (triggerErr) return `Question "${q.id}": ${triggerErr}`;
    } else if (q.trigger) {
      return `Question "${q.id}" has a trigger but no parentQuestionId`;
    }
  }

  // Cycle check: walk every node up to root, bailing if depth exceeds total count.
  for (const q of questions) {
    let cur: Question | undefined = q;
    let hops = 0;
    while (cur?.parentQuestionId) {
      hops += 1;
      if (hops > questions.length) return `Cycle detected in question hierarchy near "${q.id}"`;
      cur = byId.get(cur.parentQuestionId);
    }
  }

  return null;
}

/** All question ids that violate tree-level constraints (same basis as Preview gating). */
export function collectInvalidQuestionIds(questions: Question[], fields: LandlordField[]): Set<string> {
  const fieldIds = new Set(fields.map((f) => f.id));
  const byId = new Map(questions.map((q) => [q.id, q]));
  const invalidIds = new Set<string>();

  // Intrinsic + parent/trigger validity
  for (const q of questions) {
    const intrinsic = validateQuestion(q, [...fieldIds]);
    if (intrinsic) invalidIds.add(q.id);

    if (q.parentQuestionId !== undefined) {
      if (q.parentQuestionId === q.id) invalidIds.add(q.id);
      const parent = byId.get(q.parentQuestionId);
      if (!parent) invalidIds.add(q.id);
      if (!q.trigger) invalidIds.add(q.id);
      if (parent && q.trigger) {
        const triggerErr = validateTrigger(q.trigger, parent, fields);
        if (triggerErr) invalidIds.add(q.id);
      }
    } else if (q.trigger) {
      invalidIds.add(q.id);
    }
  }

  // Field exclusivity (mark both questions when duped)
  const fieldOwner = new Map<string, string>();
  for (const q of questions) {
    for (const fid of q.fieldIds) {
      const owner = fieldOwner.get(fid);
      if (owner && owner !== q.id) {
        invalidIds.add(owner);
        invalidIds.add(q.id);
      } else {
        fieldOwner.set(fid, q.id);
      }
    }
  }

  // Cycle check (mark the starting node; we only need a non-zero count)
  for (const q of questions) {
    let cur: Question | undefined = q;
    let hops = 0;
    while (cur?.parentQuestionId) {
      hops += 1;
      if (hops > questions.length) {
        invalidIds.add(q.id);
        break;
      }
      cur = byId.get(cur.parentQuestionId);
    }
  }

  return invalidIds;
}

/** Invalid ids, first id in tree-walk order (matches Questions tab), and count — single collect pass. */
export function getInvalidQuestionSummary(questions: Question[], fields: LandlordField[]) {
  const invalidIds = collectInvalidQuestionIds(questions, fields);
  let firstInvalidId: string | null = null;
  for (const q of questionsInTreeOrder(questions)) {
    if (invalidIds.has(q.id)) {
      firstInvalidId = q.id;
      break;
    }
  }
  return { invalidIds, firstInvalidId, count: invalidIds.size };
}

/** First invalid question in tree-walk order (matches Questions tab layout). */
export function getFirstInvalidQuestionId(questions: Question[], fields: LandlordField[]): string | null {
  return getInvalidQuestionSummary(questions, fields).firstInvalidId;
}

/** Count how many questions are invalid, for "readiness" gating.
 *  Returns a count of unique question IDs that violate tree-level constraints.
 *  This is intentionally stricter than "UI completeness" so Preview/Share
 *  behaves safely even with partially-edited trees. */
export function countInvalidQuestions(questions: Question[], fields: LandlordField[]): number {
  return collectInvalidQuestionIds(questions, fields).size;
}
