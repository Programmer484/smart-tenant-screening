/**
 * Interview flow over the new question-hierarchy model.
 *
 * The core invariant: a question is "active" iff it's a root OR its parent is
 * active AND the parent's relevant field is answered AND the trigger condition
 * holds. Roots are always active.
 *
 * Helpers in this module are pure — no rule-engine coupling beyond evaluating
 * a single trigger condition (which uses the same `satisfies`-like logic).
 */
import type { LandlordField } from "./landlord-field";
import { questionsInTreeOrder, type Question, type QuestionTrigger } from "./question";
import { VALUELESS_OPERATORS } from "./landlord-rule";

/** Order used when asking: DFS of the tree so a parent's whole subtree is
 *  visited before the next root. We DFS on the array in `sort_order` so the UI
 *  and engine agree even when `sort_order` is temporarily out of tree order
 *  (imports, manual DB edits, in-flight mutations). */
function sorted(questions: Question[]): Question[] {
  const bySortOrder = [...questions].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.id.localeCompare(b.id);
  });
  return questionsInTreeOrder(bySortOrder);
}

/** Evaluate a trigger against an answer.
 *  Returns null when the parent's answer is missing (we don't know yet). */
function evaluateTrigger(
  trigger: QuestionTrigger,
  parentField: LandlordField,
  answer: string | undefined,
): boolean | null {
  if (VALUELESS_OPERATORS.has(trigger.operator)) {
    if (trigger.operator === "is_empty") return answer === undefined || answer.trim() === "";
    if (trigger.operator === "is_not_empty") return answer !== undefined && answer.trim() !== "";
    return null;
  }
  if (answer === undefined) return null;

  const a = answer;
  const t = trigger.value;
  const op = trigger.operator;
  const kind = parentField.value_kind;

  if (kind === "number") {
    const an = Number(a);
    const tn = Number(t);
    if (isNaN(an) || isNaN(tn)) return null;
    switch (op) {
      case "==": return an === tn;
      case "!=": return an !== tn;
      case ">":  return an > tn;
      case ">=": return an >= tn;
      case "<":  return an < tn;
      case "<=": return an <= tn;
    }
  }
  if (kind === "date") {
    const ad = Date.parse(a);
    const td = Date.parse(t);
    if (isNaN(ad) || isNaN(td)) return null;
    switch (op) {
      case "==": return ad === td;
      case "!=": return ad !== td;
      case ">":  return ad > td;
      case ">=": return ad >= td;
      case "<":  return ad < td;
      case "<=": return ad <= td;
    }
  }
  if (kind === "boolean") {
    return a.toLowerCase() === t.toLowerCase();
  }
  // text / enum
  switch (op) {
    case "==":       return a.toLowerCase() === t.toLowerCase();
    case "!=":       return a.toLowerCase() !== t.toLowerCase();
    case "contains": return a.toLowerCase().includes(t.toLowerCase());
  }
  return null;
}

/** Whether question `q` is currently active (could be asked right now).
 *  Recursive: a child is active only if its parent is active AND triggered. */
export function isQuestionActive(
  q: Question,
  byId: Map<string, Question>,
  fields: LandlordField[],
  answers: Record<string, string>,
): boolean {
  if (!q.parentQuestionId || !q.trigger) return true;
  const parent = byId.get(q.parentQuestionId);
  if (!parent) return false;
  if (!isQuestionActive(parent, byId, fields, answers)) return false;
  const parentField = fields.find((f) => f.id === q.trigger!.fieldId);
  if (!parentField) return false;
  const result = evaluateTrigger(q.trigger, parentField, answers[q.trigger.fieldId]);
  return result === true;
}

/** Find the next question to ask: first active question (in sort order) that
 *  still has unanswered fields. Returns null when the interview is complete. */
export function findNextQuestion(
  questions: Question[],
  fields: LandlordField[],
  answers: Record<string, string>,
): Question | null {
  const byId = new Map(questions.map((q) => [q.id, q]));
  for (const q of sorted(questions)) {
    const allFilled = q.fieldIds.every((fid) => answers[fid] !== undefined);
    if (allFilled) continue;
    if (!isQuestionActive(q, byId, fields, answers)) continue;
    return q;
  }
  return null;
}

/** Set of question IDs currently active. Useful for completion checks and UI. */
export function getActiveQuestionIds(
  questions: Question[],
  fields: LandlordField[],
  answers: Record<string, string>,
): Set<string> {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const out = new Set<string>();
  for (const q of questions) {
    if (isQuestionActive(q, byId, fields, answers)) out.add(q.id);
  }
  return out;
}

/** Static "could ever be asked" — every question reachable from a root through
 *  any valid parent chain. With the new model this is just every question
 *  whose ancestors all exist (no orphans). */
export function getReachableQuestionIds(questions: Question[]): Set<string> {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const out = new Set<string>();
  for (const q of questions) {
    let cur: Question | undefined = q;
    let ok = true;
    let hops = 0;
    while (cur?.parentQuestionId) {
      hops += 1;
      if (hops > questions.length) { ok = false; break; }
      cur = byId.get(cur.parentQuestionId);
      if (!cur) { ok = false; break; }
    }
    if (ok) out.add(q.id);
  }
  return out;
}

/** Interview is complete when every active question is fully answered. */
export function isInterviewComplete(
  questions: Question[],
  fields: LandlordField[],
  answers: Record<string, string>,
): boolean {
  return findNextQuestion(questions, fields, answers) === null;
}
