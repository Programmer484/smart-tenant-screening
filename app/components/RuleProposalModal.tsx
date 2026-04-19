"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import TextareaAutosize from "react-textarea-autosize";
import type { LandlordField } from "@/lib/landlord-field";
import {
  OPERATORS_BY_KIND,
  VALUELESS_OPERATORS,
  operatorLabel,
  defaultOperatorForKind,
  defaultValueForKind,
  type LandlordRule,
} from "@/lib/landlord-rule";
import { questionTextEditorRows, type Question, type QuestionTrigger } from "@/lib/question";
import { depthStyle } from "@/app/components/depth-styles";
import { FieldPickerPopover } from "@/app/components/FieldPickerPopover";

export type Proposal = {
  newRules: LandlordRule[];
  modifiedRules: LandlordRule[];
  deletedRuleIds: string[];
  newFields: LandlordField[];
  /** Proposed questions (new + modified). Each may carry parent + trigger. */
  proposedQuestions: Question[];
  deletedQuestionIds: string[];
};

const DEPTH_INDENT_PX = 20;

type ResolvedQuestion = {
  q: Question;
  origin: "new" | "modified" | "existing";
  /** Original text if this is a modification, for diff display */
  originalText?: string;
  /** Existing fieldIds for diffing newly-linked highlights */
  originalFieldIds?: string[];
  /** Whether this question's trigger was added/changed in this proposal */
  triggerIsNew?: boolean;
};

type Node = {
  resolved: ResolvedQuestion;
  pathLabel: string;
  parentResolvedIndex?: number;
  resolvedIndex: number;
  children: Node[];
};

/** Build the post-apply view of all questions (existing + new + modified)
 *  and derive the parent/child tree from `parentQuestionId`. */
function buildProposalTree(
  proposal: Proposal,
  existingQuestions: Question[],
  skippedQuestionIds: Set<string>,
): { roots: Node[]; resolved: ResolvedQuestion[] } {
  const deletedIds = new Set(proposal.deletedQuestionIds);
  const resolved: ResolvedQuestion[] = [];

  for (const eq of existingQuestions) {
    if (deletedIds.has(eq.id)) continue;
    const upd = proposal.proposedQuestions.find((p) => p.id === eq.id);
    if (upd && !skippedQuestionIds.has(upd.id)) {
      const triggerIsNew =
        JSON.stringify(eq.trigger ?? null) !== JSON.stringify(upd.trigger ?? null) ||
        eq.parentQuestionId !== upd.parentQuestionId;
      resolved.push({
        q: { ...eq, ...upd },
        origin: "modified",
        originalText: eq.text,
        originalFieldIds: eq.fieldIds,
        triggerIsNew,
      });
    } else {
      resolved.push({ q: eq, origin: "existing", originalFieldIds: eq.fieldIds });
    }
  }
  for (const pq of proposal.proposedQuestions) {
    if (existingQuestions.some((eq) => eq.id === pq.id)) continue;
    if (skippedQuestionIds.has(pq.id)) continue;
    resolved.push({ q: pq, origin: "new", triggerIsNew: !!pq.trigger });
  }

  const indexById = new Map<string, number>();
  resolved.forEach((r, i) => indexById.set(r.q.id, i));

  const nodes: Node[] = resolved.map((r, i) => ({ resolved: r, pathLabel: "", resolvedIndex: i, children: [] }));
  const roots: Node[] = [];
  for (let i = 0; i < resolved.length; i++) {
    const parentId = resolved[i].q.parentQuestionId;
    if (parentId) {
      const parentIdx = indexById.get(parentId);
      if (parentIdx !== undefined && parentIdx !== i) {
        nodes[i].parentResolvedIndex = parentIdx;
        nodes[parentIdx].children.push(nodes[i]);
        continue;
      }
    }
    roots.push(nodes[i]);
  }

  const label = (node: Node, path: string) => {
    node.pathLabel = path;
    node.children.forEach((c, i) => label(c, `${path}.${i + 1}`));
  };
  roots.forEach((r, i) => label(r, `Q${i + 1}`));

  return { roots, resolved };
}

