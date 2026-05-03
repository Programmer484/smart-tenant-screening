"use client";

import { useState } from "react";
import type { Question, Branch, BranchOutcome } from "@/lib/question";
import type { LandlordField } from "@/lib/landlord-field";
import { OPERATORS_BY_KIND, defaultOperatorForKind, defaultValueForKind } from "@/lib/landlord-rule";

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
  expandedIds: Set<string>,
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

    const isOpen = expandedIds.has(q.id) || focusedIds.has(q.id);
    if (isOpen && hasChildren) {
      let nextIdx = 0;
      for (const branch of followupBranches) {
        items.push(
          ...buildTree(
            branch.subQuestions,
            [...pathPrefix, { questionId: q.id, branchId: branch.id }],
            expandedIds,
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
  continue:  { label: "Continue",       icon: "↓", iconCls: "bg-zinc-100 text-zinc-500",    activeCls: "bg-zinc-50 border-zinc-300 text-zinc-700" },
  followups: { label: "Add follow-ups", icon: "+", iconCls: "bg-emerald-50 text-emerald-700", activeCls: "bg-emerald-50 border-emerald-300 text-emerald-800" },
  review:    { label: "Manual review",  icon: "!", iconCls: "bg-amber-50 text-amber-700",    activeCls: "bg-amber-50 border-amber-300 text-amber-800" },
  reject:    { label: "Reject",         icon: "×", iconCls: "bg-red-50 text-red-700",        activeCls: "bg-red-50 border-red-300 text-red-800" },
};

// ─── Condition editor ─────────────────────────────────────────────────────────

function ConditionEditor({
  condition,
  fields,
  onChange,
}: {
  condition: { fieldId: string; operator: string; value: string };
  fields: LandlordField[];
  onChange: (c: { fieldId: string; operator: string; value: string }) => void;
}) {
  const field = fields.find((f) => f.id === condition.fieldId);
  const ops = field ? (OPERATORS_BY_KIND[field.value_kind] ?? []) : [];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-medium text-violet-600">when</span>
      <select
        value={condition.fieldId}
        onChange={(e) => {
          const f = fields.find((f) => f.id === e.target.value);
          if (!f) return;
          onChange({ fieldId: f.id, operator: defaultOperatorForKind(f.value_kind), value: defaultValueForKind(f.value_kind) });
        }}
        className="rounded border border-violet-200 bg-white px-2 py-1 font-mono text-[11px] text-zinc-800 focus:border-violet-400 focus:outline-none"
      >
        {fields.length === 0 && <option value="">— no fields —</option>}
        {fields.map((f) => (
          <option key={f.id} value={f.id}>{f.id}</option>
        ))}
      </select>
      <select
        value={condition.operator}
        onChange={(e) => onChange({ ...condition, operator: e.target.value })}
        className="rounded border border-violet-200 bg-white px-2 py-1 text-[11px] text-violet-700 focus:border-violet-400 focus:outline-none"
      >
        {ops.map((op) => <option key={op} value={op}>{op}</option>)}
      </select>
      <input
        type="text"
        value={condition.value}
        onChange={(e) => onChange({ ...condition, value: e.target.value })}
        placeholder="value"
        className="w-24 rounded border border-violet-200 bg-white px-2 py-1 font-mono text-[11px] text-zinc-800 focus:border-violet-400 focus:outline-none"
      />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function FlowEditor({
  questions,
  fields,
  onChange,
}: {
  questions: Question[];
  fields: LandlordField[];
  onChange: (qs: Question[]) => void;
}) {
  const [focusedPath, setFocusedPath] = useState<NavPath>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);

  const focusedIds = new Set(focusedPath.map((s) => s.questionId));
  const treeItems = buildTree(questions, [], expandedIds, focusedPath, [], 0);
  const focusedQuestion = getAtPath(questions, focusedPath);
  const currentItem = treeItems.find((t) => pathsEqual(t.path, focusedPath));
  const activeBranch = focusedQuestion?.branches.find((b) => b.id === activeBranchId) ?? null;

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

  // ── Actions ─────────────────────────────────────────────────────────────────

  function addTopLevelQuestion() {
    const newQ: Question = { id: `q_${genId()}`, text: "", fieldIds: [], sort_order: questions.length, branches: [] };
    onChange([...questions, newQ]);
    setFocusedPath([{ questionId: newQ.id }]);
    setActiveBranchId(null);
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
    <div className="grid min-h-[560px] gap-3" style={{ gridTemplateColumns: "200px 1fr" }}>

      {/* ── Left: flow tree ──────────────────────────────────────────────── */}
      <div className="rounded-lg border border-black/8 bg-white p-2">
        <p className="mb-2 px-2 text-[10px] text-zinc-400">Flow</p>
        <div className="space-y-px">
          {treeItems.map((item) => {
            const isCurrent = pathsEqual(item.path, focusedPath);
            const isAncestorOpen = focusedIds.has(item.question.id) || expandedIds.has(item.question.id);
            const showOpen = item.hasChildren && isAncestorOpen;
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
                    ? "bg-violet-50 font-medium text-violet-800"
                    : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700"
                }`}
                style={{ paddingLeft: `${8 + item.level * 16}px`, paddingRight: "8px" }}
              >
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!item.hasChildren) return;
                    setExpandedIds((prev) => {
                      const next = new Set(prev);
                      next.has(item.question.id) ? next.delete(item.question.id) : next.add(item.question.id);
                      return next;
                    });
                  }}
                  onKeyDown={() => {}}
                  className={`w-2.5 shrink-0 text-[9px] ${isCurrent ? "text-violet-400" : "text-zinc-300"}`}
                >
                  {item.hasChildren ? (showOpen ? "▾" : "▸") : ""}
                </span>
                <span className={`w-7 shrink-0 font-mono text-[10px] ${isCurrent ? "text-violet-600" : "text-zinc-400"}`}>
                  {item.label}
                </span>
                <span className="truncate">
                  {item.question.text || <em className="opacity-40">untitled</em>}
                </span>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={addTopLevelQuestion}
          className="mt-3 px-2 text-[11px] text-blue-600 hover:text-blue-800"
        >
          + add question
        </button>
      </div>

      {/* ── Right: focused editor ─────────────────────────────────────────── */}
      <div className="flex flex-col rounded-lg border border-black/8 bg-white p-4">
        {!focusedQuestion ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-zinc-400">
            <p className="text-sm">Select a question from the flow</p>
            <button type="button" onClick={addTopLevelQuestion} className="text-xs text-blue-600 hover:text-blue-800">
              + add first question
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">

            {/* Breadcrumb */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-black/5 pb-3 text-[11px]">
              <button type="button" onClick={() => { setFocusedPath([]); setActiveBranchId(null); }} className="text-blue-600 hover:text-blue-800">
                Flow
              </button>
              {ancestors.map((anc) => (
                <span key={anc.path.map((s) => s.questionId).join(".")} className="flex items-center gap-1.5">
                  <span className="text-zinc-300">›</span>
                  <button
                    type="button"
                    onClick={() => { setFocusedPath(anc.path); setActiveBranchId(anc.question.branches[0]?.id ?? null); }}
                    className="flex items-center gap-1.5 rounded bg-zinc-100 px-2 py-0.5 text-zinc-600 hover:bg-violet-50 hover:text-violet-800"
                  >
                    <span className="font-mono text-[10px] text-zinc-400">{anc.label}</span>
                    {anc.branch && (
                      <span className="font-mono text-[10px] text-violet-600">
                        {anc.branch.condition.fieldId} {anc.branch.condition.operator} {anc.branch.condition.value}
                      </span>
                    )}
                  </button>
                </span>
              ))}
              <span className="text-zinc-300">›</span>
              <span className="rounded bg-zinc-100 px-2 py-0.5 font-mono text-[10px] text-zinc-600">
                {currentItem?.label}
              </span>
              {focusedPath.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    const parentPath = focusedPath.slice(0, -1).map((s) => ({ questionId: s.questionId }));
                    const parentQ = getAtPath(questions, parentPath);
                    setFocusedPath(parentPath);
                    setActiveBranchId(parentQ?.branches[0]?.id ?? null);
                  }}
                  className="ml-auto rounded bg-zinc-100 px-2 py-0.5 text-zinc-500 hover:bg-zinc-200"
                >
                  ↑ zoom out
                </button>
              )}
            </div>

            {/* Ancestor context */}
            {ancestors.length > 0 && (
              <div>
                <p className="mb-1.5 text-[10px] text-zinc-400">Path so far</p>
                {ancestors.map((anc) => (
                  <button
                    key={anc.path.map((s) => s.questionId).join(".")}
                    type="button"
                    onClick={() => { setFocusedPath(anc.path); setActiveBranchId(anc.question.branches[0]?.id ?? null); }}
                    className="mb-1 flex w-full items-center gap-2 rounded-md bg-zinc-50 px-3 py-2 text-left text-xs text-zinc-600 hover:bg-violet-50 hover:text-violet-800"
                  >
                    <span className="w-8 shrink-0 font-mono text-[10px] text-zinc-400">{anc.label}</span>
                    <span className="flex-1 truncate">{anc.question.text || "(untitled)"}</span>
                    {anc.branch && (
                      <span className="shrink-0 rounded bg-violet-50 px-1.5 py-0.5 font-mono text-[10px] text-violet-700">
                        {anc.branch.condition.fieldId} {anc.branch.condition.operator} {anc.branch.condition.value}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Question card */}
            <div className="rounded-lg border border-black/8 p-4">

              {/* Question text */}
              <input
                type="text"
                value={focusedQuestion.text}
                onChange={(e) => mutate((q) => ({ ...q, text: e.target.value }))}
                placeholder="Question text…"
                className="mb-3 w-full rounded-lg border border-black/8 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-violet-300 focus:bg-white focus:outline-none focus:ring-1 focus:ring-violet-200"
              />

              {/* Linked fields */}
              <div className="mb-4 flex flex-wrap gap-1.5">
                {fields.map((f) => {
                  const linked = focusedQuestion.fieldIds.includes(f.id);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() =>
                        mutate((q) => ({
                          ...q,
                          fieldIds: linked
                            ? q.fieldIds.filter((id) => id !== f.id)
                            : [...q.fieldIds, f.id],
                        }))
                      }
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                        linked
                          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                          : "border-zinc-200 text-zinc-400 hover:border-zinc-300 hover:text-zinc-600"
                      }`}
                    >
                      {f.id}
                    </button>
                  );
                })}
                {fields.length === 0 && (
                  <span className="text-[11px] italic text-zinc-400">Add fields first</span>
                )}
              </div>

              {/* Branch tabs */}
              <p className="mb-1.5 text-[10px] text-zinc-400">Branches</p>
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
                          ? "border-violet-300 bg-violet-50 text-violet-800"
                          : "border-black/8 bg-zinc-50 text-zinc-500 hover:bg-zinc-100"
                      }`}
                    >
                      <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${cfg.iconCls}`}>
                        {cfg.icon}
                      </span>
                      <span className="font-mono text-[10px]">
                        {branch.condition.fieldId} {branch.condition.operator} {branch.condition.value}
                      </span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={addBranch}
                  disabled={fields.length === 0}
                  className="rounded-t-md border border-b-0 border-dashed border-zinc-300 px-3 py-1.5 text-[11px] text-zinc-400 hover:text-zinc-600 disabled:opacity-40"
                >
                  + add branch
                </button>
              </div>

              {/* Active branch body */}
              {activeBranch ? (
                <div className="rounded-b-lg rounded-tr-lg border border-violet-200 bg-violet-50/30 p-3">
                  {/* Condition editor */}
                  <div className="mb-3 border-b border-violet-100 pb-3">
                    <ConditionEditor
                      condition={activeBranch.condition}
                      fields={fields}
                      onChange={(c) => updateBranch(activeBranch.id, (b) => ({ ...b, condition: c }))}
                    />
                  </div>

                  {/* Outcome picker */}
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="w-14 shrink-0 text-[10px] text-zinc-400">Outcome</span>
                    <div className="flex flex-wrap gap-1.5">
                      {(Object.entries(OUTCOME_CFG) as [BranchOutcome, OutcomeCfg][]).map(([outcome, cfg]) => {
                        const isActive = activeBranch.outcome === outcome;
                        return (
                          <button
                            key={outcome}
                            type="button"
                            onClick={() =>
                              updateBranch(activeBranch.id, (b) => ({
                                ...b,
                                outcome,
                                subQuestions: outcome === "followups" ? b.subQuestions : [],
                              }))
                            }
                            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] transition-colors ${
                              isActive
                                ? cfg.activeCls
                                : "border-black/8 bg-white text-zinc-500 hover:bg-zinc-50"
                            }`}
                          >
                            <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${cfg.iconCls}`}>
                              {cfg.icon}
                            </span>
                            {cfg.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Sub-questions (followups) */}
                  {activeBranch.outcome === "followups" && (
                    <div className="space-y-1.5">
                      {activeBranch.subQuestions.map((sq) => {
                        const sqItem = treeItems.find((t) => t.question.id === sq.id);
                        return (
                          <div key={sq.id} className="flex items-center gap-2 rounded-md border border-black/8 bg-white px-3 py-2">
                            <span className="w-8 shrink-0 font-mono text-[10px] text-violet-600">
                              {sqItem?.label ?? "—"}
                            </span>
                            <span className="flex-1 truncate text-xs text-zinc-700">
                              {sq.text || <em className="text-zinc-400">untitled</em>}
                            </span>
                            <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">
                              {sq.fieldIds.length} field{sq.fieldIds.length !== 1 ? "s" : ""}
                            </span>
                            <button
                              type="button"
                              onClick={() => openSubQuestion(activeBranch.id, sq.id)}
                              className="shrink-0 text-[10px] text-blue-600 hover:text-blue-800"
                            >
                              open ↗
                            </button>
                          </div>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => addSubQuestion(activeBranch.id)}
                        className="text-[11px] text-blue-600 hover:text-blue-800"
                      >
                        + add follow-up question
                      </button>
                    </div>
                  )}

                  {/* Delete branch */}
                  <div className="mt-3 border-t border-violet-100 pt-2.5">
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
                <div className="rounded-b-lg rounded-tr-lg border border-dashed border-zinc-200 p-3">
                  <p className="text-[11px] italic text-zinc-400">
                    {focusedQuestion.branches.length === 0
                      ? "No branches — always continues to the next question."
                      : "Select a branch above to edit it."}
                  </p>
                </div>
              )}

              {focusedQuestion.branches.length > 0 && (
                <p className="mt-2 text-[11px] italic text-zinc-400">
                  Default: continue if no branch matches.
                </p>
              )}
            </div>

            {/* Extract hint */}
            <details className="group">
              <summary className="cursor-pointer text-[11px] text-zinc-400 transition-colors hover:text-zinc-600">
                Extraction hint (optional)
              </summary>
              <input
                type="text"
                value={focusedQuestion.extract_hint ?? ""}
                onChange={(e) => mutate((q) => ({ ...q, extract_hint: e.target.value || undefined }))}
                placeholder="e.g. If they say 'a couple', extract num_adults=2"
                className="mt-1.5 w-full rounded-lg border border-black/8 bg-zinc-50 px-3 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-violet-300 focus:outline-none"
              />
            </details>

          </div>
        )}
      </div>
    </div>
  );
}
