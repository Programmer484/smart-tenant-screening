"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { PropertyRecord, PropertyLinks, AiInstructions, PropertyVariable } from "@/lib/property";
import { DEFAULT_AI_INSTRUCTIONS, DEFAULT_LINKS, DEFAULT_MAX_FIELDS_PER_QUESTION, resolveAiInstructions } from "@/lib/property";
import type { LandlordField } from "@/lib/landlord-field";
import {
  normalizeRulesList,
  OPERATORS_BY_KIND,
  VALUELESS_OPERATORS,
  operatorLabel,
  defaultOperatorForKind,
  defaultValueForKind,
  countInvalidRuleConditions,
  getFirstInvalidRuleConditionId,
  type LandlordRule,
} from "@/lib/landlord-rule";
import {
  normalizeQuestionOrder,
  questionTextEditorRows,
  getInvalidQuestionSummary,
  validateQuestionTree,
  type Question,
  type QuestionTrigger,
} from "@/lib/question";
import RulesSection from "@/app/components/RulesSection";
import { PropertyEditorSkeleton } from "@/app/components/Skeleton";
import { ConfirmDialog } from "@/app/components/ConfirmDialog";
import { ShareLinkModal } from "@/app/components/ShareLinkModal";
import { RuleProposalModal, type Proposal } from "@/app/components/RuleProposalModal";
import LandlordFieldsSection from "@/app/components/LandlordFieldsSection";
import VariablesSection from "@/app/components/VariablesSection";
import { VariableShortcuts, insertAtCursor } from "@/app/components/VariableShortcuts";
import { FieldPickerPopover } from "@/app/components/FieldPickerPopover";
import { ReorderButtons } from "@/app/components/ReorderButtons";
import { depthStyle } from "@/app/components/depth-styles";
import TextareaAutosize from "react-textarea-autosize";
import { PropertyWalkthrough } from "@/app/components/PropertyWalkthrough";

const TABS = ["Fields", "Variables", "Questions", "Rules", "Links", "AI Behavior"] as const;
type Tab = (typeof TABS)[number];

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

function migrateRules(rawRules: unknown[]): LandlordRule[] {
  return normalizeRulesList(rawRules);
}

function ruleReferencesField(r: LandlordRule, fieldId: string): boolean {
  return r.conditions.some((c) => c.fieldId === fieldId);
}

function summarizeRule(r: LandlordRule): string {
  const conds = r.conditions.map((c) => `${c.fieldId} ${c.operator} ${c.value}`).join("; ");
  if (r.kind === "reject") return `Reject: ${conds}`;
  return `Require: ${conds}`;
}

// ─── Question Editor ────────────────────────────────────────────────

/**
 * Compact gear-button popover for "max fields per question". Lives next to
 * the question generator instead of floating in the footer, so its purpose
 * is obvious from context.
 */
function MaxFieldsPopover({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(String(value));

  useEffect(() => { setDraft(String(value)); }, [value]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function commit(raw: string) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) { onChange(1); setDraft("1"); }
    else if (n > 10) { onChange(10); setDraft("10"); }
    else { onChange(n); setDraft(String(n)); }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Question settings"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-foreground/10 bg-white text-foreground/55 hover:text-foreground/80 hover:border-foreground/20 transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z" stroke="currentColor" strokeWidth="1.3" />
          <path d="M13 8a5.07 5.07 0 00-.06-.78l1.4-1.05-1.5-2.6-1.65.5a5 5 0 00-1.36-.79L9.5 1.5h-3l-.33 1.78a5 5 0 00-1.36.79l-1.65-.5-1.5 2.6 1.4 1.05A5.07 5.07 0 003 8c0 .27.02.53.06.78l-1.4 1.05 1.5 2.6 1.65-.5a5 5 0 001.36.79L6.5 14.5h3l.33-1.78a5 5 0 001.36-.79l1.65.5 1.5-2.6-1.4-1.05c.04-.25.06-.51.06-.78z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-64 rounded-lg border border-black/10 bg-white p-3 shadow-lg">
          <label className="block text-xs font-medium text-foreground/70">Max fields per question</label>
          <p className="mt-1 text-[11px] text-foreground/45">
            Caps how many fields the AI will pack into one question. Lower = more, simpler questions.
          </p>
          <input
            type="number"
            min={1}
            max={10}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }}
            className="mt-2 w-20 rounded-md border border-foreground/10 bg-[#f7f9f8] px-2 py-1 text-center text-sm focus:border-teal-700/40 focus:bg-white focus:outline-none"
          />
        </div>
      )}
    </div>
  );
}

/** Value input for a branching condition (adapts to field type) */
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
        className="min-w-[7rem] rounded-lg border border-foreground/10 bg-background px-3 py-1.5 text-xs text-foreground focus:border-foreground/25 focus:outline-none focus:ring-1 focus:ring-foreground/15">
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }
  if (field.value_kind === "enum") {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="min-w-[7rem] rounded-lg border border-foreground/10 bg-background px-3 py-1.5 text-xs text-foreground focus:border-foreground/25 focus:outline-none focus:ring-1 focus:ring-foreground/15">
        <option value="">Select...</option>
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
      className="min-w-[7rem] max-w-[12rem] rounded-lg border border-foreground/10 bg-transparent px-3 py-1.5 text-xs text-foreground placeholder:text-foreground/35 focus:border-foreground/25 focus:outline-none focus:ring-1 focus:ring-foreground/15"
    />
  );
}

/** Match property description / question cards: grow height with content (scrollHeight).
 *  Pass `layoutKey` when the field can mount/unmount (e.g. hint panel) so height recalculates. */
function useTextareaAutosize(value: string, layoutKey?: unknown) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, layoutKey]);
  return ref;
}

// ─── Tree type for recursive question nesting ──────────────────────

type QuestionTreeNode = {
  index: number;
  children: QuestionTreeNode[];
};

/** Build a tree from the flat sorted questions list using `parentQuestionId`.
 *  Children inherit their parent's position by appearing immediately after
 *  their parent's subtree in the rendering order. Sibling order matches
 *  the flat array's order. */
function buildQuestionTree(questions: Question[]): QuestionTreeNode[] {
  const indexById = new Map<string, number>();
  questions.forEach((q, i) => indexById.set(q.id, i));

  const nodes: QuestionTreeNode[] = questions.map((_, i) => ({ index: i, children: [] }));
  const roots: QuestionTreeNode[] = [];

  for (let i = 0; i < questions.length; i++) {
    const parentId = questions[i].parentQuestionId;
    if (parentId) {
      const parentIdx = indexById.get(parentId);
      if (parentIdx !== undefined && parentIdx !== i) {
        nodes[parentIdx].children.push(nodes[i]);
        continue;
      }
    }
    roots.push(nodes[i]);
  }
  return roots;
}

function subtreeSize(node: QuestionTreeNode): number {
  return 1 + node.children.reduce((sum, c) => sum + subtreeSize(c), 0);
}

/** Collect all flat-array indices in a subtree (self + descendants). */
function collectSubtreeIndices(node: QuestionTreeNode): number[] {
  const out: number[] = [node.index];
  for (const c of node.children) out.push(...collectSubtreeIndices(c));
  return out;
}

/** Find a tree node by its flat-array index. Returns null if not found. */
function findNode(roots: QuestionTreeNode[], index: number): QuestionTreeNode | null {
  for (const r of roots) {
    if (r.index === index) return r;
    const inChild = findNode(r.children, index);
    if (inChild) return inChild;
  }
  return null;
}

function subtreeContainsInvalid(
  n: QuestionTreeNode,
  questions: Question[],
  invalidQuestionIds: Set<string>,
): boolean {
  if (invalidQuestionIds.has(questions[n.index]?.id ?? "")) return true;
  for (const c of n.children) {
    if (subtreeContainsInvalid(c, questions, invalidQuestionIds)) return true;
  }
  return false;
}

// ─── Depth uses indentation + a thin guide line, not hue. The single accent
//     color (teal) means "interactive primary" everywhere on this screen. ────
const DEPTH_INDENT_PX = 20;

// ─── Helpers used by the new card layout ────────────────────────────

/** All fieldIds claimed by questions OTHER than the one at `selfIndex`.
 *  The field picker uses this to lock duplicates so each field can only be
 *  collected by a single question. */
function collectFieldIdsUsedByOthers(
  questions: Question[],
  selfIndex: number,
): Set<string> {
  const out = new Set<string>();
  questions.forEach((q, i) => {
    if (i === selfIndex) return;
    for (const fid of q.fieldIds) out.add(fid);
  });
  return out;
}

// ─── Recursive question node ────────────────────────────────────────