function BranchValueInput({
  field,
  value,
  onChange,
}: {
  field: LandlordField | undefined;
  value: string;
  onChange: (v: string) => void;
}) {
  if (!field) return null;
  if (field.value_kind === "boolean") {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-foreground/15 bg-white px-1.5 py-0.5 text-xs text-foreground focus:border-teal-700/40 focus:outline-none">
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }
  if (field.value_kind === "enum") {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-foreground/15 bg-white px-1.5 py-0.5 text-xs text-foreground focus:border-teal-700/40 focus:outline-none">
        <option value="">Select…</option>
        {(field.options ?? []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    );
  }
  return (
    <input
      type={field.value_kind === "number" ? "number" : field.value_kind === "date" ? "date" : "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.value_kind === "number" ? "0" : "value"}
      className="w-24 rounded-md border border-foreground/15 bg-white px-1.5 py-0.5 text-xs text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:outline-none"
    />
  );
}

function ProposalNode({
  node,
  depth,
  resolved,
  allFields,
  isSkipped,
  onSkipToggle,
  onUpdateQuestion,
  onUpdateTrigger,
}: {
  node: Node;
  depth: number;
  resolved: ResolvedQuestion[];
  allFields: LandlordField[];
  isSkipped: (id: string) => boolean;
  onSkipToggle: (id: string) => void;
  onUpdateQuestion: (qid: string, patch: Partial<Question>) => void;
  onUpdateTrigger: (qid: string, patch: Partial<QuestionTrigger>) => void;
}) {
  const styles = depthStyle(depth);
  const r = node.resolved;
  const q = r.q;
  const trigger = q.trigger;
  const editable = r.origin !== "existing";

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null);
  const editFieldsBtnRef = useRef<HTMLButtonElement>(null);

  // Lock fields claimed by any other resolved question — same one-question-
  // per-field rule the editor enforces.
  const lockedFieldIds = useMemo(() => {
    const set = new Set<string>();
    for (const other of resolved) {
      if (other.q.id === q.id) continue;
      for (const fid of other.q.fieldIds) set.add(fid);
    }
    return set;
  }, [resolved, q.id]);

  const linkedFieldObjs = q.fieldIds
    .map((fid) => allFields.find((f) => f.id === fid))
    .filter((f): f is LandlordField => !!f);

  const parentResolved = node.parentResolvedIndex != null ? resolved[node.parentResolvedIndex] : null;
  const parentFields = parentResolved
    ? allFields.filter((f) => parentResolved.q.fieldIds.includes(f.id))
    : [];
  const triggerField = trigger ? allFields.find((f) => f.id === trigger.fieldId) : undefined;
  const operators = triggerField ? (OPERATORS_BY_KIND[triggerField.value_kind] ?? ["=="]) : ["=="];
  const valuelessOp = trigger ? VALUELESS_OPERATORS.has(trigger.operator) : false;

  const originBadge =
    r.origin === "new" ? (
      <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-teal-800">New</span>
    ) : r.origin === "modified" ? (
      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-800">Modified</span>
    ) : null;

  const skipped = isSkipped(q.id);
  const cardChrome = `flex items-stretch gap-1 rounded-lg border bg-white shadow-sm transition-opacity ${
    skipped ? "opacity-40 line-through decoration-foreground/30" : "opacity-100"
  } ${r.origin === "new" ? "border-teal-200" : r.origin === "modified" ? "border-amber-200" : "border-foreground/10"}`;

  return (
    <div>
      <div className={cardChrome}>
        <div className="flex-1 min-w-0 px-3 py-2.5">
          <div className="flex flex-1 flex-col gap-2 min-w-0">
            <div className="flex items-start gap-2">
              <span className={`shrink-0 pt-1.5 font-mono text-[10px] font-semibold ${styles.label}`} title={`Question ${node.pathLabel.slice(1)}`}>
                {node.pathLabel}
              </span>
              {originBadge ? <span className="shrink-0 pt-1">{originBadge}</span> : null}
              {editable ? (
                <TextareaAutosize
                  value={q.text}
                  disabled={skipped}
                  minRows={1}
                  onChange={(e) => onUpdateQuestion(q.id, { text: e.target.value })}
                  placeholder="Question text…"
                  className="min-w-0 flex-1 resize-none rounded-md border border-foreground/10 bg-white px-2.5 py-1.5 text-sm leading-snug text-foreground focus:border-teal-700/40 focus:outline-none disabled:bg-foreground/5 whitespace-pre-wrap"
                />
              ) : (
                <span className="min-w-0 flex-1 whitespace-pre-wrap text-sm text-foreground/70">{q.text}</span>
              )}
              {editable && (
                <button
                  type="button"
                  onClick={() => onSkipToggle(q.id)}
                  title={skipped ? "Restore this suggestion" : "Skip this suggestion"}
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                    skipped
                      ? "bg-teal-50 text-teal-700 hover:bg-teal-100"
                      : "text-foreground/40 hover:bg-black/5 hover:text-foreground/70"
                  }`}
                >
                  {skipped ? "Restore" : "Skip"}
                </button>
              )}
            </div>

            {r.originalText && r.originalText !== q.text && !skipped && (
              <div className="text-[11px] text-foreground/40 line-through pl-2">{r.originalText}</div>
            )}

            {trigger && (
              <div className={`flex flex-wrap items-center gap-1 rounded-md border bg-white/70 px-1.5 py-1 ${
                r.triggerIsNew && editable ? "border-foreground/15" : "border-foreground/10"
              }`}>
                <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-foreground/40">When</span>
                {r.triggerIsNew && editable && parentFields.length > 0 ? (
                  <>
                    <select
                      value={trigger.fieldId}
                      disabled={skipped}
                      onChange={(e) => {
                        const f = parentFields.find((x) => x.id === e.target.value);
                        if (!f) return;
                        onUpdateTrigger(q.id, {
                          fieldId: f.id,
                          operator: defaultOperatorForKind(f.value_kind),
                          value: defaultValueForKind(f.value_kind),
                        });
                      }}
                      className="rounded-md border border-foreground/15 bg-white px-1.5 py-0.5 text-xs text-foreground focus:border-teal-700/40 focus:outline-none"
                    >
                      {parentFields.map((f) => (
                        <option key={f.id} value={f.id}>{f.label || f.id}</option>
                      ))}
                    </select>
                    <select
                      value={trigger.operator}
                      disabled={skipped}
                      onChange={(e) => onUpdateTrigger(q.id, { operator: e.target.value })}
                      className="rounded-md border border-foreground/15 bg-white px-1.5 py-0.5 text-xs text-foreground focus:border-teal-700/40 focus:outline-none"
                    >
                      {operators.map((op) => (
                        <option key={op} value={op}>{operatorLabel(op, triggerField?.value_kind)}</option>
                      ))}
                    </select>
                    {!valuelessOp && (
                      <BranchValueInput
                        field={triggerField}
                        value={trigger.value}
                        onChange={(v) => onUpdateTrigger(q.id, { value: v })}
                      />
                    )}
                  </>
                ) : (
                  <>
                    <span className="rounded bg-foreground/5 px-1 py-0.5 text-[11px] font-medium text-foreground/70">
                      {triggerField?.label || trigger.fieldId}
                    </span>
                    <span className="rounded bg-foreground/5 px-1 py-0.5 text-[11px] text-foreground/55">
                      {operatorLabel(trigger.operator, triggerField?.value_kind)}
                    </span>
                    {!valuelessOp && (
                      <span className="rounded bg-foreground/5 px-1 py-0.5 text-[11px] font-medium text-foreground/70">
                        {trigger.value || "—"}
                      </span>
                    )}
                  </>
                )}
                {r.triggerIsNew && (
                  <span className="ml-auto rounded bg-teal-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-teal-800">+ new branch</span>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1">
              {linkedFieldObjs.map((f) => {
                const isNewlyLinked = r.origin === "modified" && r.originalFieldIds && !r.originalFieldIds.includes(f.id);
                return (
                  <span
                    key={f.id}
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                      isNewlyLinked
                        ? "border-amber-300 bg-amber-50 text-amber-800"
                        : "border-teal-700/20 bg-teal-50 text-teal-800"
                    }`}
                    title={f.id}
                  >
                    {isNewlyLinked ? "+ " : ""}{f.label || f.id}
                  </span>
                );
              })}
              {editable && !skipped && (
                <button
                  ref={editFieldsBtnRef}
                  type="button"
                  onClick={() => {
                    if (editFieldsBtnRef.current) {
                      setPickerAnchor(editFieldsBtnRef.current.getBoundingClientRect());
                      setPickerOpen(true);
                    }
                  }}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-foreground/20 px-2 py-0.5 text-[11px] text-foreground/55 hover:border-teal-700/40 hover:text-teal-700 transition-colors"
                >
                  <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                    <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  {linkedFieldObjs.length === 0 ? "Add fields" : "Edit"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {editable && (
        <FieldPickerPopover
          open={pickerOpen}
          anchorRect={pickerAnchor}
          fields={allFields}
          selectedIds={q.fieldIds}
          lockedFieldIds={lockedFieldIds}
          onChange={(next) => onUpdateQuestion(q.id, { fieldIds: next })}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {node.children.length > 0 && (
        <div
          className="relative mt-1.5 flex flex-col gap-1.5"
          style={{ paddingLeft: DEPTH_INDENT_PX }}
        >
          <div
            className={`absolute top-0 bottom-2 border-l-2 ${depthStyle(depth + 1).guide}`}
            style={{ left: 6 }}
            aria-hidden
          />
          {node.children.map((c) => (
            <ProposalNode
              key={c.resolved.q.id}
              node={c}
              depth={depth + 1}
              resolved={resolved}
              allFields={allFields}
              isSkipped={isSkipped}
              onSkipToggle={onSkipToggle}
              onUpdateQuestion={onUpdateQuestion}
              onUpdateTrigger={onUpdateTrigger}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function RuleProposalModal({
  open,
  proposal,
  existingRules,
  existingQuestions,
  existingFields,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  proposal: Proposal | null;
  existingRules: LandlordRule[];
  existingQuestions: Question[];
  existingFields?: LandlordField[];
  /** Receives the (possibly edited) proposal so the page applies the user's tweaks. */
  onConfirm: (edited: Proposal) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Editable working copy — re-initialized whenever a new proposal arrives.
  const [edited, setEdited] = useState<Proposal | null>(proposal);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [lastInitProposal, setLastInitProposal] = useState<Proposal | null>(proposal);
  if (open && proposal && lastInitProposal !== proposal) {
    setLastInitProposal(proposal);
    setEdited(structuredClone(proposal));
    setSkipped(new Set());
  }

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  if (!open || !proposal || !edited) return null;

  const dirty = JSON.stringify(edited) !== JSON.stringify(proposal) || skipped.size > 0;

  const fieldLabel = (id: string) => {
    const f = existingFields?.find((ef) => ef.id === id) ?? edited.newFields.find((nf) => nf.id === id);
    return f?.label || id;
  };

  const allFields: LandlordField[] = [...(existingFields ?? []), ...edited.newFields];

  function updateProposedQuestion(qid: string, patch: Partial<Question>) {
    setEdited((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        proposedQuestions: prev.proposedQuestions.map((q) => (q.id === qid ? { ...q, ...patch } : q)),
      };
    });
  }

  function updateTrigger(qid: string, patch: Partial<QuestionTrigger>) {
    setEdited((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        proposedQuestions: prev.proposedQuestions.map((q) => {
          if (q.id !== qid) return q;
          if (!q.trigger) return q;
          return { ...q, trigger: { ...q.trigger, ...patch } };
        }),
      };
    });
  }

  function toggleSkip(qid: string) {
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(qid)) next.delete(qid);
      else next.add(qid);
      return next;
    });
  }

  function reset() {
    setEdited(structuredClone(proposal));
    setSkipped(new Set());
  }

  function confirm() {
    if (!edited) return;
    if (skipped.size === 0) {
      onConfirm(edited);
      return;
    }
    const survivingQs = edited.proposedQuestions.filter((q) => !skipped.has(q.id));
    onConfirm({
      ...edited,
      proposedQuestions: survivingQs,
    });
  }

  const hasRuleChanges = edited.newRules.length > 0 || edited.modifiedRules.length > 0 || edited.deletedRuleIds.length > 0;
  const hasFieldChanges = edited.newFields.length > 0;
  const hasQuestionChanges = edited.proposedQuestions.length > 0 || edited.deletedQuestionIds.length > 0;
  const hasChanges = hasRuleChanges || hasFieldChanges || hasQuestionChanges;

  const deletedQuestions = edited.deletedQuestionIds
    .map((id) => existingQuestions.find((q) => q.id === id))
    .filter((q): q is Question => q != null);

  const tree = hasQuestionChanges
    ? buildProposalTree(edited, existingQuestions, skipped)
    : { roots: [], resolved: [] };

  const proposedNewIds = new Set(
    edited.proposedQuestions
      .filter((p) => !existingQuestions.some((eq) => eq.id === p.id))
      .map((p) => p.id),
  );
  const skippedNewCount = [...skipped].filter((id) => proposedNewIds.has(id)).length;

  return (
    <dialog
      ref={dialogRef}
      onClose={onCancel}
      className="fixed inset-0 z-50 m-auto max-w-3xl rounded-xl border border-black/8 bg-white p-0 shadow-xl backdrop:bg-black/40"
    >
      <div className="flex max-h-[88vh] flex-col">
        <div className="border-b border-black/5 p-6 pb-4">
          <h3 className="text-lg font-semibold text-[#1a2e2a]">Review Proposed Changes</h3>
          <p className="mt-1 text-sm text-[#1a2e2a]/60">
            Edit anything inline before applying. Use <strong className="text-[#1a2e2a]/80">Skip</strong> to drop individual suggestions.
          </p>
        </div>

        <div className="flex flex-col gap-6 overflow-y-auto p-6">
          {edited.deletedRuleIds.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-red-600">Rules to Delete</h4>
              <ul className="mt-2 flex flex-col gap-2">
                {edited.deletedRuleIds.map((id, i) => {
                  const r = existingRules.find((er) => er.id === id);
                  if (!r) return null;
                  return (
                    <li key={i} className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm opacity-70">
                      <span className="min-w-16 font-medium text-red-900/80 line-through">
                        {r.kind === "reject" ? "Reject if:" : "Require:"}
                      </span>
                      <div className="flex flex-col text-red-900/70 line-through">
                        {r.conditions.map((c, idx) => (
                          <div key={idx}>
                            {idx > 0 && <span className="mr-1 text-[11px] font-bold uppercase text-red-900/40">and</span>}
                            {fieldLabel(c.fieldId)} {c.operator} {c.value}
                          </div>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {edited.modifiedRules.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-600">Rules to Modify</h4>
              <ul className="mt-2 flex flex-col gap-3">
                {edited.modifiedRules.map((rule, i) => {
                  const original = existingRules.find((er) => er.id === rule.id);
                  return (
                    <li key={i} className="overflow-hidden rounded-xl border border-amber-200 bg-amber-50/50 shadow-sm">
                      {original && (
                        <div className="flex items-start gap-2 bg-black/5 p-3 text-sm opacity-60">
                          <span className="min-w-16 font-medium text-foreground/80 line-through">
                            {original.kind === "reject" ? "Reject if:" : "Require:"}
                          </span>
                          <div className="flex flex-col text-foreground/70 line-through">
                            {original.conditions.map((c, idx) => (
                              <div key={idx}>
                                {idx > 0 && <span className="mr-1 text-[11px] font-bold uppercase text-foreground/40">and</span>}
                                {fieldLabel(c.fieldId)} {c.operator} {c.value}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="flex items-start gap-2 bg-white p-3 text-sm">
                        <span className="min-w-16 font-medium text-amber-900">
                          {rule.kind === "reject" ? "Reject if:" : "Require:"}
                        </span>
                        <div className="flex flex-col text-amber-900/80">
                          {rule.conditions.map((c, idx) => (
                            <div key={idx} className="font-medium">
                              {idx > 0 && <span className="mr-1 text-[11px] font-bold uppercase text-amber-700/60">and</span>}
                              {fieldLabel(c.fieldId)} {c.operator} {c.value}
                            </div>
                          ))}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {edited.newRules.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-teal-700">New Rules</h4>
              <ul className="mt-2 flex flex-col gap-2">
                {edited.newRules.map((rule, i) => (
                  <li key={i} className="flex items-start gap-2 rounded-lg border border-teal-100 bg-teal-50/30 p-3 text-sm">
                    <span className="min-w-16 font-medium text-teal-900/80">
                      {rule.kind === "reject" ? "Reject if:" : "Require:"}
                    </span>
                    <div className="flex flex-col font-medium text-teal-900/80">
                      {rule.conditions.map((c, idx) => (
                        <div key={idx}>
                          {idx > 0 && <span className="mr-1 text-[11px] font-bold uppercase text-teal-700/60">and</span>}
                          {fieldLabel(c.fieldId)} {c.operator} {c.value}
                        </div>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {edited.newFields.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-purple-600">Fields to Add</h4>
              <div className="mt-2 flex flex-wrap gap-2">
                {edited.newFields.map((f, i) => (
                  <div key={i} className="flex items-center gap-1.5 rounded border border-purple-200 bg-purple-50 px-2 py-1 shadow-sm">
                    <span className="text-xs font-medium text-purple-900">{f.label || f.id}</span>
                    <span className="rounded bg-purple-100 px-1 text-[10px] uppercase tracking-widest text-purple-700/60">{f.value_kind}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {deletedQuestions.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-red-600">Questions to Remove</h4>
              <ul className="mt-2 flex flex-col gap-2">
                {deletedQuestions.map((q, i) => (
                  <li key={i} className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm opacity-70">
                    <div className="text-red-900/70 line-through">{q.text}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hasQuestionChanges && tree.roots.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground/55">
                Question Flow Updates
              </h4>
              <p className="mt-1 text-[11px] text-foreground/40">
                Existing questions are read-only context. Edit text, fields, and branching for new and modified items inline.
              </p>
              <div className="mt-3 flex flex-col gap-2">
                {tree.roots.map((root) => (
                  <ProposalNode
                    key={root.resolved.q.id}
                    node={root}
                    depth={0}
                    resolved={tree.resolved}
                    allFields={allFields}
                    isSkipped={(id) => skipped.has(id)}
                    onSkipToggle={toggleSkip}
                    onUpdateQuestion={updateProposedQuestion}
                    onUpdateTrigger={updateTrigger}
                  />
                ))}
              </div>
            </div>
          )}

          {!hasChanges && (
            <p className="text-sm italic text-foreground/50">No meaningful changes were proposed.</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-black/5 bg-[#f7f9f8]/50 p-6 pt-4">
          <div className="flex items-center gap-3">
            {dirty && (
              <button
                type="button"
                onClick={reset}
                className="text-xs text-foreground/55 hover:text-foreground/85 transition-colors"
              >
                Reset edits
              </button>
            )}
            {skippedNewCount > 0 && (
              <span className="text-xs text-foreground/55">
                {skippedNewCount} suggestion{skippedNewCount === 1 ? "" : "s"} skipped
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-black/10 px-4 py-2 text-sm text-[#1a2e2a]/60 transition-colors hover:bg-black/5"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={!hasChanges}
              className="rounded-lg bg-teal-700 px-5 py-2 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Accept &amp; Apply
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
