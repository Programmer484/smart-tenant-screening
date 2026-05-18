"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { FieldPickerPopover } from "@/app/components/FieldPickerPopover";
import type { Question, Branch, BranchOutcome } from "@/lib/question";
import type { LandlordField } from "@/lib/landlord-field";
import { OPERATORS_BY_KIND, defaultOperatorForKind, defaultValueForKind } from "@/lib/landlord-rule";
import type { PropertyVariable } from "@/lib/property";
import { generateId } from "@/lib/id-utils";
import { describeCondition, resolveVarTokens } from "@/lib/condition-utils";

// ─── Navigation types ────────────────────────────────────────────────────────

// Each step in the path: questionId is the question at this level,
// branchId (when set) is the branch of THIS question that leads to the next level.
type NavStep = { questionId: string; branchId?: string };
type NavPath = NavStep[];

type TreeItem = {
  question: Question;
  path: NavPath;
  label: string;
  level: number;
  hasChildren: boolean;
};

// ─── Utilities ───────────────────────────────────────────────────────────────

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

function pathsEqual(a: NavPath, b: NavPath) {
  return (
    a.length === b.length &&
    a.every((s, i) => s.questionId === b[i].questionId && s.branchId === b[i].branchId)
  );
}

function flattenQuestions(qs: Question[]): Question[] {
  const out: Question[] = [];
  function walk(list: Question[]) {
    for (const q of list) {
      out.push(q);
      for (const b of q.branches) walk(b.subQuestions);
    }
  }
  walk(qs);
  return out;
}

function findPathToQuestion(qs: Question[], targetId: string, currentPath: NavPath = []): NavPath | null {
  for (const q of qs) {
    if (q.id === targetId) return [...currentPath, { questionId: q.id }];
    for (const b of q.branches) {
      if (b.outcome === "followups") {
        const found = findPathToQuestion(b.subQuestions, targetId, [...currentPath, { questionId: q.id, branchId: b.id }]);
        if (found) return found;
      }
    }
  }
  return null;
}

function getAtPath(rootQs: Question[], path: NavPath): Question | null {
  let list = rootQs;
  let found: Question | null = null;
  for (const step of path) {
    const q = list.find((q) => q.id === step.questionId);
    if (!q) return null;
    found = q;
    if (step.branchId) {
      const b = q.branches.find((b) => b.id === step.branchId);
      if (!b) return null;
      list = b.subQuestions;
    }
  }
  return found;
}

function updateAtPath(
  rootQs: Question[],
  path: NavPath,
  fn: (q: Question) => Question,
): Question[] {
  if (!path.length) return rootQs;
  const [head, ...tail] = path;
  return rootQs.map((q) => {
    if (q.id !== head.questionId) return q;
    if (!tail.length) return fn(q);
    return {
      ...q,
      branches: q.branches.map((b) =>
        b.id === head.branchId
          ? { ...b, subQuestions: updateAtPath(b.subQuestions, tail, fn) }
          : b,
      ),
    };
  });
}

// Builds a flat list of tree items for the sidebar, with correct labels and paths.
// parentIndices tracks the depth-index chain, startIdx offsets within the current level
// so sub-questions from multiple branches share a single alphabetical sequence.
function buildTree(
  qs: Question[],
  pathPrefix: NavPath,
  focusedPath: NavPath,
  parentIndices: number[],
  startIdx = 0,
): TreeItem[] {
  const focusedIds = new Set(focusedPath.map((s) => s.questionId));
  const items: TreeItem[] = [];

  qs.forEach((q, i) => {
    const myIndices = [...parentIndices, startIdx + i];
    const path: NavPath = [...pathPrefix, { questionId: q.id }];
    const followupBranches = q.branches.filter((b) => b.outcome === "followups");
    const hasChildren = followupBranches.some((b) => b.subQuestions.length > 0);

    items.push({ question: q, path, label: computeLabel(myIndices), level: myIndices.length - 1, hasChildren });

    if (focusedIds.has(q.id) && hasChildren) {
      let nextIdx = 0;
      for (const branch of followupBranches) {
        items.push(
          ...buildTree(
            branch.subQuestions,
            [...pathPrefix, { questionId: q.id, branchId: branch.id }],
            focusedPath,
            myIndices,
            nextIdx,
          ),
        );
        nextIdx += branch.subQuestions.length;
      }
    }
  });

  return items;
}

// ─── Outcome config ──────────────────────────────────────────────────────────

type OutcomeCfg = {
  label: string;
  icon: string;
  iconCls: string;
  activeCls: string;
};

const OUTCOME_CFG: Record<BranchOutcome, OutcomeCfg> = {
  continue:  { label: "Continue",       icon: "↓", iconCls: "bg-black/5 text-foreground/70",      activeCls: "bg-[#f7f9f8] border-foreground/20 text-foreground/70" },
  followups: { label: "Add follow-ups", icon: "+", iconCls: "bg-teal-50 text-teal-700",            activeCls: "bg-teal-50 border-teal-300 text-teal-800" },
  reject:    { label: "Reject",         icon: "×", iconCls: "bg-red-50 text-red-600",              activeCls: "bg-red-50 border-red-300 text-red-700" },
};