function QuestionNode({
  node,
  questions,
  fields,
  variables,
  depth,
  pathLabel,
  maxFields,
  invalidQuestionIds,
  firstInvalidQuestionId,
  questionJumpNonce,
  updateQuestion,
  updateTrigger,
  requestDeleteQuestion,
  onMoveRootUp,
  onMoveRootDown,
  addFollowUp,
}: {
  node: QuestionTreeNode;
  questions: Question[];
  fields: LandlordField[];
  variables: PropertyVariable[];
  depth: number;
  /** Hierarchical label like "Q1", "Q1.2", "Q1.2.1" — purely informational. */
  pathLabel: string;
  maxFields?: number;
  invalidQuestionIds: Set<string>;
  firstInvalidQuestionId: string | null;
  /** Incremented when user taps "Jump to first error" so ancestors can expand. */
  questionJumpNonce: number;
  updateQuestion: (index: number, updated: Question) => void;
  updateTrigger: (index: number, patch: Partial<QuestionTrigger>) => void;
  /** Hands off to the page so we can show an inline confirm + undo toast. */
  requestDeleteQuestion: (index: number, descendantCount: number) => void;
  onMoveRootUp?: () => void;
  onMoveRootDown?: () => void;
  addFollowUp: (parentIndex: number, isRejection?: boolean) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const lastQuestionJumpHandledRef = useRef(0);
  useEffect(() => {
    if (questionJumpNonce === 0) return;
    if (questionJumpNonce === lastQuestionJumpHandledRef.current) return;
    lastQuestionJumpHandledRef.current = questionJumpNonce;
    if (!subtreeContainsInvalid(node, questions, invalidQuestionIds)) return;
    setCollapsed(false);
  }, [questionJumpNonce, node, questions, invalidQuestionIds]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null);
  const hintOpenState = useState(false);
  const [hintOpen, setHintOpen] = hintOpenState;
  const editFieldsBtnRef = useRef<HTMLButtonElement>(null);

  const q = questions[node.index];
  const trigger = q.trigger;
  const isChild = depth > 0 && !!trigger;
  const isInvalid = invalidQuestionIds.has(q.id);

  const parentQ = q.parentQuestionId
    ? questions.find((x) => x.id === q.parentQuestionId)
    : null;
  const parentFields = parentQ ? fields.filter((f) => parentQ.fieldIds.includes(f.id)) : [];
  const lockedFieldIds = collectFieldIdsUsedByOthers(questions, node.index);

  const triggerField = trigger ? fields.find((f) => f.id === trigger.fieldId) : undefined;
  const operators = triggerField ? (OPERATORS_BY_KIND[triggerField.value_kind] ?? ["=="]) : ["=="];
  const overLimit = maxFields != null && q.fieldIds.length > maxFields;
  const linkedFieldObjs = q.fieldIds
    .map((fid) => fields.find((f) => f.id === fid))
    .filter((f): f is LandlordField => !!f);
  const missingFieldIds = q.fieldIds.filter(fid => !fields.some(f => f.id === fid));
  const isUntitled = !q.text.trim();

  const valuelessOp = trigger ? VALUELESS_OPERATORS.has(trigger.operator) : false;
  const conditionIncomplete = !!trigger && !valuelessOp && !trigger.value.trim();

  const subtreeChildCount = (function count(n: QuestionTreeNode): number {
    return n.children.reduce((s, c) => s + 1 + count(c), 0);
  })(node);

  function handleTriggerFieldChange(fieldId: string) {
    if (!trigger) return;
    const f = parentFields.find((x) => x.id === fieldId);
    if (!f) return;
    updateTrigger(node.index, {
      fieldId,
      operator: defaultOperatorForKind(f.value_kind),
      value: defaultValueForKind(f.value_kind),
    });
  }

  function openPicker() {
    if (editFieldsBtnRef.current) {
      setPickerAnchor(editFieldsBtnRef.current.getBoundingClientRect());
      setPickerOpen(true);
    }
  }

  const styles = depthStyle(depth);
  const pathLabelEl = (
    <span
      className={`shrink-0 font-mono text-[10px] font-semibold ${styles.label}`}
      title={`Question ${pathLabel.slice(1)}`}
    >
      {pathLabel}
    </span>
  );

  const conditionPill = isChild && trigger ? (
    <div
      className={`flex flex-wrap items-center gap-1 rounded-md border bg-white/70 px-1.5 py-1 ${conditionIncomplete ? "border-l-2 border-l-amber-400 border-y-foreground/10 border-r-foreground/10" : "border-foreground/10"
        }`}
      title={conditionIncomplete ? "Branch incomplete — set a value" : undefined}
    >
      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-foreground/40">When</span>
      <select
        value={trigger.fieldId}
        onChange={(e) => handleTriggerFieldChange(e.target.value)}
        className="rounded-md border border-foreground/15 bg-white px-1.5 py-0.5 text-xs text-foreground focus:border-teal-700/40 focus:outline-none"
      >
        {parentFields.map((f) => (
          <option key={f.id} value={f.id}>{f.label || f.id}</option>
        ))}
      </select>
      <select
        value={trigger.operator}
        onChange={(e) => updateTrigger(node.index, { operator: e.target.value })}
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
          onChange={(v) => updateTrigger(node.index, { value: v })}
        />
      )}
      {conditionIncomplete && (
        <span className="text-[10px] italic text-amber-600">any value</span>
      )}
    </div>
  ) : null;

  const collapseToggle = node.children.length > 0 ? (
    <button
      type="button"
      onClick={() => setCollapsed((c) => !c)}
      aria-expanded={!collapsed}
      title={collapsed ? `Show ${node.children.length} follow-up${node.children.length === 1 ? "" : "s"}` : "Hide follow-ups"}
      className="shrink-0 flex items-center justify-center rounded p-0.5 text-foreground/40 hover:bg-black/5 hover:text-foreground/70 transition-colors"
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
        className={`transition-transform ${collapsed ? "" : "rotate-90"}`}
      >
        <path d="M3 1.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  ) : null;

  const hasDragHandle = !!(onMoveRootUp || onMoveRootDown);
  const dragHandle = hasDragHandle ? <ReorderButtons onMoveUp={onMoveRootUp} onMoveDown={onMoveRootDown} /> : null;

  const metaChips = (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
      {q.fieldIds.length > 0 && (
        <span className="rounded-full bg-foreground/5 px-1.5 py-0.5 text-[10px] font-medium text-foreground/55">
          {q.fieldIds.length} field{q.fieldIds.length === 1 ? "" : "s"}
        </span>
      )}
      {node.children.length > 0 && (
        <span className="rounded-full bg-foreground/5 px-1.5 py-0.5 text-[10px] font-medium text-foreground/55">
          {node.children.length} follow-up{node.children.length === 1 ? "" : "s"}
        </span>
      )}
    </div>
  );

  const hintEditing = hintOpen || !!q.extract_hint;
  const extractHintRef = useTextareaAutosize(q.extract_hint || "", hintEditing);
  const textRef = useRef<HTMLTextAreaElement>(null);
  
  const cardBody = (
    <div className="flex flex-1 flex-col gap-2 min-w-0">
      <div className="flex items-start gap-2">
        <div className="flex shrink-0 items-start gap-2 pt-1.5">
          {pathLabelEl}
          {collapseToggle}
        </div>
        <div className="flex-1 flex flex-col min-w-0">
          <TextareaAutosize
            ref={textRef}
            value={q.text}
            onChange={(e) => updateQuestion(node.index, { ...q, text: e.target.value })}
            minRows={1}
            placeholder={q.is_rejection ? "Rejection message (e.g. Unfortunately, we do not allow pets...)" : isChild ? "Untitled follow-up — click to add question text" : "Question text (e.g. How many people will live here?)"}
            className={`min-w-0 flex-1 resize-none rounded-md border px-2.5 py-1.5 text-sm leading-snug text-foreground placeholder:text-foreground/30 focus:outline-none whitespace-pre-wrap ${
              q.is_rejection ? "bg-red-50/50 focus:border-red-400" : "bg-white focus:border-teal-700/40"
            } ${isUntitled ? "border-dashed border-foreground/20" : "border-foreground/10"}`}
          />
          <VariableShortcuts 
            variables={variables} 
            onInsert={(varId) => insertAtCursor(q.text, varId, textRef, (newText) => updateQuestion(node.index, { ...q, text: newText }))}
          />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
          {metaChips}
          <button
            type="button"
            onClick={() => requestDeleteQuestion(node.index, subtreeChildCount)}
            aria-label={`Delete ${pathLabel}${subtreeChildCount > 0 ? ` and ${subtreeChildCount} follow-up${subtreeChildCount === 1 ? "" : "s"}` : ""}`}
            title="Delete question"
            className="rounded p-1 text-foreground/25 hover:bg-red-50 hover:text-red-500 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M2 4h12M5 4V2.5A1.5 1.5 0 0 1 6.5 1h3A1.5 1.5 0 0 1 11 2.5V4m2 0-.75 9A1.5 1.5 0 0 1 10.75 14.5h-5.5A1.5 1.5 0 0 1 3.75 13L3 4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      {conditionPill}

      {!q.is_rejection && (
        <div className="flex flex-wrap items-center gap-1">
          {linkedFieldObjs.map((f) => (
            <span
              key={f.id}
              className="inline-flex items-center gap-1 rounded-full border border-teal-700/20 bg-teal-50 px-2 py-0.5 text-[11px] text-teal-800"
              title={f.id}
            >
              {f.label || f.id}
            </span>
          ))}
          {missingFieldIds.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 pl-2 pr-1 py-0.5 text-[11px] text-red-800"
              title={`Field "${id}" not found in schema`}
            >
              Missing: {id}
              <button
                type="button"
                onClick={() => updateQuestion(node.index, { ...q, fieldIds: q.fieldIds.filter(x => x !== id) })}
                className="ml-0.5 flex items-center justify-center rounded-full p-0.5 hover:bg-red-800/10 hover:text-red-900 transition-colors"
                aria-label="Remove missing field"
              >
                <svg width="8" height="8" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              </button>
            </span>
          ))}
          <button
            ref={editFieldsBtnRef}
            type="button"
            onClick={openPicker}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-foreground/20 px-2 py-0.5 text-[11px] text-foreground/55 hover:border-teal-700/40 hover:text-teal-700 transition-colors"
          >
            <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
              <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            {linkedFieldObjs.length === 0 && missingFieldIds.length === 0 ? "Add fields" : "Edit"}
          </button>
          {overLimit && (
            <span className="ml-1 text-[11px] text-amber-600">
              over {maxFields} field limit
            </span>
          )}
        </div>
      )}

      {!q.is_rejection && hintEditing && (
        <textarea
          ref={extractHintRef}
          autoFocus={hintOpen && !q.extract_hint}
          value={q.extract_hint || ""}
          onChange={(e) => updateQuestion(node.index, { ...q, extract_hint: e.target.value || undefined })}
          onBlur={() => setHintOpen(false)}
          rows={1}
          placeholder="e.g. 'a couple' → num_adults=2"
          className="w-full resize-none overflow-hidden rounded-md border border-foreground/10 bg-white px-2 py-1 text-[11px] italic leading-snug text-foreground/70 placeholder:not-italic placeholder:text-foreground/30 focus:border-teal-700/40 focus:outline-none whitespace-pre-wrap"
        />
      )}

      {(!q.is_rejection && (!hintEditing || q.fieldIds.length > 0)) && (
        <div className="flex items-center gap-3 text-[11px]">
          {!hintEditing && (
            <button
              type="button"
              onClick={() => setHintOpen(true)}
              className="text-foreground/40 hover:text-foreground/65 transition-colors"
            >
              + Add hint
            </button>
          )}
          {q.fieldIds.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => addFollowUp(node.index, false)}
                className="tour-add-followup flex items-center gap-1 text-teal-700/70 hover:text-teal-700 transition-colors"
              >
                <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                  <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Add follow-up
              </button>
              <button
                type="button"
                onClick={() => addFollowUp(node.index, true)}
                className="flex items-center gap-1 text-red-700/70 hover:text-red-700 transition-colors"
              >
                <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                  <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Add rejection branch
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );

  const childrenSection = node.children.length > 0 ? (
    collapsed ? (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="ml-5 mt-1 self-start text-[11px] italic text-foreground/40 hover:text-foreground/70 transition-colors"
      >
        {node.children.length} follow-up{node.children.length === 1 ? "" : "s"} hidden — click to show
      </button>
    ) : (
      <div
        className="relative mt-1.5 flex flex-col gap-1.5"
        style={{ paddingLeft: DEPTH_INDENT_PX }}
      >
        <div
          className={`absolute top-0 bottom-2 border-l-2 ${depthStyle(depth + 1).guide}`}
          style={{ left: 6 }}
          aria-hidden
        />
        {node.children.map((child, ci) => (
          <QuestionNode
            key={questions[child.index].id}
            node={child}
            questions={questions}
            fields={fields}
            variables={variables}
            depth={depth + 1}
            pathLabel={`${pathLabel}.${ci + 1}`}
            maxFields={maxFields}
            invalidQuestionIds={invalidQuestionIds}
            firstInvalidQuestionId={firstInvalidQuestionId}
            questionJumpNonce={questionJumpNonce}
            updateQuestion={updateQuestion}
            updateTrigger={updateTrigger}
            requestDeleteQuestion={requestDeleteQuestion}
            addFollowUp={addFollowUp}
          />
        ))}
      </div>
    )
  ) : null;

  const cardChrome = `group flex items-stretch gap-1 rounded-lg border shadow-sm transition-colors ${isInvalid
    ? "bg-white border-red-300 ring-1 ring-red-100/90"
    : isUntitled
      ? "bg-white border-dashed border-foreground/15"
      : overLimit
        ? "bg-white border-amber-300"
        : q.is_rejection
          ? "bg-red-50/50 border-red-200"
          : "bg-white border-foreground/10"
    }`;

  return (
    <div
      id={firstInvalidQuestionId === q.id ? `${q.id}-question-error` : undefined}
    >
      <div className={cardChrome}>
        {dragHandle}
        <div className={`flex-1 min-w-0 py-3 pr-3 ${hasDragHandle ? "" : "pl-4"}`}>
          {cardBody}
        </div>
      </div>

      <FieldPickerPopover
        open={pickerOpen}
        anchorRect={pickerAnchor}
        fields={fields}
        selectedIds={q.fieldIds}
        lockedFieldIds={lockedFieldIds}
        onChange={(next) => updateQuestion(node.index, { ...q, fieldIds: next })}
        onClose={() => setPickerOpen(false)}
      />

      {childrenSection}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────

export default function PropertySetupPage() {
  const { id } = useParams<{ id: string }>();
  const supabase = createClient();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [variables, setVariables] = useState<PropertyVariable[]>([]);
  const [fields, setFields] = useState<LandlordField[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [rules, setRules] = useState<LandlordRule[]>([]);
  const [links, setLinks] = useState<PropertyLinks>(DEFAULT_LINKS);
  const [aiInstructions, setAiInstructions] = useState<AiInstructions>(DEFAULT_AI_INSTRUCTIONS);
  const [maxFieldsPerQuestion, setMaxFieldsPerQuestion] = useState(DEFAULT_MAX_FIELDS_PER_QUESTION);

  const [activeTab, setActiveTab] = useState<Tab>("Questions");
  const [loadingPhase, setLoadingPhase] = useState<null | "questions" | "rules">(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);

  const [saving, setSaving] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [lastSavedRef] = useState(() => ({ current: "" }));
  const [showSaved, setShowSaved] = useState(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef<(_?: Partial<PropertyRecord>) => Promise<boolean>>(async () => false);
  const serializedStateRef = useRef("");
  const hasLoadedRef = useRef(false);
  const [questionsPrompt, setQuestionsPrompt] = useState("");
  const [rulesPrompt, setRulesPrompt] = useState("");
  const [ruleProposal, setRuleProposal] = useState<Proposal | null>(null);
  const [fieldDeleteIndex, setFieldDeleteIndex] = useState<number | null>(null);
  const [questionJumpNonce, setQuestionJumpNonce] = useState(0);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [runWalkthrough, setRunWalkthrough] = useState(false);

  const descRef = useRef<HTMLTextAreaElement>(null);

  const questionInvalid = useMemo(
    () => getInvalidQuestionSummary(questions, fields),
    [questions, fields],
  );

  const questionsPromptRef = useTextareaAutosize(questionsPrompt);
  const rulesPromptRef = useTextareaAutosize(rulesPrompt);

  useEffect(() => {
    const el = descRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [description]);

  // ── Load property ──
  useEffect(() => {
    async function load() {
      const propRes = await supabase
        .from("properties")
        .select("*")
        .eq("id", id)
        .single();

      if (propRes.error || !propRes.data) {
        setError("Property not found.");
        setPageLoading(false);
        return;
      }

      const p = propRes.data as PropertyRecord;
      setTitle(p.title);
      setDescription(p.description);
      setVariables((p.variables as PropertyVariable[]) ?? []);
      setFields((p.fields as LandlordField[]) ?? []);
      setQuestions((p.questions as Question[]) ?? []);
      const migratedRules = migrateRules((p.rules as unknown[]) ?? []);
      setRules(migratedRules);
      setLinks({ ...DEFAULT_LINKS, ...(p.links as Partial<PropertyLinks>) });
      setAiInstructions(resolveAiInstructions(p.ai_instructions));
      setMaxFieldsPerQuestion(typeof p.max_fields_per_question === "number" ? p.max_fields_per_question : DEFAULT_MAX_FIELDS_PER_QUESTION);
      setPublishedAt(p.published_at ?? null);

      lastSavedRef.current = JSON.stringify({
        title: p.title, description: p.description,
        variables: (p.variables as PropertyVariable[]) ?? [],
        fields: (p.fields as LandlordField[]) ?? [],
        questions: (p.questions as Question[]) ?? [],
        rules: migratedRules, links: { ...DEFAULT_LINKS, ...(p.links as Partial<PropertyLinks>) },
        aiInstructions: resolveAiInstructions(p.ai_instructions),
        maxFieldsPerQuestion: typeof p.max_fields_per_question === "number" ? p.max_fields_per_question : DEFAULT_MAX_FIELDS_PER_QUESTION,
        publishedAt: p.published_at ?? null,
      });
      hasLoadedRef.current = true;
      setPageLoading(false);
    }
    void load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dirty tracking ──
  useEffect(() => {
    if (pageLoading) return;
    const current = JSON.stringify({ title, description, variables, fields, questions, rules, links, aiInstructions, maxFieldsPerQuestion, publishedAt });
    setDirty(current !== lastSavedRef.current);
  }, [title, description, variables, fields, questions, rules, links, aiInstructions, maxFieldsPerQuestion, publishedAt, pageLoading, lastSavedRef]);

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirty) { e.preventDefault(); }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // ── Save ──
  const save = useCallback(
    async (overrides?: Partial<PropertyRecord>): Promise<boolean> => {
      // Drop fully-empty draft fields (both id and label blank) — they can't be
      // referenced by anything and would confuse downstream validators.
      const cleanFields = fields.filter(
        (f) => f.id.trim() !== "" || f.label.trim() !== "",
      );
      // Normalize question order so persisted `sort_order` always matches the
      // visual tree (findNextQuestion / imports / manual edits stay in sync).
      const cleanQuestions = normalizeQuestionOrder(questions);

      const treeError = validateQuestionTree(cleanQuestions, cleanFields);
      void treeError;

      const qSummary = getInvalidQuestionSummary(cleanQuestions, cleanFields);
      const invRules = countInvalidRuleConditions(rules, cleanFields);
      const ready = qSummary.count === 0 && invRules === 0;

      const pubFromOverride = overrides?.published_at;
      const restOverrides = { ...overrides };
      delete restOverrides.published_at;

      let nextPublishedAt: string | null;
      if (!ready) {
        nextPublishedAt = null;
      } else if (pubFromOverride !== undefined) {
        nextPublishedAt = pubFromOverride;
      } else {
        nextPublishedAt = publishedAt;
      }

      setSaving(true);
      const { error } = await supabase
        .from("properties")
        .update({
          title: title.trim() || "New Property",
          description: description.trim(),
          variables,
          fields: cleanFields,
          questions: cleanQuestions,
          rules,
          links,
          ai_instructions: aiInstructions,
          max_fields_per_question: maxFieldsPerQuestion,
          published_at: nextPublishedAt,
          updated_at: new Date().toISOString(),
          ...restOverrides,
        })
        .eq("id", id);
      setSaving(false);
      if (error) { console.error("[save]", error); toast.error("Failed to save"); return false; }
      setPublishedAt(nextPublishedAt);
      lastSavedRef.current = JSON.stringify({
        title,
        description,
        variables,
        fields: cleanFields,
        questions: cleanQuestions,
        rules,
        links,
        aiInstructions,
        maxFieldsPerQuestion,
        publishedAt: nextPublishedAt,
      });
      setDirty(false);
      if (savedIndicatorTimerRef.current) clearTimeout(savedIndicatorTimerRef.current);
      setShowSaved(true);
      savedIndicatorTimerRef.current = setTimeout(() => {
        setShowSaved(false);
        savedIndicatorTimerRef.current = null;
      }, 2000);
      return true;
    },
    [id, title, description, variables, fields, questions, rules, links, aiInstructions, maxFieldsPerQuestion, publishedAt, supabase], // eslint-disable-line react-hooks/exhaustive-deps
  );

  saveRef.current = save;

  function cancelAutosaveTimer() {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }

  const flushSave = useCallback(async () => {
    cancelAutosaveTimer();
    if (!hasLoadedRef.current) return;
    if (serializedStateRef.current === lastSavedRef.current) return;
    await save();
    // Only `save` is a reactive value; the rest are refs (stable).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save]);

  serializedStateRef.current = JSON.stringify({
    title, description, fields, questions, rules, links, aiInstructions, maxFieldsPerQuestion, publishedAt,
  });

  // Debounced autosave (2s after last edit while dirty)
  useEffect(() => {
    if (!hasLoadedRef.current) return;
    if (pageLoading || loadingPhase !== null) return;
    if (!dirty) return;
    if (saving) return;
    cancelAutosaveTimer();
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      void save();
    }, 2000);
    return () => {
      cancelAutosaveTimer();
    };
  }, [
    title,
    description,
    fields,
    questions,
    rules,
    links,
    aiInstructions,
    maxFieldsPerQuestion,
    publishedAt,
    pageLoading,
    loadingPhase,
    dirty,
    saving,
    save,
  ]);

  // Flush pending changes on unmount (e.g. client navigation away)
  useEffect(() => {
    return () => {
      if (savedIndicatorTimerRef.current) {
        clearTimeout(savedIndicatorTimerRef.current);
        savedIndicatorTimerRef.current = null;
      }
      if (!hasLoadedRef.current) return;
      if (serializedStateRef.current === lastSavedRef.current) return;
      try {
        const state = JSON.parse(serializedStateRef.current) as {
          fields: LandlordField[];
          questions: Question[];
          title?: string;
          description?: string;
          rules: unknown;
          links: unknown;
          aiInstructions: unknown;
          maxFieldsPerQuestion: number;
          publishedAt?: string | null;
        };
        const cleanFields = (state.fields as LandlordField[]).filter(
          (f) => f.id.trim() !== "" || f.label.trim() !== "",
        );
        const cleanQuestions = normalizeQuestionOrder(state.questions as Question[]);
        const qSum = getInvalidQuestionSummary(cleanQuestions, cleanFields);
        const invR = countInvalidRuleConditions(state.rules as LandlordRule[], cleanFields);
        const readyUnmount = qSum.count === 0 && invR === 0;
        const nextPub = readyUnmount ? (state.publishedAt ?? null) : null;
        void supabase
          .from("properties")
          .update({
            title: (state.title ?? "").trim() || "New Property",
            description: (state.description ?? "").trim(),
            fields: cleanFields,
            questions: cleanQuestions,
            rules: state.rules,
            links: state.links,
            ai_instructions: state.aiInstructions,
            max_fields_per_question: state.maxFieldsPerQuestion,
            published_at: nextPub,
            updated_at: new Date().toISOString(),
          })
          .eq("id", id)
          .then(({ error }) => { if (error) console.error("[unmount-save]", error); });
      } catch { /* serialization error — skip */ }
    };
  }, [id, supabase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Generate questions with prompt ──
  async function handleGenerateQuestions(prompt: string) {
    if (!prompt.trim()) {
      toast.error("Enter a prompt describing what questions to generate");
      return;
    }
    try {
      setLoadingPhase("questions");
      const res = await fetch("/api/generate-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: prompt,
          existingFields: fields.map((f) => ({ id: f.id, label: f.label, value_kind: f.value_kind })),
          existingQuestions: questions.map((q) => ({
            id: q.id,
            text: q.text,
            fieldIds: q.fieldIds,
            parentQuestionId: q.parentQuestionId,
            trigger: q.trigger,
          })),
          maxFieldsPerQuestion,
        }),
      });
      const data = await res.json();

      if (data.ok === false) {
        if (data.raw) {
          console.group("[generate-fields] AI returned bad output");
          console.log("Error:", data.error);
          console.log("Raw AI response:\n", data.raw);
          console.groupEnd();
        }
        if (data.violations?.length) {
          const names = data.violations.map((v: { text: string }) => `"${v.text}"`).join(", ");
          toast.error(`${data.error}: ${names}`);
        } else {
          toast.error(data.error ?? "Generation failed");
        }
        return;
      }

      const proposedFields: LandlordField[] = data.newFields ?? [];
      const proposedQuestions: Question[] = data.questions ?? [];
      const deletedQuestionIds: string[] = data.deletedQuestionIds ?? [];

      if (proposedFields.length === 0 && proposedQuestions.length === 0 && deletedQuestionIds.length === 0) {
        toast.info("No new items to add — AI found everything is covered.");
        return;
      }

      setRuleProposal({
        newRules: [],
        modifiedRules: [],
        deletedRuleIds: [],
        newFields: proposedFields,
        proposedQuestions,
        deletedQuestionIds,
      });
    } catch (err) {
      console.error("[generateQuestions]", err);
      toast.error("Generation failed — please try again");
    } finally {
      setLoadingPhase(null);
    }
  }

  // ── Generate rules with prompt ──
  async function handleGenerateRules(prompt: string) {
    if (!prompt.trim()) {
      toast.error("Enter a prompt describing what rules to generate");
      return;
    }
    if (fields.length === 0) {
      toast.error("Add fields first so rules can reference them");
      return;
    }
    try {
      setLoadingPhase("rules");
      const res = await fetch("/api/generate-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: prompt,
          fields,
          existingRules: rules,
        }),
      });
      const data = (await res.json()) as {
        newRules?: LandlordRule[];
        modifiedRules?: LandlordRule[];
        deletedRuleIds?: string[];
        newFields?: LandlordField[];
      };

      const newRules = migrateRules(data.newRules ?? []);
      const modifiedRules = migrateRules(data.modifiedRules ?? []);
      const deletedRuleIds = data.deletedRuleIds ?? [];
      const newFields = data.newFields ?? [];

      if (newFields.length > 0) {
        toast.info("Analyzing missing fields...");
        const newFieldsDesc = newFields.map(f => `${f.label || f.id} (type: ${f.value_kind})`).join(", ");
        const res2 = await fetch("/api/generate-fields", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: `We are building new screening rules that require these NEW fields (not in the schema yet): ${newFieldsDesc}. We need interview questions to collect them.\n\nIMPORTANT: Look at EXISTING QUESTIONS in the system context. If any existing question is on the same topic as these fields (e.g. house rules, smoking, pets, drugs, income — or one combined "policies" style question), UPDATE that question: keep its id, add the new field id(s) to fieldIds, and rewrite the question text so it naturally asks for everything in one place. Only add a brand-new question if no existing question is a good fit. Prefer merging related checks into one question when it stays readable.`,
            existingFields: [...fields, ...newFields].map((f) => ({ id: f.id, label: f.label, value_kind: f.value_kind })),
            existingQuestions: questions.map((q) => ({
              id: q.id,
              text: q.text,
              fieldIds: q.fieldIds,
              parentQuestionId: q.parentQuestionId,
              trigger: q.trigger,
            })),
            maxFieldsPerQuestion,
            strictFieldsMode: true,
          })
        });
        const data2 = await res2.json();

        if (data2.ok === false) {
          if (data2.raw) {
            console.group("[generate-fields] AI returned bad output (from rule flow)");
            console.log("Error:", data2.error);
            console.log("Raw AI response:\n", data2.raw);
            console.groupEnd();
          }
          toast.error(data2.error ?? "Failed to generate questions for new fields");
        }

        const mergedNewFields = [...newFields];
        if (data2.ok !== false && Array.isArray(data2.newFields)) {
          for (const f of data2.newFields) {
            if (!mergedNewFields.some(x => x.id === f.id)) {
              mergedNewFields.push(f);
            }
          }
        }

        setRuleProposal({
          newRules,
          modifiedRules,
          deletedRuleIds,
          newFields: mergedNewFields,
          proposedQuestions: data2.ok !== false ? (data2.questions || []) : [],
          deletedQuestionIds: data2.ok !== false ? (data2.deletedQuestionIds || []) : [],
        });
        return;
      }

      setRuleProposal({
        newRules,
        modifiedRules,
        deletedRuleIds,
        newFields: [],
        proposedQuestions: [],
        deletedQuestionIds: [],
      });

    } catch (err) {
      console.error("[generateRules]", err);
      toast.error("Rule generation failed — please try again");
    } finally {
      setLoadingPhase(null);
    }
  }

  /** Applies the (possibly user-edited) proposal returned by the modal. */
  function applyProposal(edited: Proposal) {
    if (edited.newFields.length > 0) {
      setFields((prev) => [...prev, ...edited.newFields.map(f => ({ ...f, _isNew: true, _clientId: generateId() }) as unknown as LandlordField)]);
    }

    if (edited.proposedQuestions.length > 0 || edited.deletedQuestionIds.length > 0) {
      setQuestions((prev) => {
        let next = [...prev];

        if (edited.deletedQuestionIds.length > 0) {
          const deleteSet = new Set(edited.deletedQuestionIds);
          next = next.filter((q) => !deleteSet.has(q.id));
        }

        const newQs: Question[] = [];
        for (const pq of edited.proposedQuestions) {
          const idx = next.findIndex((q) => q.id === pq.id);
          if (idx >= 0) {
            next[idx] = {
              ...next[idx],
              text: pq.text,
              fieldIds: pq.fieldIds,
              extract_hint: pq.extract_hint,
              parentQuestionId: pq.parentQuestionId,
              trigger: pq.trigger,
            };
          } else {
            newQs.push(pq);
          }
        }

        if (newQs.length > 0) {
          next = [...next, ...newQs];
        }

        return normalizeQuestionOrder(next);
      });
    }

    setRules((prev) => {
      let next = [...prev];
      if (edited.deletedRuleIds.length > 0) {
        next = next.filter((r) => !edited.deletedRuleIds.includes(r.id));
      }
      for (const mod of edited.modifiedRules) {
        const idx = next.findIndex((r) => r.id === mod.id);
        if (idx >= 0) next[idx] = mod;
      }
      if (edited.newRules.length > 0) {
        next = [...next, ...edited.newRules];
      }
      return next;
    });

    const parts: string[] = [];
    const rc = edited.newRules.length + edited.modifiedRules.length + edited.deletedRuleIds.length;
    const fc = edited.newFields.length;
    const qc = edited.proposedQuestions.length + edited.deletedQuestionIds.length;
    if (rc > 0) parts.push(`${rc} rule(s)`);
    if (fc > 0) parts.push(`${fc} field(s)`);
    if (qc > 0) parts.push(`${qc} question(s)`);
    toast.success(`Applied ${parts.join(" + ") || "changes"}`);
    setRuleProposal(null);
  }

  // ── Field helpers ──
  function requestDeleteField(index: number) {
    const field = fields[index];
    if (!field.id) {
      setFields((prev) => prev.filter((_, i) => i !== index));
      return;
    }
    const qs = questions.filter((q) => q.fieldIds.includes(field.id));
    const rs = rules.filter((r) => ruleReferencesField(r, field.id));
    if (qs.length === 0 && rs.length === 0) {
      setFields((prev) => prev.filter((_, i) => i !== index));
      return;
    }
    setFieldDeleteIndex(index);
  }

  function confirmDeleteField() {
    if (fieldDeleteIndex === null) return;
    const index = fieldDeleteIndex;
    const field = fields[index];
    setFieldDeleteIndex(null);
    if (!field?.id) {
      setFields((prev) => prev.filter((_, i) => i !== index));
      return;
    }
    const fid = field.id;
    setQuestions((prev) => {
      const next = prev
        .map((q) => ({
          ...q,
          fieldIds: q.fieldIds.filter((x) => x !== fid),
        }))
        .filter((q) => q.fieldIds.length > 0);
      // Drop child triggers that referenced the removed field
      const cleaned = next.map((q) => {
        if (q.trigger?.fieldId === fid) {
          const { trigger: _t, parentQuestionId: _p, ...rest } = q;
          return rest;
        }
        return q;
      });
      return normalizeQuestionOrder(cleaned);
    });
    setRules((prev) => prev.filter((r) => !ruleReferencesField(r, fid)));
    setFields((prev) => prev.filter((_, i) => i !== index));
  }

  // ── Question helpers ──
  function addQuestion() {
    setQuestions((prev) => [
      ...prev,
      { id: `q_${generateId()}`, text: "", fieldIds: [], sort_order: prev.length },
    ]);
  }

  /** Update question + repair child triggers if this question (acting as a
   *  parent) drops a field that any child's trigger depends on. */
  function updateQuestion(index: number, updated: Question) {
    const prev = questions[index];
    if (!prev) {
      setQuestions((qs) => qs.map((q, i) => (i === index ? updated : q)));
      return;
    }

    const removedFids = prev.fieldIds.filter((f) => !updated.fieldIds.includes(f));
    const childIdxs = questions
      .map((q, i) => ({ q, i }))
      .filter(({ q }) => q.parentQuestionId === prev.id);
    const affected = childIdxs.filter(({ q }) =>
      q.trigger ? removedFids.includes(q.trigger.fieldId) : false,
    );

    if (affected.length === 0) {
      setQuestions((qs) => qs.map((q, i) => (i === index ? updated : q)));
      return;
    }

    // Re-point each affected child trigger to a remaining field of the same kind
    // when possible; otherwise reset operator/value. If parent has no fields at
    // all after the edit, drop the trigger + parent link.
    let kept = 0;
    let reset = 0;
    let orphaned = 0;
    setQuestions((qs) => qs.map((q, i) => {
      if (i === index) return updated;
      if (q.parentQuestionId !== prev.id) return q;
      if (!q.trigger || !removedFids.includes(q.trigger.fieldId)) return q;

      const oldKind = fields.find((f) => f.id === q.trigger!.fieldId)?.value_kind;

      if (updated.fieldIds.length === 0) {
        orphaned += 1;
        const { trigger: _t, parentQuestionId: _p, ...rest } = q;
        return rest;
      }

      let pick = updated.fieldIds
        .map((fid) => fields.find((f) => f.id === fid))
        .find((f): f is LandlordField => !!f && f.value_kind === oldKind);
      if (!pick) {
        pick = fields.find((f) => f.id === updated.fieldIds[0]);
      }
      if (!pick) {
        orphaned += 1;
        const { trigger: _t, parentQuestionId: _p, ...rest } = q;
        return rest;
      }
      if (pick.value_kind === oldKind) {
        kept += 1;
        return { ...q, trigger: { ...q.trigger!, fieldId: pick.id } };
      }
      reset += 1;
      return {
        ...q,
        trigger: {
          fieldId: pick.id,
          operator: defaultOperatorForKind(pick.value_kind),
          value: defaultValueForKind(pick.value_kind),
        },
      };
    }));

    if (orphaned > 0) {
      toast.warning(
        `${orphaned} follow-up(s) lost their trigger and were promoted to root questions.`,
        { duration: 6000 },
      );
    }
    if (kept > 0 && reset === 0) {
      toast.info(`Re-pointed ${kept} follow-up trigger(s) to a remaining field on this question.`);
    } else if (reset > 0 && kept === 0) {
      toast.warning(
        `Re-pointed ${reset} follow-up trigger(s); operator/value reset because the new trigger is a different type.`,
        { duration: 5000 },
      );
    } else if (kept > 0 && reset > 0) {
      toast.info(`Re-pointed ${kept + reset} follow-up trigger(s); ${reset} had operator/value reset.`);
    }
  }

  function updateTrigger(index: number, patch: Partial<QuestionTrigger>) {
    setQuestions((qs) => qs.map((q, i) => {
      if (i !== index) return q;
      if (!q.trigger) return q;
      return { ...q, trigger: { ...q.trigger, ...patch } };
    }));
  }

  function deleteQuestion(index: number) {
    const tree = buildQuestionTree(questions);
    const node = findNode(tree, index);
    const indicesToRemove = node ? collectSubtreeIndices(node) : [index];
    const removeIds = new Set(indicesToRemove.map((i) => questions[i]?.id).filter(Boolean));

    setQuestions((prev) =>
      normalizeQuestionOrder(prev.filter((q) => !removeIds.has(q.id))),
    );
  }

  function requestDeleteQuestion(index: number, descendantCount: number) {
    const q = questions[index];
    if (!q) return;
    const prevQuestions = questions;
    deleteQuestion(index);
    const label = descendantCount > 0
      ? `Deleted question and ${descendantCount} follow-up${descendantCount === 1 ? "" : "s"}`
      : "Deleted question";
    toast(label, {
      action: {
        label: "Undo",
        onClick: () => {
          setQuestions(prevQuestions);
        },
      },
      duration: 6000,
    });
  }

  /** Move a contiguous block of questions (root + descendants) from `from` to `to`. */
  function moveQuestion(from: number, to: number, count = 1) {
    setQuestions((prev) => {
      const next = [...prev];
      const block = next.splice(from, count);
      const insertAt = to > from ? to - count : to;
      next.splice(insertAt, 0, ...block);
      return normalizeQuestionOrder(next);
    });
  }

  /** Insert a follow-up question right after the subtree rooted at `parentIndex`,
   *  parented to it via `parentQuestionId` and pre-configured with a trigger
   *  on the parent's first field. */
  function addFollowUp(parentIndex: number, isRejection = false) {
    const parent = questions[parentIndex];
    if (!parent || parent.fieldIds.length === 0) return;
    const triggerFid = parent.fieldIds[0];
    const triggerField = fields.find((f) => f.id === triggerFid);
    if (!triggerField) return;

    const newQ: Question = {
      id: `q_${generateId()}`,
      text: "",
      fieldIds: [],
      sort_order: 0,
      parentQuestionId: parent.id,
      trigger: {
        fieldId: triggerFid,
        operator: defaultOperatorForKind(triggerField.value_kind),
        value: defaultValueForKind(triggerField.value_kind),
      },
      is_rejection: isRejection,
    };

    setQuestions((prev) => {
      const tree = buildQuestionTree(prev);
      const parentNode = findNode(tree, parentIndex);
      const subtreeIdxs = parentNode ? collectSubtreeIndices(parentNode) : [parentIndex];
      const insertAt = Math.max(...subtreeIdxs) + 1;
      const next = [...prev];
      next.splice(insertAt, 0, newQ);
      return normalizeQuestionOrder(next);
    });
  }

  // ── Rendering ──

  if (pageLoading) return <PropertyEditorSkeleton />;
  if (error) {
    return (
      <div className="flex items-center justify-center py-32">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  const isNew = !description.trim() && fields.length === 0 && questions.length === 0 && rules.length === 0;

  const invalidRuleCount = countInvalidRuleConditions(rules, fields);
  const invalidQuestionCount = questionInvalid.count;
  const invalidIssueCount = invalidRuleCount + invalidQuestionCount;
  const isReady = invalidIssueCount === 0;

  async function handlePublish() {
    if (!isReady) return;
    const ok = await save({ published_at: new Date().toISOString() });
    if (ok) toast.success("Published — applicants can use the chat link.");
  }

  function jumpToFirstQuestionError() {
    const fid = questionInvalid.firstInvalidId;
    if (!fid) return;
    setQuestionJumpNonce((n) => n + 1);
    // Ancestors expand in separate commits; retry until the target mounts or cap out.
    let attempts = 0;
    const maxAttempts = 24;
    const tryScroll = () => {
      const el = document.getElementById(`${fid}-question-error`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      attempts += 1;
      if (attempts < maxAttempts) requestAnimationFrame(tryScroll);
    };
    requestAnimationFrame(tryScroll);
  }

  function jumpToFirstRuleError() {
    const cid = getFirstInvalidRuleConditionId(rules, fields);
    if (!cid) return;
    let attempts = 0;
    const maxAttempts = 24;
    const tryScroll = () => {
      const el = document.getElementById(`${cid}-error`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      attempts += 1;
      if (attempts < maxAttempts) requestAnimationFrame(tryScroll);
    };
    requestAnimationFrame(tryScroll);
  }

  function handleFixIssuesClick() {
    if (invalidQuestionCount > 0) {
      setActiveTab("Questions");
      jumpToFirstQuestionError();
      return;
    }
    if (invalidRuleCount > 0) {
      setActiveTab("Rules");
      jumpToFirstRuleError();
    }
  }

  return (
    <>
      {/* ── Sticky sub-header ─────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 border-b border-black/8 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
          <div className="flex min-w-0 items-center gap-3 text-sm">
            <div className="flex items-center gap-2 text-[#1a2e2a]/45">
              <Link href="/" className="transition-colors hover:text-[#1a2e2a]">
                Properties
              </Link>
              <span className="text-[#1a2e2a]/20">/</span>
            </div>
            <span className="truncate font-medium text-[#1a2e2a]">
              {title || "Untitled"}
            </span>
            <span
              className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${publishedAt
                ? "bg-teal-50 text-teal-700 border border-teal-200/50"
                : "bg-black/[0.03] text-[#1a2e2a]/50 border border-black/[0.05]"
                }`}
            >
              {publishedAt ? "Published" : "Draft"}
            </span>

            <span
              className="shrink-0 text-[11px] text-[#1a2e2a]/30 transition-all duration-300"
              aria-live="polite"
            >
              {saving
                ? "Saving…"
                : showSaved && !dirty
                  ? "Saved"
                  : dirty
                    ? "Unsaved"
                    : null}
            </span>
          </div>

          <div id="tour-publish-btn" className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setShareModalOpen(true)}
              disabled={!isReady || !publishedAt}
              title={
                !isReady
                  ? "Fix all questions and rule values first"
                  : !publishedAt
                    ? "Publish before sharing the applicant link"
                    : "Copy applicant chat link"
              }
              className="flex items-center gap-1.5 rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium text-[#1a2e2a]/50 transition-colors hover:bg-[#f7f9f8] hover:text-[#1a2e2a] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M10.5 5h-1a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v0a2 2 0 0 0-2-2ZM4.5 5h-1a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v0a2 2 0 0 0-2-2ZM5 7h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              Share link
            </button>
            {isReady && !publishedAt && (
              <button
                type="button"
                onClick={() => void handlePublish()}
                disabled={saving}
                className="rounded-lg border border-teal-700/40 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-800 transition-colors hover:bg-teal-100 disabled:opacity-50"
              >
                Publish
              </button>
            )}
            {!isReady ? (
              <button
                type="button"
                onClick={handleFixIssuesClick}
                className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-200"
              >
                Fix {invalidIssueCount} {invalidQuestionCount > 0 && invalidRuleCount > 0 ? "question or rule value" : invalidQuestionCount > 0 ? "question" : "rule value"}
                {invalidIssueCount === 1 ? "" : "s"}
              </button>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  await flushSave();
                  window.open(`/chat/${id}?preview=1`, "_blank");
                }}
                className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
              >
                Preview →
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">

        <PropertyWalkthrough 
          run={runWalkthrough} 
          onFinish={() => setRunWalkthrough(false)} 
          setActiveTab={setActiveTab} 
        />
        {/* Onboarding guide */}
        {isNew && !runWalkthrough && (
          <section className="rounded-xl border border-teal-200 bg-teal-50/60 p-5 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-teal-900">New Property Setup</h2>
              <p className="mt-1 text-sm text-teal-800/70">Take a quick 1-minute tour to see how to set up your AI screening process.</p>
            </div>
            <button
              onClick={() => setRunWalkthrough(true)}
              className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 shrink-0"
            >
              Start Tutorial
            </button>
          </section>
        )}

        {/* Property details card */}
        <section id="tour-property-details" className="rounded-xl border border-black/8 bg-white shadow-sm">
          <div className="space-y-4 p-6">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1a2e2a]/40">
              Property details
            </h2>
            <input
              type="text"
              placeholder="Property title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-foreground/10 bg-[#f7f9f8] px-4 py-2.5 text-base font-semibold text-foreground placeholder:font-normal placeholder:text-foreground/30 focus:border-teal-700/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-700/20"
            />
            <div>
              <textarea
                ref={descRef}
                placeholder="Describe your property — rent, rules, requirements, pet policy, lease length, etc."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-[120px] w-full resize-none overflow-hidden rounded-lg border border-foreground/10 bg-[#f7f9f8] px-4 py-3 text-sm text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
              <VariableShortcuts 
                variables={variables} 
                onInsert={(varId) => insertAtCursor(description, varId, descRef, setDescription)}
              />
            </div>
          </div>
        </section>

        {/* Configuration card */}
        <section className="rounded-xl border border-black/8 bg-white shadow-sm">
          {/* Tab bar */}
          <div className="flex gap-1 border-b border-black/5 px-6 pt-1">
            {TABS.map((tab) => (
              <button
                key={tab}
                id={`tour-tab-${tab.toLowerCase().replace(" ", "-")}`}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-3 text-sm font-medium transition-colors ${activeTab === tab
                  ? "border-b-2 border-teal-700 text-teal-700"
                  : "text-foreground/45 hover:text-foreground/70"
                  }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="p-6">
            {/* ── Fields Tab ── */}
            {activeTab === "Fields" && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-foreground/80">Data schema</h3>
                  <p className="text-xs text-foreground/40">
                    Define fields to store (used by screening rules and interview questions).
                    Branching follow-ups live on the Questions tab — define which question triggers them there.
                  </p>
                </div>

                <LandlordFieldsSection
                  fields={fields}
                  questions={questions}
                  onChange={setFields}
                  onBeforeDelete={(field, index) => {
                    requestDeleteField(index);
                    return false;
                  }}
                />
              </div>
            )}

            {/* ── Variables Tab ── */}
            {activeTab === "Variables" && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-foreground/80">Custom variables</h3>
                  <p className="text-xs text-foreground/40">
                    Define custom variables that can be dynamically inserted into question text. Use {"{{variable_name}}"} in your questions to show the value.
                  </p>
                </div>

                <VariablesSection
                  variables={variables}
                  onChange={setVariables}
                />
              </div>
            )}

            {/* ── Questions Tab ── */}
            {activeTab === "Questions" && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-foreground/80">Interview flow</h3>
                  <p className="text-xs text-foreground/40">
                    Ordered questions asked to applicants. Each question collects one or more fields.
                    Add follow-ups to branch — they only appear when the parent question&apos;s answer matches the trigger.
                  </p>
                </div>

                {invalidQuestionCount > 0 && (
                  <div className="flex items-center gap-3 text-sm">
                    <span className="font-medium text-red-500">
                      {invalidQuestionCount} invalid question{invalidQuestionCount === 1 ? "" : "s"} in this section.
                    </span>
                    <button
                      type="button"
                      onClick={jumpToFirstQuestionError}
                      className="text-red-500/70 underline decoration-red-500/30 underline-offset-2 transition-colors hover:text-red-600"
                    >
                      Jump to first error
                    </button>
                  </div>
                )}

                {/* Generate prompt */}
                <div id="tour-generate-questions">
                  <div className="flex items-start gap-2">
                    <TextareaAutosize
                      value={questionsPrompt}
                      onChange={(e) => setQuestionsPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey && !loadingPhase && questionsPrompt.trim()) {
                          e.preventDefault();
                          void handleGenerateQuestions(questionsPrompt).then(() => setQuestionsPrompt(""));
                        }
                      }}
                      minRows={1}
                      placeholder="e.g. Occupants, income, pets, move-in"
                      className="min-w-0 flex-1 resize-none overflow-hidden rounded-md border border-foreground/10 bg-[#f7f9f8] px-2.5 py-1.5 text-sm leading-snug text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                    />
                    <button
                      type="button"
                      onClick={() => void handleGenerateQuestions(questionsPrompt).then(() => setQuestionsPrompt(""))}
                      disabled={!questionsPrompt.trim() || loadingPhase !== null}
                      title={
                        loadingPhase === "questions"
                          ? "Generating…"
                          : !questionsPrompt.trim()
                            ? "Describe what you want to ask, then we'll scaffold the questions for you."
                            : "Scaffold questions from this description"
                      }
                      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-teal-700/30 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-700 transition-colors hover:bg-teal-100 disabled:opacity-40"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                        <path d="M7 1v3M7 10v3M1 7h3M10 7h3M2.75 2.75l2.12 2.12M9.13 9.13l2.12 2.12M11.25 2.75l-2.12 2.12M4.87 9.13l-2.12 2.12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                      </svg>
                      {loadingPhase === "questions" ? "Generating…" : "Generate"}
                    </button>
                    <MaxFieldsPopover value={maxFieldsPerQuestion} onChange={setMaxFieldsPerQuestion} />
                  </div>
                  {!questionsPrompt.trim() && loadingPhase !== "questions" && (
                    <p className="mt-1 text-[11px] text-foreground/40">
                      Describe what to ask; we&apos;ll scaffold questions. Shift+Enter for a new line.
                    </p>
                  )}
                </div>

                {/* Question list — recursive tree with depth-coded rails */}
                <div className="space-y-2">
                  {(() => {
                    const tree = buildQuestionTree(questions);
                    return tree.map((root, ri) => {
                      const sz = subtreeSize(root);
                      const prevRoot = ri > 0 ? tree[ri - 1] : null;
                      const nextRoot = ri < tree.length - 1 ? tree[ri + 1] : null;
                      return (
                        <QuestionNode
                          key={questions[root.index].id}
                          node={root}
                          questions={questions}
                          fields={fields}
                          variables={variables}
                          depth={0}
                          pathLabel={`Q${ri + 1}`}
                          maxFields={maxFieldsPerQuestion}
                          invalidQuestionIds={questionInvalid.invalidIds}
                          firstInvalidQuestionId={questionInvalid.firstInvalidId}
                          questionJumpNonce={questionJumpNonce}
                          updateQuestion={updateQuestion}
                          updateTrigger={updateTrigger}
                          requestDeleteQuestion={requestDeleteQuestion}
                          onMoveRootUp={prevRoot ? () => {
                            moveQuestion(root.index, prevRoot.index, sz);
                          } : undefined}
                          onMoveRootDown={nextRoot ? () => {
                            const nextSz = subtreeSize(nextRoot);
                            moveQuestion(root.index, root.index + sz + nextSz, sz);
                          } : undefined}
                          addFollowUp={addFollowUp}
                        />
                      );
                    });
                  })()}
                </div>

                <button
                  id="tour-add-question"
                  type="button"
                  onClick={addQuestion}
                  className="flex items-center gap-1.5 rounded-lg border border-dashed border-foreground/20 px-4 py-2 text-sm text-foreground/50 transition-colors hover:border-foreground/40 hover:text-foreground/70"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                  Add question
                </button>
              </div>
            )}

            {/* ── Rules Tab ── */}
            {activeTab === "Rules" && (
              <div className="space-y-6">
                <div id="tour-generate-rules" className="flex flex-col gap-2">
                  <p className="text-xs text-foreground/40">
                    Describe rules to add — rejections, acceptance profiles, or both. Shift+Enter for a new line.
                  </p>
                  <div className="flex items-start gap-2">
                    <TextareaAutosize
                      value={rulesPrompt}
                      onChange={(e) => setRulesPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey && !loadingPhase && rulesPrompt.trim()) {
                          e.preventDefault();
                          void handleGenerateRules(rulesPrompt).then(() => setRulesPrompt(""));
                        }
                      }}
                      minRows={1}
                      placeholder="e.g. No smoking; income 3× rent"
                      className="min-w-0 flex-1 resize-none overflow-hidden rounded-md border border-foreground/10 bg-[#f7f9f8] px-2.5 py-1.5 text-sm leading-snug text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                    />
                    <button
                      type="button"
                      onClick={() => void handleGenerateRules(rulesPrompt).then(() => setRulesPrompt(""))}
                      disabled={!rulesPrompt.trim() || loadingPhase !== null || fields.length === 0}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-teal-700/30 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-700 transition-colors hover:bg-teal-100 disabled:opacity-40"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                        <path d="M7 1v3M7 10v3M1 7h3M10 7h3M2.75 2.75l2.12 2.12M9.13 9.13l2.12 2.12M11.25 2.75l-2.12 2.12M4.87 9.13l-2.12 2.12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                      </svg>
                      {loadingPhase === "rules" ? "Generating…" : "Generate"}
                    </button>
                  </div>
                </div>
                <RulesSection
                  fields={fields}
                  rules={rules}
                  onChange={setRules}
                />
              </div>
            )}

            {/* ── Links Tab ── */}
            {activeTab === "Links" && (
              <div className="space-y-5">
                <p className="text-sm text-foreground/60">
                  Shared with qualified applicants at the end of the screening.
                </p>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground/60">Video tour link</label>
                  <input type="url" placeholder="https://…" value={links.videoUrl} onChange={(e) => setLinks((prev) => ({ ...prev, videoUrl: e.target.value }))} className="w-full rounded-lg border border-foreground/10 bg-[#f7f9f8] px-3 py-2 text-sm focus:border-teal-700/40 focus:bg-white focus:outline-none" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground/60">Booking link</label>
                  <input type="url" placeholder="https://…" value={links.bookingUrl} onChange={(e) => setLinks((prev) => ({ ...prev, bookingUrl: e.target.value }))} className="w-full rounded-lg border border-foreground/10 bg-[#f7f9f8] px-3 py-2 text-sm focus:border-teal-700/40 focus:bg-white focus:outline-none" />
                </div>
              </div>
            )}

            {/* ── AI Behavior Tab ── */}
            {activeTab === "AI Behavior" && (
              <div className="space-y-6">
                <div className="space-y-4 rounded-lg border border-foreground/8 bg-[#f7f9f8] p-5">
                  <h3 className="text-sm font-medium text-foreground/80">Conversation controls</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-foreground/60">Off-topic limit</label>
                      <p className="text-[11px] text-foreground/35">Consecutive off-topic messages before auto-rejection. 0 = unlimited.</p>
                      <input type="number" min={0} value={aiInstructions.offTopicLimit ?? 3} onChange={(e) => setAiInstructions((prev) => ({ ...prev, offTopicLimit: Math.max(0, parseInt(e.target.value) || 0) }))} className="w-24 rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm focus:border-teal-700/40 focus:outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-foreground/60">Post-qualified follow-ups</label>
                      <p className="text-[11px] text-foreground/35">Messages allowed after qualification. 0 = close immediately.</p>
                      <input type="number" min={0} value={aiInstructions.qualifiedFollowUps ?? 3} onChange={(e) => setAiInstructions((prev) => ({ ...prev, qualifiedFollowUps: Math.max(0, parseInt(e.target.value) || 0) }))} className="w-24 rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm focus:border-teal-700/40 focus:outline-none" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground/60">Unknown info handling</label>
                    <p className="text-[11px] text-foreground/35">When an applicant asks about something not in the description.</p>
                    <div className="flex gap-4 pt-1">
                      <label className="flex items-center gap-2 text-sm text-foreground/70">
                        <input type="radio" name="unknownInfo" checked={(aiInstructions.unknownInfoBehavior ?? "deflect") === "deflect"} onChange={() => setAiInstructions((prev) => ({ ...prev, unknownInfoBehavior: "deflect" }))} className="accent-teal-700" />
                        Say &quot;I don&apos;t know, contact landlord&quot;
                      </label>
                      <label className="flex items-center gap-2 text-sm text-foreground/70">
                        <input type="radio" name="unknownInfo" checked={aiInstructions.unknownInfoBehavior === "ignore"} onChange={() => setAiInstructions((prev) => ({ ...prev, unknownInfoBehavior: "ignore" }))} className="accent-teal-700" />
                        Redirect to screening
                      </label>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 rounded-lg border border-foreground/8 bg-[#f7f9f8] p-5">
                  <h3 className="text-sm font-medium text-foreground/80">Eligibility responses</h3>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground/60">First concern (clarification)</label>
                    <p className="text-[11px] text-foreground/35">How the AI should respond when an applicant first fails a rule.</p>
                    <textarea rows={2} value={aiInstructions.clarificationPrompt} onChange={(e) => setAiInstructions((prev) => ({ ...prev, clarificationPrompt: e.target.value }))} placeholder="e.g. Let the applicant know their answer doesn't meet the requirement and give them a chance to correct it." className="w-full resize-none rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:outline-none" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground/60">Confirmed rejection</label>
                    <p className="text-[11px] text-foreground/35">How the AI should respond when an applicant still fails after clarification.</p>
                    <textarea rows={2} value={aiInstructions.rejectionPrompt} onChange={(e) => setAiInstructions((prev) => ({ ...prev, rejectionPrompt: e.target.value }))} placeholder="e.g. Let the applicant know they don't meet the requirement, state the reason, and close the conversation." className="w-full resize-none rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:outline-none" />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground/80">Style instructions</label>
                  <p className="text-xs text-foreground/40">Tell the AI how to behave — tone, formatting, how to handle specific situations.</p>
                  <textarea rows={5} value={aiInstructions.style} onChange={(e) => setAiInstructions((prev) => ({ ...prev, style: e.target.value }))} placeholder="e.g. Be concise. Use a friendly but professional tone." className="w-full resize-none rounded-lg border border-foreground/10 bg-[#f7f9f8] px-4 py-3 text-sm text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-700/20" />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-sm font-medium text-foreground/80">Example conversations</label>
                      <p className="text-xs text-foreground/40">Show the AI how you want it to respond in specific scenarios.</p>
                    </div>
                    <button type="button" onClick={() => setAiInstructions((prev) => ({ ...prev, examples: [...(prev.examples ?? []), { user: "", assistant: "" }] }))} className="text-sm text-teal-700 hover:underline">
                      + Add example
                    </button>
                  </div>
                  {(aiInstructions.examples ?? []).length === 0 && (
                    <p className="text-sm text-foreground/30">No examples yet.</p>
                  )}
                  {(aiInstructions.examples ?? []).map((ex, i) => (
                    <div key={i} className="space-y-2 rounded-lg border border-foreground/8 bg-[#f7f9f8] p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/35">Example {i + 1}</span>
                        <button type="button" onClick={() => setAiInstructions((prev) => ({ ...prev, examples: (prev.examples ?? []).filter((_, j) => j !== i) }))} className="text-xs text-foreground/30 hover:text-red-500">Remove</button>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-foreground/50">Tenant says:</label>
                        <input type="text" value={ex.user} onChange={(e) => { const next = [...(aiInstructions.examples ?? [])]; next[i] = { ...next[i], user: e.target.value }; setAiInstructions((prev) => ({ ...prev, examples: next })); }} placeholder="e.g. Is the apartment pet-friendly?" className="w-full rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm focus:border-teal-700/40 focus:outline-none" />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-foreground/50">AI should respond:</label>
                        <textarea rows={2} value={ex.assistant} onChange={(e) => { const next = [...(aiInstructions.examples ?? [])]; next[i] = { ...next[i], assistant: e.target.value }; setAiInstructions((prev) => ({ ...prev, examples: next })); }} placeholder="e.g. We do allow small pets with a $500 deposit. Do you have any pets?" className="w-full resize-none rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm focus:border-teal-700/40 focus:outline-none" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      <RuleProposalModal
        open={!!ruleProposal}
        proposal={ruleProposal}
        existingRules={rules}
        existingQuestions={questions}
        existingFields={fields}
        onConfirm={applyProposal}
        onCancel={() => setRuleProposal(null)}
      />

      <ShareLinkModal
        open={shareModalOpen}
        propertyId={id}
        onClose={() => setShareModalOpen(false)}
      />

      <ConfirmDialog
        open={fieldDeleteIndex !== null}
        title="Delete this field?"
        description={
          fieldDeleteIndex === null
            ? ""
            : (() => {
              const field = fields[fieldDeleteIndex];
              if (!field?.id) return "";
              const qs = questions.filter((q) => q.fieldIds.includes(field.id));
              const rs = rules.filter((r) => ruleReferencesField(r, field.id));
              const lines: string[] = [
                `Field “${field.label || field.id}” (${field.id}) is still in use.`,
                "",
                qs.length > 0
                  ? `Questions that reference it (${qs.length}):\n${qs.map((q) => `• ${q.text.slice(0, 120)}${q.text.length > 120 ? "…" : ""} [${q.fieldIds.join(", ")}]`).join("\n")}`
                  : "Questions: none",
                "",
                rs.length > 0
                  ? `Rules that reference it (${rs.length}) — these will be removed:\n${rs.map((r) => `• ${summarizeRule(r)}`).join("\n")}`
                  : "Rules: none",
                "",
                "Questions will have this field unlinked. Any question left with no fields will be removed.",
              ];
              return lines.join("\n");
            })()
        }
        confirmLabel="Delete field"
        destructive
        onConfirm={() => confirmDeleteField()}
        onCancel={() => setFieldDeleteIndex(null)}
      />
    </>
  );
}
