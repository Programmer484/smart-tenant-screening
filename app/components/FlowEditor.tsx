"use client";

import { useMemo, useRef, useState } from "react";
import { FieldPickerPopover } from "@/app/components/FieldPickerPopover";
import type { Question, Branch, BranchOutcome } from "@/lib/question";
import type { LandlordField } from "@/lib/landlord-field";
import { OPERATORS_BY_KIND, defaultOperatorForKind, defaultValueForKind } from "@/lib/landlord-rule";
import type { PropertyVariable } from "@/lib/property";
import { VariablePickerPopover } from "@/app/components/VariablePickerPopover";

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

function genId() { return Math.random().toString(36).slice(2, 9); }

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

// ─── Branch label helpers ─────────────────────────────────────────────────────

const OP_SHORT: Record<string, string> = {
  "==": "=", "!=": "≠", ">": ">", ">=": "≥", "<": "<", "<=": "≤",
};

function describeBranch(branch: Branch, fields: LandlordField[]): string {
  const { fieldId, operator, value } = branch.condition;
  const field = fields.find((f) => f.id === fieldId);
  const label = field?.label ?? fieldId;
  if (field?.value_kind === "boolean") return `${label} = ${value === "true" ? "Yes" : "No"}`;
  return `${label} ${OP_SHORT[operator] ?? operator} ${value}`;
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
  review:    { label: "Manual review",  icon: "!", iconCls: "bg-amber-50 text-amber-700",          activeCls: "bg-amber-50 border-amber-300 text-amber-800" },
  reject:    { label: "Reject",         icon: "×", iconCls: "bg-red-50 text-red-600",              activeCls: "bg-red-50 border-red-300 text-red-700" },
};

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
  // Unified source: fields + variables (variables use their key as id)
  const varAsField = customVars.map((v) => ({
    id: v.key,
    label: v.label || v.key,
    value_kind: v.value_kind ?? "text" as const,
    options: undefined as string[] | undefined,
  }));
  const allSources = [...fields, ...varAsField];
  const source = allSources.find((s) => s.id === condition.fieldId);
  // Keep backward-compat alias
  const field = fields.find((f) => f.id === condition.fieldId);
  const ops = source ? (OPERATORS_BY_KIND[source.value_kind] ?? []) : [];
  const valueInputRef = useRef<HTMLInputElement>(null);
  const valueCursorRef = useRef<number>(0);
  const varBtnRef = useRef<HTMLButtonElement>(null);
  const [varPickerOpen, setVarPickerOpen] = useState(false);
  const [varPickerAnchor, setVarPickerAnchor] = useState<DOMRect | null>(null);

  const isDropdownValue =
    source?.value_kind === "boolean" ||
    (source?.value_kind === "enum" && (field?.options?.length ?? 0) > 0);

  function insertVar(token: string) {
    const pos = valueCursorRef.current;
    const newVal = condition.value.slice(0, pos) + token + condition.value.slice(pos);
    const newPos = pos + token.length;
    valueCursorRef.current = newPos;
    onChange({ ...condition, value: newVal });
    requestAnimationFrame(() => {
      valueInputRef.current?.focus();
      valueInputRef.current?.setSelectionRange(newPos, newPos);
    });
  }

  const selectCls = "rounded-md border border-foreground/15 bg-white px-2.5 py-1.5 text-sm font-medium text-foreground shadow-sm focus:border-teal-700/40 focus:outline-none focus:ring-2 focus:ring-teal-700/10";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-medium text-foreground/40">when</span>
      <select
        value={condition.fieldId}
        onChange={(e) => {
          const s = allSources.find((s) => s.id === e.target.value);
          if (!s) return;
          onChange({ fieldId: s.id, operator: defaultOperatorForKind(s.value_kind), value: defaultValueForKind(s.value_kind) });
        }}
        className={selectCls}
      >
        {allSources.length === 0 && <option value="">— no fields or variables —</option>}
        {fields.length > 0 && (
          <optgroup label="Fields">
            {fields.map((f) => (
              <option key={f.id} value={f.id}>{f.label || f.id}</option>
            ))}
          </optgroup>
        )}
        {varAsField.length > 0 && (
          <optgroup label="Variables">
            {varAsField.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </optgroup>
        )}
      </select>
      <select
        value={condition.operator}
        onChange={(e) => onChange({ ...condition, operator: e.target.value })}
        className={selectCls}
      >
        {ops.map((op) => <option key={op} value={op}>{op}</option>)}
      </select>
      {field?.value_kind === "boolean" ? (
        <select
          value={condition.value}
          onChange={(e) => onChange({ ...condition, value: e.target.value })}
          className={selectCls}
        >
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      ) : field?.value_kind === "enum" && field.options?.length ? (
        <select
          value={condition.value}
          onChange={(e) => onChange({ ...condition, value: e.target.value })}
          className={selectCls}
        >
          {field.options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : (
        <input
          ref={valueInputRef}
          type={source?.value_kind === "number" ? "number" : "text"}
          value={condition.value}
          onChange={(e) => onChange({ ...condition, value: e.target.value })}
          onSelect={() => { valueCursorRef.current = valueInputRef.current?.selectionStart ?? 0; }}
          onBlur={() => { valueCursorRef.current = valueInputRef.current?.selectionStart ?? valueCursorRef.current; }}
          placeholder="value"
          className="w-24 rounded border border-foreground/10 bg-white px-2 py-1 font-mono text-[11px] text-foreground focus:border-teal-700/40 focus:outline-none"
        />
      )}
      {!isDropdownValue && (
        <>
          <button
            ref={varBtnRef}
            type="button"
            disabled={customVars.length === 0}
            onClick={() => {
              setVarPickerAnchor(varBtnRef.current?.getBoundingClientRect() ?? null);
              setVarPickerOpen(true);
            }}
            className="rounded-lg border border-indigo-200/80 bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700 transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-35"
          >
            {"{ } var"}
          </button>
          <VariablePickerPopover
            open={varPickerOpen}
            anchorRect={varPickerAnchor}
            variables={customVars}
            onInsert={insertVar}
            onClose={() => setVarPickerOpen(false)}
          />
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
  onChange,
  onCreateField,
  onGenerateTargeted,
}: {
  questions: Question[];
  fields: LandlordField[];
  customVariables?: PropertyVariable[];
  onChange: (qs: Question[]) => void;
  onCreateField?: (label: string) => string;
  onGenerateTargeted?: (prompt: string, question: Question) => Promise<{ updatedQuestion?: Question }>;
}) {
  const [focusedPath, setFocusedPath] = useState<NavPath>([]);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [fieldPickerOpen, setFieldPickerOpen] = useState(false);
  const [fieldPickerAnchor, setFieldPickerAnchor] = useState<DOMRect | null>(null);
  const fieldPickerBtnRef = useRef<HTMLButtonElement>(null);
  const questionInputRef = useRef<HTMLInputElement>(null);
  const questionCursorRef = useRef<number>(0);
  const varPickerBtnRef = useRef<HTMLButtonElement>(null);
  const [varPickerOpen, setVarPickerOpen] = useState(false);
  const [varPickerAnchor, setVarPickerAnchor] = useState<DOMRect | null>(null);
  const [aiEditPrompt, setAiEditPrompt] = useState("");
  const [isGeneratingTargeted, setIsGeneratingTargeted] = useState(false);

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
    const newQ: Question = { id: `q_${genId()}`, text: "", fieldIds: [], sort_order: questions.length, branches: [] };
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
    if (!focusedQuestion || !fields.length) return;
    const f = fields[0];
    const branch: Branch = {
      id: `b_${genId()}`,
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
    const newQ: Question = { id: `q_${genId()}`, text: "", fieldIds: [], sort_order: 0, branches: [] };
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
        <div className="space-y-px">
          {treeItems.map((item) => {
            const isCurrent = pathsEqual(item.path, focusedPath);
            const isOpen = item.hasChildren && focusedIds.has(item.question.id);
            return (
              <div
                key={item.path.map((s) => s.questionId).join(".")}
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
                  {item.question.text || <em className="opacity-60">untitled</em>}
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
                      <span className="font-mono text-[10px] text-teal-600">
                        {anc.branch.condition.fieldId} {anc.branch.condition.operator} {anc.branch.condition.value}
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
            <div className="rounded-lg border border-black/8 p-4">

              {/* Question text */}
              <div className="mb-4">
                <input
                  ref={questionInputRef}
                  type="text"
                  value={focusedQuestion.text}
                  onChange={(e) => mutate((q) => ({ ...q, text: e.target.value }))}
                  onSelect={() => { questionCursorRef.current = questionInputRef.current?.selectionStart ?? 0; }}
                  onBlur={() => { questionCursorRef.current = questionInputRef.current?.selectionStart ?? questionCursorRef.current; }}
                  placeholder="Question text…"
                  className="w-full rounded-lg border border-foreground/10 bg-[#f7f9f8] px-3 py-2.5 text-sm text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                />
              </div>


              {/* Variables */}
              <div className="mb-4 flex items-center gap-3">
                <span className="text-sm font-medium text-foreground/60">Variables</span>
                <div className="flex items-center gap-2">
                  <button
                    ref={varPickerBtnRef}
                    type="button"
                    onClick={() => {
                      setVarPickerAnchor(varPickerBtnRef.current?.getBoundingClientRect() ?? null);
                      setVarPickerOpen(true);
                    }}
                    className="rounded-md border border-violet-200/80 bg-violet-50/50 px-3 py-1 text-xs font-medium text-violet-800 shadow-sm transition-colors hover:bg-violet-50"
                  >
                    Insert variable…
                  </button>
                </div>
                <VariablePickerPopover
                  open={varPickerOpen}
                  anchorRect={varPickerAnchor}
                  variables={customVariables}
                  onInsert={insertVarIntoQuestion}
                  onClose={() => setVarPickerOpen(false)}
                />
              </div>

              {/* Linked fields */}
              <div className="mb-6 flex items-center gap-3">
                <span className="text-sm font-medium text-foreground/60">Linked field</span>
                <div className="flex items-center gap-2">
                  {focusedQuestion.fieldIds.length > 0 ? (
                    <>
                      {focusedQuestion.fieldIds.map((fid) => {
                        const f = fields.find((x) => x.id === fid);
                        return (
                          <span
                            key={fid}
                            title={fid}
                            className="rounded-md border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-800 shadow-sm"
                          >
                            {f?.label || f?.id || fid}
                          </span>
                        );
                      })}
                      <button
                        ref={fieldPickerBtnRef}
                        type="button"
                        onClick={() => {
                          setFieldPickerAnchor(fieldPickerBtnRef.current?.getBoundingClientRect() ?? null);
                          setFieldPickerOpen(true);
                        }}
                        className="text-xs font-medium text-teal-700 hover:underline"
                      >
                        [Edit]
                      </button>
                    </>
                  ) : (
                    <button
                      ref={fieldPickerBtnRef}
                      type="button"
                      onClick={() => {
                        setFieldPickerAnchor(fieldPickerBtnRef.current?.getBoundingClientRect() ?? null);
                        setFieldPickerOpen(true);
                      }}
                      disabled={fields.length === 0}
                      className="rounded-md border border-teal-700/25 bg-teal-50/50 px-3 py-1 text-xs font-medium text-teal-800 transition-colors hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-40 shadow-sm"
                    >
                      {fields.length === 0 ? "Add fields in the Fields tab first" : "Link field…"}
                    </button>
                  )}
                </div>
                <FieldPickerPopover
                  open={fieldPickerOpen && fields.length > 0}
                  anchorRect={fieldPickerAnchor}
                  fields={fields}
                  selectedIds={focusedQuestion.fieldIds}
                  lockedFieldIds={lockedFieldIds}
                  onChange={(next) => mutate((q) => ({ ...q, fieldIds: next }))}
                  onClose={() => setFieldPickerOpen(false)}
                  onCreateField={onCreateField ? (label) => {
                    const newId = onCreateField(label);
                    mutate((q) => ({ ...q, fieldIds: [...q.fieldIds, newId] }));
                  } : undefined}
                />
              </div>

              {/* Branch tabs */}
              <p className="mb-1.5 text-[10px] font-medium text-foreground/40">Branches</p>
              <div className="flex flex-wrap gap-1">
                {focusedQuestion.branches.map((branch) => {
                  const cfg = OUTCOME_CFG[branch.outcome];
                  const isActive = activeBranchId === branch.id;
                  return (
                    <button
                      key={branch.id}
                      type="button"
                      onClick={() => setActiveBranchId(branch.id)}
                      className={`flex items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-1.5 text-[11px] transition-colors ${
                        isActive
                          ? "border-teal-200 bg-teal-50/60 text-teal-800"
                          : "border-black/8 bg-[#f7f9f8] text-foreground/50 hover:bg-white hover:text-foreground/70"
                      }`}
                    >
                      <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${cfg.iconCls}`}>
                        {cfg.icon}
                      </span>
                      <span className="max-w-[160px] truncate text-[11px]">
                        {describeBranch(branch, fields)}
                      </span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={addBranch}
                  disabled={fields.length === 0}
                  className="rounded-t-md border border-b-0 border-dashed border-foreground/15 px-3 py-1.5 text-[11px] text-foreground/35 hover:text-foreground/60 disabled:opacity-40"
                >
                  + add branch
                </button>
              </div>

              {/* Active branch body */}
              {activeBranch ? (
                <div className="mt-4 rounded-xl border border-black/8 bg-slate-50/50 shadow-sm overflow-hidden">

                  {/* Sentence builder */}
                  <div className="p-4 border-b border-black/5 flex flex-col gap-3">
                    <ConditionEditor
                      condition={activeBranch.condition}
                      fields={fields}
                      customVars={customVariables}
                      onChange={(c) => updateBranch(activeBranch.id, (b) => ({ ...b, condition: c }))}
                    />

                    <div className="flex flex-wrap items-start gap-2">
                      <span className="mt-1 text-sm font-medium text-foreground/60">then</span>
                      <div className="flex flex-col gap-3 flex-1 min-w-0">
                        <select
                          value={activeBranch.outcome}
                          onChange={(e) =>
                            updateBranch(activeBranch.id, (b) => ({
                              ...b,
                              outcome: e.target.value as BranchOutcome,
                              subQuestions: e.target.value === "followups" ? b.subQuestions : [],
                            }))
                          }
                          className="w-fit rounded-md border border-foreground/15 bg-white px-2.5 py-1.5 text-sm font-medium text-foreground shadow-sm focus:border-teal-700/40 focus:outline-none focus:ring-2 focus:ring-teal-700/10"
                        >
                          {(Object.entries(OUTCOME_CFG) as [BranchOutcome, OutcomeCfg][]).map(([outcome, cfg]) => (
                            <option key={outcome} value={outcome}>
                              {cfg.label}
                            </option>
                          ))}
                        </select>

                        {/* Sub-questions (followups) placed directly inside the "then" block for sentence flow */}
                        {activeBranch.outcome === "followups" && (
                          <div className="flex flex-col gap-2">
                            {activeBranch.subQuestions.map((sq) => {
                              const sqItem = treeItems.find((t) => t.question.id === sq.id);
                              return (
                                <div key={sq.id} className="flex items-center gap-2 rounded-lg border border-teal-100 bg-teal-50/40 p-2.5 max-w-xl">
                                  <span className="w-6 shrink-0 font-mono text-[10px] text-teal-600">
                                    {sqItem?.label ?? "—"}
                                  </span>
                                  <span className="flex-1 truncate text-sm text-foreground/80 italic">
                                    {sq.text ? `"${sq.text}"` : <em className="text-foreground/35">"untitled"</em>}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => openSubQuestion(activeBranch.id, sq.id)}
                                    className="shrink-0 rounded bg-white px-2 py-1 text-[11px] font-medium text-teal-700 border border-teal-200 shadow-sm hover:bg-teal-50 transition-colors"
                                  >
                                    Edit →
                                  </button>
                                </div>
                              );
                            })}
                            <button
                              type="button"
                              onClick={() => addSubQuestion(activeBranch.id)}
                              className="w-fit text-sm font-medium text-teal-700 hover:text-teal-900 mt-1"
                            >
                              + Add follow-up question
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Delete branch */}
                  <div className="bg-slate-100/50 p-2.5 flex justify-end">
                    <button
                      type="button"
                      onClick={() => deleteBranch(activeBranch.id)}
                      className="text-[11px] text-red-500 hover:text-red-700"
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
                <p className="mt-2 text-[11px] italic text-foreground/55">
                  Default: continue if no branch matches.
                </p>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-black/5 pt-2 pr-14">
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