// ─── Question chip overlay ────────────────────────────────────────────────────
// Renders question text with {{key}} tokens replaced by violet chips.
// Used as an absolute overlay over the input when not focused.

function QuestionChipOverlay({ text, variables }: { text: string; variables: PropertyVariable[] }) {
  const parts: { kind: "text" | "var"; content: string }[] = [];
  let last = 0;
  const re = /\{\{([a-z][a-z0-9_]*)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ kind: "text", content: text.slice(last, m.index) });
    const v = variables.find((v) => v.id === m![1]);
    parts.push({ kind: "var", content: v?.label ?? m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", content: text.slice(last) });

  return (
    <>
      {parts.map((p, i) =>
        p.kind === "var" ? (
          <span key={i} className="inline-flex items-center rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-sm font-medium text-violet-700 leading-none">
            {p.content}
          </span>
        ) : (
          <span key={i} className="text-foreground">{p.content}</span>
        ),
      )}
    </>
  );
}

// ─── Condition editor ─────────────────────────────────────────────────────────

function ConditionEditor({
  condition,
  fields,
  customVars,
  onChange,
}: {
  condition: { fieldId: string; operator: string; value: string };
  fields: LandlordField[];
  customVars: PropertyVariable[];
  onChange: (c: { fieldId: string; operator: string; value: string }) => void;
}) {
  const source = fields.find((f) => f.id === condition.fieldId);
  const field = source;
  const ops = source ? (OPERATORS_BY_KIND[source.value_kind] ?? []) : [];
  const effectiveOp = ops.includes(condition.operator) ? condition.operator : (ops[0] ?? condition.operator);
  // Only offer variables whose type matches the field
  const matchingVars = customVars.filter((v) => v.value_kind === source?.value_kind);
  // Offset vars are always numeric
  const numberVars = customVars.filter((v) => v.value_kind === "number");

  const isDropdownValue =
    source?.value_kind === "boolean" ||
    (source?.value_kind === "enum" && (field?.options?.length ?? 0) > 0);

  const EXPR_RE = /^\{\{([a-z][a-z0-9_]*)\}\}(?:\s*([+-])\s*(?:(\d+)|\{\{([a-z][a-z0-9_]*)\}\}))?$/;
  const exprMatch = condition.value.trim().match(EXPR_RE);
  const isExprMode = !isDropdownValue && !!exprMatch;
  const exprKey = exprMatch?.[1] ?? "";
  const exprOp = (exprMatch?.[2] ?? "+") as "+" | "-";
  const exprOffsetNum = exprMatch?.[3] !== undefined ? parseInt(exprMatch[3], 10) : null;
  const exprOffsetVar = exprMatch?.[4] ?? null;
  const hasOffset = exprMatch?.[2] !== undefined;
  const supportsOffset = source?.value_kind === "date" || source?.value_kind === "number";
  const valueMode: "literal" | "variable" = isExprMode ? "variable" : "literal";

  const selectCls = "rounded-md border border-foreground/12 bg-white px-2.5 py-1.5 text-sm text-foreground focus:border-teal-700/40 focus:outline-none focus:ring-2 focus:ring-teal-700/10";
  const smallInputCls = "rounded-md border border-foreground/12 bg-white px-2.5 py-1.5 text-sm text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:outline-none focus:ring-2 focus:ring-teal-700/10";
  const opLabels: Record<string, string> = source?.value_kind === "date"
    ? { "==": "is on", "!=": "is not on", ">": "is after", ">=": "is on or after", "<": "is before", "<=": "is on or before" }
    : { "==": "equals", "!=": "doesn't equal", ">": "is more than", ">=": "is at least", "<": "is less than", "<=": "is at most" };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium text-foreground/40">If</span>

      {/* Field selector */}
      <select
        value={condition.fieldId}
        onChange={(e) => {
          const s = fields.find((s) => s.id === e.target.value);
          if (!s) return;
          onChange({ fieldId: s.id, operator: defaultOperatorForKind(s.value_kind), value: defaultValueForKind(s.value_kind) });
        }}
        className={selectCls}
      >
        {fields.length === 0 && <option value="">— no linked fields —</option>}
        {fields.map((s) => (
          <option key={s.id} value={s.id}>{s.label || s.id}</option>
        ))}
      </select>

      {/* Operator selector */}
      <select
        value={effectiveOp}
        onChange={(e) => onChange({ ...condition, operator: e.target.value })}
        className={selectCls}
      >
        {ops.map((op) => <option key={op} value={op}>{opLabels[op] ?? op}</option>)}
      </select>

      {/* Value area */}
      {isDropdownValue ? (
        field?.value_kind === "boolean" ? (
          <select value={condition.value} onChange={(e) => onChange({ ...condition, value: e.target.value })} className={selectCls}>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        ) : (
          <select value={condition.value} onChange={(e) => onChange({ ...condition, value: e.target.value })} className={selectCls}>
            {field?.options?.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        )
      ) : (
        <>
          {/* Value / Variable toggle — only shown when matching vars exist */}
          {matchingVars.length > 0 && (
            <div className="inline-flex items-center gap-0.5 rounded-full bg-foreground/[0.06] p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => onChange({ ...condition, value: defaultValueForKind(source?.value_kind ?? "text") })}
                className={`rounded-full px-2.5 py-0.5 transition-all ${valueMode === "literal" ? "bg-white font-medium text-foreground/70 shadow-sm" : "text-foreground/35 hover:text-foreground/55"}`}
              >
                Value
              </button>
              <button
                type="button"
                onClick={() => { const first = matchingVars[0]; if (first) onChange({ ...condition, value: `{{${first.id}}}` }); }}
                className={`rounded-full px-2.5 py-0.5 transition-all ${valueMode === "variable" ? "bg-white font-medium text-foreground/70 shadow-sm" : "text-foreground/35 hover:text-foreground/55"}`}
              >
                Variable
              </button>
            </div>
          )}

          {valueMode === "variable" ? (
            /* ── Variable mode ── */
            <>
              <select
                value={exprKey}
                onChange={(e) => onChange({ ...condition, value: `{{${e.target.value}}}` })}
                className={selectCls}
              >
                {matchingVars.map((v, i) => (
                  <option key={v.id || i} value={v.id}>{v.label}</option>
                ))}
              </select>

              {/* Offset controls for date / number fields */}
              {supportsOffset && (
                hasOffset ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const newOp = exprOp === "+" ? "-" : "+";
                        onChange({
                          ...condition,
                          value: exprOffsetVar !== null
                            ? `{{${exprKey}}} ${newOp} {{${exprOffsetVar}}}`
                            : `{{${exprKey}}} ${newOp} ${exprOffsetNum ?? 0}`,
                        });
                      }}
                      className="w-7 rounded border border-foreground/15 bg-white py-1 text-center text-sm font-bold text-foreground/60 hover:bg-foreground/5"
                      title="Toggle + / −"
                    >
                      {exprOp}
                    </button>
                    {exprOffsetVar !== null ? (
                      <>
                        <select
                          value={exprOffsetVar}
                          onChange={(e) => onChange({ ...condition, value: `{{${exprKey}}} ${exprOp} {{${e.target.value}}}` })}
                          className={selectCls}
                        >
                          {numberVars.map((v, i) => <option key={v.id || i} value={v.id}>{v.label}</option>)}
                        </select>
                        <button
                          type="button"
                          onClick={() => onChange({ ...condition, value: `{{${exprKey}}} ${exprOp} 0` })}
                          className="text-[11px] text-foreground/30 hover:text-foreground/60"
                          title="Switch to number"
                        >×</button>
                      </>
                    ) : (
                      <>
                        <input
                          type="number"
                          min={0}
                          value={exprOffsetNum ?? 0}
                          onChange={(e) => onChange({ ...condition, value: `{{${exprKey}}} ${exprOp} ${Math.max(0, parseInt(e.target.value) || 0)}` })}
                          className={`w-16 ${smallInputCls}`}
                        />
                        {source?.value_kind === "date" && <span className="text-[11px] text-foreground/40">days</span>}
                        {numberVars.length > 0 && (
                          <button
                            type="button"
                            onClick={() => onChange({ ...condition, value: `{{${exprKey}}} ${exprOp} {{${numberVars[0].id}}}` })}
                            className="rounded border border-foreground/12 bg-white px-2 py-0.5 text-[11px] text-foreground/45 hover:text-foreground/70"
                          >
                            use var
                          </button>
                        )}
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => onChange({ ...condition, value: `{{${exprKey}}}` })}
                      className="text-[11px] text-foreground/30 hover:text-red-400"
                    >
                      × offset
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => onChange({ ...condition, value: `{{${exprKey}}} + 0` })}
                    className="rounded border border-dashed border-foreground/20 px-2 py-0.5 text-[11px] text-foreground/40 hover:border-foreground/30 hover:text-foreground/60"
                  >
                    ± offset
                  </button>
                )
              )}
            </>
          ) : (
            /* ── Literal mode ── */
            <input
              type={source?.value_kind === "number" ? "number" : source?.value_kind === "date" ? "date" : "text"}
              value={condition.value}
              onChange={(e) => onChange({ ...condition, value: e.target.value })}
              placeholder="value"
              className={`w-32 ${smallInputCls}`}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function FlowEditor({
  questions,
  fields,
  customVariables = [],
  aiInstructions,
  onChange,
  onCreateField,
  onGenerateTargeted,
  externalFocus,
}: {
  questions: Question[];
  fields: LandlordField[];
  customVariables?: PropertyVariable[];
  aiInstructions?: { rejectionPrompt?: string };
  onChange: (qs: Question[]) => void;
  onCreateField?: (label: string) => string;
  onGenerateTargeted?: (prompt: string, question: Question) => Promise<{ updatedQuestion?: Question }>;
  externalFocus?: { id: string; target: { questionId?: string; branchId?: string } } | null;
}) {
  const [focusedPath, setFocusedPath] = useState<NavPath>([]);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [fieldPickerOpen, setFieldPickerOpen] = useState(false);
  const [fieldPickerAnchor, setFieldPickerAnchor] = useState<DOMRect | null>(null);
  const fieldPickerBtnRef = useRef<HTMLButtonElement>(null);
  const questionInputRef = useRef<HTMLInputElement>(null);
  const questionCursorRef = useRef<number>(0);
  const [questionFocused, setQuestionFocused] = useState(false);
  const [aiEditPrompt, setAiEditPrompt] = useState("");
  const [isGeneratingTargeted, setIsGeneratingTargeted] = useState(false);
  const [dragSubIdx, setDragSubIdx] = useState<number | null>(null);
  const [dragOverSubIdx, setDragOverSubIdx] = useState<number | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!externalFocus?.target?.questionId) return;
    const path = findPathToQuestion(questions, externalFocus.target.questionId);
    if (!path) return;
    setFocusedPath(path);
    const branchId = externalFocus.target.branchId;
    if (branchId) {
      setActiveBranchId(branchId);
    } else {
      const q = getAtPath(questions, path);
      setActiveBranchId(q?.branches[0]?.id ?? null);
    }
    requestAnimationFrame(() => {
      const qid = externalFocus.target.questionId!;
      const item = sidebarRef.current?.querySelector(`[data-qid="${qid}"]`);
      item?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      questionInputRef.current?.focus();
      questionInputRef.current?.select();
    });
  }, [externalFocus]); // eslint-disable-line react-hooks/exhaustive-deps

  const focusedIds = new Set(focusedPath.map((s) => s.questionId));
  const treeItems = buildTree(questions, [], focusedPath, [], 0);
  const focusedQuestion = getAtPath(questions, focusedPath);
  const currentItem = treeItems.find((t) => pathsEqual(t.path, focusedPath));
  const activeBranch = focusedQuestion?.branches.find((b) => b.id === activeBranchId) ?? null;

  const lockedFieldIds = useMemo(() => {
    if (!focusedQuestion) return new Set<string>();
    const set = new Set<string>();
    for (const q of flattenQuestions(questions)) {
      if (q.id === focusedQuestion.id) continue;
      for (const id of q.fieldIds) set.add(id);
    }
    return set;
  }, [questions, focusedQuestion?.id]);

  // Build ancestor list (all path steps except the last)
  type Ancestor = { question: Question; branch?: Branch; label: string; path: NavPath };
  const ancestors: Ancestor[] = focusedPath.slice(0, -1).flatMap((step, i) => {
    const ancestorPath = focusedPath.slice(0, i + 1);
    const q = getAtPath(questions, ancestorPath);
    const branch = q?.branches.find((b) => b.id === step.branchId);
    const item = treeItems.find((t) => pathsEqual(t.path, ancestorPath));
    return q && item ? [{ question: q, branch, label: item.label, path: ancestorPath }] : [];
  });

  // ── Mutation helpers ────────────────────────────────────────────────────────

  function mutate(fn: (q: Question) => Question) {
    onChange(updateAtPath(questions, focusedPath, fn));
  }

  function updateBranch(branchId: string, fn: (b: Branch) => Branch) {
    mutate((q) => ({ ...q, branches: q.branches.map((b) => (b.id === branchId ? fn(b) : b)) }));
  }

  function insertVarIntoQuestion(token: string) {
    if (!focusedQuestion) return;
    const pos = questionCursorRef.current;
    const text = focusedQuestion.text;
    const newText = text.slice(0, pos) + token + text.slice(pos);
    const newPos = pos + token.length;
    questionCursorRef.current = newPos;
    mutate((q) => ({ ...q, text: newText }));
    requestAnimationFrame(() => {
      questionInputRef.current?.focus();
      questionInputRef.current?.setSelectionRange(newPos, newPos);
    });
  }

  async function handleTargetedGenerate() {
    if (!onGenerateTargeted || !focusedQuestion || !aiEditPrompt.trim()) return;
    setIsGeneratingTargeted(true);
    try {
      const res = await onGenerateTargeted(aiEditPrompt, focusedQuestion);
      if (res.updatedQuestion) {
        mutate(() => res.updatedQuestion!);
      }
      setAiEditPrompt("");
    } finally {
      setIsGeneratingTargeted(false);
    }
  }

  // ── Actions ─────────────────────────────────────────────────────────────────

  function addTopLevelQuestion() {
    const newQ: Question = { id: `q_${generateId()}`, text: "", fieldIds: [], sort_order: questions.length, branches: [] };
    onChange([...questions, newQ]);
    setFocusedPath([{ questionId: newQ.id }]);
    setActiveBranchId(null);
  }

  function deleteQuestion() {
    if (!focusedQuestion) return;
    const qid = focusedQuestion.id;

    if (focusedPath.length === 1) {
      // Top-level question
      onChange(questions.filter((q) => q.id !== qid).map((q, i) => ({ ...q, sort_order: i })));
      setFocusedPath([]);
      setActiveBranchId(null);
      return;
    }

    // Sub-question: remove from the parent branch's subQuestions
    const parentPath = focusedPath.slice(0, -1);
    const parentStep = parentPath[parentPath.length - 1];
    const newQs = updateAtPath(questions, parentPath, (parentQ) => ({
      ...parentQ,
      branches: parentQ.branches.map((b) =>
        b.id === parentStep.branchId
          ? { ...b, subQuestions: b.subQuestions.filter((sq) => sq.id !== qid) }
          : b,
      ),
    }));
    onChange(newQs);
    setFocusedPath(parentPath.map((s) => ({ questionId: s.questionId })));
    setActiveBranchId(parentStep.branchId ?? null);
  }

  function moveQuestion(dir: "up" | "down") {
    if (!focusedQuestion) return;
    const qid = focusedQuestion.id;

    if (focusedPath.length === 1) {
      const idx = questions.findIndex((q) => q.id === qid);
      const next = idx + (dir === "up" ? -1 : 1);
      if (next < 0 || next >= questions.length) return;
      const reordered = [...questions];
      [reordered[idx], reordered[next]] = [reordered[next], reordered[idx]];
      onChange(reordered.map((q, i) => ({ ...q, sort_order: i })));
      return;
    }

    const parentPath = focusedPath.slice(0, -1);
    const parentStep = parentPath[parentPath.length - 1];
    onChange(updateAtPath(questions, parentPath, (parentQ) => ({
      ...parentQ,
      branches: parentQ.branches.map((b) => {
        if (b.id !== parentStep.branchId) return b;
        const idx = b.subQuestions.findIndex((sq) => sq.id === qid);
        const next = idx + (dir === "up" ? -1 : 1);
        if (next < 0 || next >= b.subQuestions.length) return b;
        const reordered = [...b.subQuestions];
        [reordered[idx], reordered[next]] = [reordered[next], reordered[idx]];
        return { ...b, subQuestions: reordered };
      }),
    })));
  }

  function addBranch() {
    if (!focusedQuestion || !focusedQuestion.fieldIds.length) return;
    const f = fields.find((fi) => fi.id === focusedQuestion.fieldIds[0]);
    if (!f) return;
    const branch: Branch = {
      id: `b_${generateId()}`,
      condition: { fieldId: f.id, operator: defaultOperatorForKind(f.value_kind), value: defaultValueForKind(f.value_kind) },
      outcome: "continue",
      subQuestions: [],
    };
    mutate((q) => ({ ...q, branches: [...q.branches, branch] }));
    setActiveBranchId(branch.id);
  }

  function deleteBranch(branchId: string) {
    mutate((q) => ({ ...q, branches: q.branches.filter((b) => b.id !== branchId) }));
    if (activeBranchId === branchId) setActiveBranchId(null);
  }

  function addSubQuestion(branchId: string) {
    if (!focusedQuestion) return;
    const newQ: Question = { id: `q_${generateId()}`, text: "", fieldIds: [], sort_order: 0, branches: [] };
    const lastStep = focusedPath[focusedPath.length - 1];
    updateBranch(branchId, (b) => ({ ...b, subQuestions: [...b.subQuestions, newQ] }));
    setFocusedPath([...focusedPath.slice(0, -1), { ...lastStep, branchId }, { questionId: newQ.id }]);
    setActiveBranchId(null);
  }

  function openSubQuestion(branchId: string, subQId: string) {
    const lastStep = focusedPath[focusedPath.length - 1];
    setFocusedPath([...focusedPath.slice(0, -1), { ...lastStep, branchId }, { questionId: subQId }]);
    const subQ = focusedQuestion?.branches.find((b) => b.id === branchId)?.subQuestions.find((q) => q.id === subQId);
    setActiveBranchId(subQ?.branches[0]?.id ?? null);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="grid min-h-[560px] gap-3" style={{ gridTemplateColumns: "260px 1fr" }}>

      {/* ── Left: flow tree ──────────────────────────────────────────────── */}
      <div className="rounded-lg border border-black/8 bg-white p-2">
        <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-foreground/70">Flow</p>
        <div ref={sidebarRef} className="space-y-px">
          {treeItems.map((item) => {
            const isCurrent = pathsEqual(item.path, focusedPath);
            const isOpen = item.hasChildren && focusedIds.has(item.question.id);
            return (
              <div
                key={item.path.map((s) => s.questionId).join(".")}
                data-qid={item.question.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setFocusedPath(item.path);
                  setActiveBranchId(item.question.branches[0]?.id ?? null);
                }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { setFocusedPath(item.path); setActiveBranchId(item.question.branches[0]?.id ?? null); } }}
                className={`flex cursor-pointer items-center gap-1.5 rounded-md py-1 text-xs transition-colors ${
                  isCurrent
                    ? "bg-teal-50 font-medium text-teal-800"
                    : "text-foreground/70 hover:bg-[#f7f9f8] hover:text-foreground/70"
                }`}
                style={{ paddingLeft: `${8 + item.level * 16}px`, paddingRight: "8px" }}
              >
                <span className={`w-2.5 shrink-0 text-[9px] ${isCurrent ? "text-teal-400" : "text-foreground/20"}`}>
                  {item.hasChildren ? (isOpen ? "▾" : "▸") : ""}
                </span>
                <span className={`w-7 shrink-0 font-mono text-[10px] ${isCurrent ? "text-teal-600" : "text-foreground/55"}`}>
                  {item.label}
                </span>
                <span className="truncate">
                  {item.question.text
                    ? resolveVarTokens(item.question.text, customVariables)
                    : <em className="opacity-60">untitled</em>}
                </span>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={addTopLevelQuestion}
          className="mt-3 px-2 text-[11px] text-teal-700 hover:text-teal-900"
        >
          + add question
        </button>
      </div>

      {/* ── Right: focused editor ─────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-col rounded-lg border border-black/8 bg-white p-4">
        {!focusedQuestion ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-foreground/60">
            <p className="text-sm">Select a question from the flow</p>
            <button type="button" onClick={addTopLevelQuestion} className="text-xs text-teal-700 hover:text-teal-900">
              + add first question
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">

            {/* Breadcrumb */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-black/5 pb-3 text-[11px]">
              <button type="button" onClick={() => { setFocusedPath([]); setActiveBranchId(null); }} className="text-foreground/60 transition-colors hover:text-foreground">
                Flow
              </button>
              {ancestors.map((anc) => (
                <span key={anc.path.map((s) => s.questionId).join(".")} className="flex items-center gap-1.5">
                  <span className="text-foreground/20">›</span>
                  <button
                    type="button"
                    onClick={() => { setFocusedPath(anc.path); setActiveBranchId(anc.question.branches[0]?.id ?? null); }}
                    className="flex items-center gap-1.5 rounded bg-[#f7f9f8] px-2 py-0.5 text-foreground/60 hover:bg-teal-50 hover:text-teal-800"
                  >
                    <span className="font-mono text-[10px] text-foreground/55">{anc.label}</span>
                    {anc.branch && (
                      <span className="max-w-[180px] truncate text-[10px] text-teal-600">
                        {describeCondition(anc.branch.condition, fields, customVariables)}
                      </span>
                    )}
                  </button>
                </span>
              ))}
              <span className="text-foreground/20">›</span>
              <span className="rounded bg-[#f7f9f8] px-2 py-0.5 font-mono text-[10px] text-foreground/60">
                {currentItem?.label}
              </span>
            </div>

            {/* Question card */}
            <div className="flex flex-col rounded-xl border border-black/8 bg-white">

              {/* Question text + metadata */}
              <div className="flex flex-col gap-3 p-5 pb-4">
                {(() => {
                  const hasTokens = /\{\{[a-z][a-z0-9_]*\}\}/.test(focusedQuestion.text);
                  const showOverlay = hasTokens && !questionFocused;
                  return (
                    <div className="relative">
                      <input
                        ref={questionInputRef}
                        type="text"
                        value={focusedQuestion.text}
                        onChange={(e) => mutate((q) => ({ ...q, text: e.target.value }))}
                        onSelect={() => { questionCursorRef.current = questionInputRef.current?.selectionStart ?? 0; }}
                        onFocus={() => setQuestionFocused(true)}
                        onBlur={() => { setQuestionFocused(false); questionCursorRef.current = questionInputRef.current?.selectionStart ?? questionCursorRef.current; }}
                        placeholder="Type the question the AI will ask…"
                        className={`w-full rounded-lg border border-foreground/10 bg-[#f7f9f8] px-4 py-3 text-lg placeholder:text-foreground/25 focus:border-teal-700/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-700/20 ${showOverlay ? "text-transparent caret-transparent" : "text-foreground"}`}
                      />
                      {showOverlay && (
                        <div
                          className="pointer-events-none absolute inset-0 flex flex-wrap items-center gap-x-1 gap-y-0.5 overflow-hidden rounded-lg border border-transparent bg-[#f7f9f8] px-4 py-3 text-lg"
                          aria-hidden
                        >
                          <QuestionChipOverlay text={focusedQuestion.text} variables={customVariables} />
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Captures + insert — single row */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-0.5">
                  {/* Captures */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-foreground/30">Captures</span>
                    {focusedQuestion.fieldIds.length > 0 ? (
                      <>
                        {focusedQuestion.fieldIds.map((fid) => {
                          const f = fields.find((x) => x.id === fid);
                          return (
                            <span key={fid} className="rounded border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-800">
                              {f?.label || fid}
                            </span>
                          );
                        })}
                        <button
                          ref={fieldPickerBtnRef}
                          type="button"
                          onClick={() => { setFieldPickerAnchor(fieldPickerBtnRef.current?.getBoundingClientRect() ?? null); setFieldPickerOpen(true); }}
                          className="text-[10px] text-foreground/35 hover:text-teal-700 transition-colors"
                        >
                          Edit
                        </button>
                      </>
                    ) : (
                      <button
                        ref={fieldPickerBtnRef}
                        type="button"
                        onClick={() => { setFieldPickerAnchor(fieldPickerBtnRef.current?.getBoundingClientRect() ?? null); setFieldPickerOpen(true); }}
                        disabled={fields.length === 0}
                        className="rounded border border-teal-700/20 bg-teal-50/40 px-2 py-0.5 text-[11px] font-medium text-teal-700 transition-colors hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {fields.length === 0 ? "Add fields first" : "Link field…"}
                      </button>
                    )}
                    <FieldPickerPopover
                      open={fieldPickerOpen && fields.length > 0}
                      anchorRect={fieldPickerAnchor}
                      fields={fields}
                      selectedIds={focusedQuestion.fieldIds}
                      lockedFieldIds={lockedFieldIds}
                      onChange={(next) => {
                        const kept = new Set(
                          (focusedQuestion?.branches ?? [])
                            .filter((b) => next.includes(b.condition.fieldId))
                            .map((b) => b.id),
                        );
                        mutate((q) => ({ ...q, fieldIds: next, branches: q.branches.filter((b) => kept.has(b.id)) }));
                        if (activeBranchId && !kept.has(activeBranchId)) setActiveBranchId(null);
                      }}
                      onClose={() => setFieldPickerOpen(false)}
                      onCreateField={onCreateField ? (label) => {
                        const newId = onCreateField(label);
                        mutate((q) => ({ ...q, fieldIds: [...q.fieldIds, newId] }));
                      } : undefined}
                    />
                  </div>

                  {/* Insert variable chips */}
                  {customVariables.length > 0 && (
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-foreground/25">Insert</span>
                      {customVariables.map((v, i) => (
                        <button
                          key={v.id || i}
                          type="button"
                          onClick={() => insertVarIntoQuestion(`{{${v.id}}}`)}
                          className="rounded-full border border-violet-200/70 bg-violet-50/60 px-2 py-px text-[10px] font-medium text-violet-600/80 transition-colors hover:bg-violet-100 hover:text-violet-700"
                          title={`Insert {{${v.id}}} at cursor`}
                        >
                          {v.label || v.id}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Branches */}
              <div className="border-t border-black/6 px-5 pt-4 pb-5">
              <div className="flex flex-wrap gap-1">
                {focusedQuestion.branches.map((branch, branchIdx) => {
                  const cfg = OUTCOME_CFG[branch.outcome];
                  const isActive = activeBranchId === branch.id;
                  const fullLabel = describeCondition(branch.condition, fields, customVariables);
                  return (
                    <button
                      key={branch.id}
                      type="button"
                      title={fullLabel}
                      onClick={() => setActiveBranchId(branch.id)}
                      className={`flex items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-1.5 text-[11px] transition-colors ${
                        isActive
                          ? "border-teal-300 bg-teal-50 font-medium text-teal-900 shadow-sm"
                          : "border-black/8 bg-[#f7f9f8] text-foreground/50 hover:bg-white hover:text-foreground/70"
                      }`}
                    >
                      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${cfg.iconCls}`}>
                        {branchIdx + 1}
                      </span>
                      <span className="max-w-[220px] truncate text-[11px]">
                        {fullLabel}
                      </span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={addBranch}
                  disabled={focusedQuestion.fieldIds.length === 0}
                  className="rounded-t-md border border-b-0 border-dashed border-foreground/15 px-3 py-1.5 text-[11px] text-foreground/35 hover:text-foreground/60 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  + add branch
                </button>
                {focusedQuestion.fieldIds.length === 0 && (
                  <span className="self-center text-[10px] text-foreground/30">
                    — link a field first
                  </span>
                )}
              </div>

              {/* Active branch body */}
              {activeBranch ? (
                <div className="overflow-hidden rounded-b-lg rounded-tr-lg border border-teal-200/70 bg-teal-50/20">

                  {/* Sentence builder */}
                  <div className="p-4 flex flex-col gap-4">
                    <ConditionEditor
                      condition={activeBranch.condition}
                      fields={fields.filter((f) => focusedQuestion.fieldIds.includes(f.id))}
                      customVars={customVariables}
                      onChange={(c) => updateBranch(activeBranch.id, (b) => ({ ...b, condition: c }))}
                    />

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground/40">then</span>
                      <select
                        value={activeBranch.outcome}
                        onChange={(e) =>
                          updateBranch(activeBranch.id, (b) => ({
                            ...b,
                            outcome: e.target.value as BranchOutcome,
                            subQuestions: e.target.value === "followups" ? b.subQuestions : [],
                          }))
                        }
                        className="w-fit rounded-md border border-foreground/12 bg-white px-2.5 py-1.5 text-sm text-foreground focus:border-teal-700/40 focus:outline-none focus:ring-2 focus:ring-teal-700/10"
                      >
                        {(Object.entries(OUTCOME_CFG) as [BranchOutcome, OutcomeCfg][]).map(([outcome, cfg]) => (
                          <option key={outcome} value={outcome}>{cfg.label}</option>
                        ))}
                      </select>
                    </div>

                    {/* Follow-up questions */}
                    {activeBranch.outcome === "followups" && (
                      <div className="flex flex-col gap-2">
                        {activeBranch.subQuestions.map((sq, sqIdx) => {
                          const sqItem = treeItems.find((t) => t.question.id === sq.id);
                          const isDraggingOver = dragOverSubIdx === sqIdx && dragSubIdx !== sqIdx;
                          return (
                            <div
                              key={sq.id}
                              draggable
                              onDragStart={() => setDragSubIdx(sqIdx)}
                              onDragOver={(e) => { e.preventDefault(); setDragOverSubIdx(sqIdx); }}
                              onDrop={() => {
                                if (dragSubIdx === null || dragSubIdx === sqIdx) { setDragSubIdx(null); setDragOverSubIdx(null); return; }
                                const sqs = [...activeBranch.subQuestions];
                                const [moved] = sqs.splice(dragSubIdx, 1);
                                sqs.splice(sqIdx, 0, moved);
                                updateBranch(activeBranch.id, (b) => ({ ...b, subQuestions: sqs }));
                                setDragSubIdx(null); setDragOverSubIdx(null);
                              }}
                              onDragEnd={() => { setDragSubIdx(null); setDragOverSubIdx(null); }}
                              className={`flex items-center gap-2 rounded-lg border p-2.5 max-w-xl transition-colors ${
                                isDraggingOver ? "border-teal-400 bg-teal-50" : "border-teal-100 bg-teal-50/40"
                              } ${dragSubIdx === sqIdx ? "opacity-40" : ""}`}
                            >
                              <span className="shrink-0 cursor-grab text-foreground/25 hover:text-foreground/50 active:cursor-grabbing">
                                <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor" aria-hidden>
                                  <circle cx="3" cy="2.5" r="1.2"/><circle cx="9" cy="2.5" r="1.2"/>
                                  <circle cx="3" cy="7" r="1.2"/><circle cx="9" cy="7" r="1.2"/>
                                  <circle cx="3" cy="11.5" r="1.2"/><circle cx="9" cy="11.5" r="1.2"/>
                                </svg>
                              </span>
                              <span className="w-6 shrink-0 font-mono text-[10px] text-teal-600">
                                {sqItem?.label ?? "—"}
                              </span>
                              <span className="flex-1 truncate text-sm text-foreground/80 italic">
                                {sq.text ? `"${sq.text}"` : <em className="text-foreground/35">"untitled"</em>}
                              </span>
                              <button
                                type="button"
                                onClick={() => openSubQuestion(activeBranch.id, sq.id)}
                                className="shrink-0 rounded border border-teal-200 bg-white px-2 py-1 text-[11px] font-medium text-teal-700 transition-colors hover:bg-teal-50"
                              >
                                Edit →
                              </button>
                            </div>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() => addSubQuestion(activeBranch.id)}
                          className="w-fit text-sm font-medium text-teal-700 hover:text-teal-900"
                        >
                          + Add follow-up question
                        </button>
                      </div>
                    )}

                    {/* Rejection message */}
                    {activeBranch.outcome === "reject" && (
                      <div className="flex flex-col gap-1.5 rounded-md border border-foreground/10 bg-foreground/[0.02] p-2.5">
                        <span className="text-[11px] text-foreground/40">Message shown to applicant</span>
                        <textarea
                          rows={2}
                          value={activeBranch.customMessage ?? ""}
                          onChange={(e) => updateBranch(activeBranch.id, (b) => ({ ...b, customMessage: e.target.value }))}
                          placeholder={aiInstructions?.rejectionPrompt || "Explain why the applicant doesn't qualify…"}
                          className="w-full resize-none rounded-md border border-foreground/10 bg-white px-2 py-1.5 text-sm text-foreground placeholder:text-foreground/30 focus:border-teal-700/30 focus:outline-none focus:ring-1 focus:ring-teal-700/10"
                        />
                      </div>
                    )}
                  </div>

                  {/* Delete branch */}
                  <div className="flex justify-end px-4 pb-3">
                    <button
                      type="button"
                      onClick={() => deleteBranch(activeBranch.id)}
                      className="text-[11px] text-foreground/25 hover:text-red-400 transition-colors"
                    >
                      Delete branch
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-b-lg rounded-tr-lg border border-dashed border-foreground/10 p-3">
                  <p className="text-[11px] italic text-foreground/55">
                    {focusedQuestion.branches.length === 0
                      ? "No branches — always continues to the next question."
                      : "Select a branch above to edit it."}
                  </p>
                </div>
              )}

              {focusedQuestion.branches.length > 0 && (
                <p className="mt-2 text-[11px] italic text-foreground/40">
                  Default: continue if no branch matches.
                </p>
              )}
              </div>
            </div>

            <div className="flex items-center justify-between pt-1 pr-14">
              <button
                type="button"
                onClick={deleteQuestion}
                className="text-[11px] text-red-500 hover:text-red-700"
              >
                Delete question
              </button>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => moveQuestion("up")}
                  title="Move up"
                  className="rounded border border-foreground/10 px-1.5 py-0.5 text-[11px] text-foreground/40 hover:border-foreground/20 hover:text-foreground/70 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveQuestion("down")}
                  title="Move down"
                  className="rounded border border-foreground/10 px-1.5 py-0.5 text-[11px] text-foreground/40 hover:border-foreground/20 hover:text-foreground/70 disabled:opacity-30"
                >
                  ↓
                </button>
              </div>
            </div>

          </div>
        )}


      </div>
    </div>
  );
}
