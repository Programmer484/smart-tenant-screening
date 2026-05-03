"use client";

import { useEffect, useRef } from "react";
import type { LandlordField } from "@/lib/landlord-field";
import type { LandlordRule } from "@/lib/landlord-rule";
import type { Branch, Question } from "@/lib/question";

const OUTCOME_STYLES: Record<string, { label: string; badge: string; border: string; bg: string; text: string }> = {
  reject:   { label: "Reject",        badge: "bg-red-100 text-red-700 border-red-200",    border: "border-red-200",   bg: "bg-red-50/40",   text: "text-red-900/70" },
  review:   { label: "Manual Review", badge: "bg-amber-100 text-amber-700 border-amber-200", border: "border-amber-200", bg: "bg-amber-50/40", text: "text-amber-900/70" },
  followups:{ label: "Follow-ups",    badge: "bg-blue-100 text-blue-700 border-blue-200",   border: "border-blue-200",  bg: "bg-blue-50/30",  text: "text-blue-900/70" },
  continue: { label: "Continue",      badge: "bg-gray-100 text-gray-600 border-gray-200",   border: "border-gray-200",  bg: "bg-gray-50/40",  text: "text-gray-700" },
};

const OP_LABEL: Record<string, string> = {
  "==": "is", "!=": "is not", ">": ">", ">=": "≥", "<": "<", "<=": "≤",
};

function BranchList({ branches, fieldLabel, depth = 0 }: {
  branches: Branch[];
  fieldLabel: (id: string) => string;
  depth?: number;
}) {
  if (branches.length === 0) return null;
  return (
    <div className={`flex flex-col gap-1.5 ${depth > 0 ? "ml-4 mt-1.5" : "mt-2"}`}>
      {branches.map((b) => {
        const style = OUTCOME_STYLES[b.outcome] ?? OUTCOME_STYLES.continue;
        const condLabel = `${fieldLabel(b.condition.fieldId)} ${OP_LABEL[b.condition.operator] ?? b.condition.operator} ${b.condition.value}`;
        return (
          <div key={b.id} className={`rounded-lg border ${style.border} ${style.bg} px-2.5 py-1.5`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-foreground/40 font-medium uppercase tracking-wide">if</span>
              <span className="text-xs text-foreground/70 font-mono">{condLabel}</span>
              <span className={`ml-auto text-[10px] font-semibold uppercase tracking-wide border rounded px-1.5 py-0.5 ${style.badge}`}>
                {style.label}
              </span>
            </div>
            {b.subQuestions.length > 0 && (
              <div className="mt-1.5 flex flex-col gap-1.5 border-l-2 border-blue-200 pl-2.5">
                {b.subQuestions.map((sq) => (
                  <div key={sq.id} className="flex flex-col gap-0.5">
                    <div className="text-xs font-medium text-foreground/80">{sq.text}</div>
                    <div className="flex flex-wrap gap-1">
                      {sq.fieldIds.map((fid) => (
                        <span key={fid} className="text-[10px] rounded bg-black/5 border border-black/5 px-1.5 py-0.5 text-black/50">{fid}</span>
                      ))}
                    </div>
                    <BranchList branches={sq.branches} fieldLabel={fieldLabel} depth={depth + 1} />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export type Proposal = {
  newRules: LandlordRule[];
  modifiedRules: LandlordRule[];
  deletedRuleIds: string[];
  newFields: LandlordField[];
  proposedQuestions: Question[];
  deletedQuestionIds: string[];
};

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
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  if (!open || !proposal) return null;

  return (
    <dialog
      ref={dialogRef}
      onClose={onCancel}
      className="fixed inset-0 z-50 m-auto max-w-xl rounded-xl border border-black/8 bg-white p-0 shadow-xl backdrop:bg-black/40"
    >
      <ProposalReviewContent 
        proposal={proposal}
        existingRules={existingRules}
        existingQuestions={existingQuestions}
        existingFields={existingFields}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </dialog>
  );
}

export function ProposalReviewContent({
  proposal,
  existingRules,
  existingQuestions,
  existingFields,
  onConfirm,
  onCancel,
  showActions = true,
}: {
  proposal: Proposal;
  existingRules: LandlordRule[];
  existingQuestions: Question[];
  existingFields?: LandlordField[];
  onConfirm?: () => void;
  onCancel?: () => void;
  showActions?: boolean;
}) {
  const hasRuleChanges = proposal.newRules.length > 0 || proposal.modifiedRules.length > 0 || proposal.deletedRuleIds.length > 0;
  const hasFieldChanges = proposal.newFields.length > 0;
  const hasQuestionChanges = proposal.proposedQuestions.length > 0 || proposal.deletedQuestionIds.length > 0;
  const hasChanges = hasRuleChanges || hasFieldChanges || hasQuestionChanges;

  const fieldLabel = (id: string) => {
    const f = existingFields?.find((ef) => ef.id === id) ?? proposal.newFields.find((nf) => nf.id === id);
    return f?.label || id;
  };

  const deletedQuestions = proposal.deletedQuestionIds
    .map((id) => existingQuestions.find((q) => q.id === id))
    .filter((q): q is Question => q != null);

  return (
    <div className="flex max-h-[85vh] flex-col h-full bg-white">
      <div className="border-b border-black/5 p-6 pb-4">
        <h3 className="text-lg font-semibold text-[#1a2e2a]">Review Proposed Changes</h3>
        <p className="mt-1 text-sm text-[#1a2e2a]/60">
          {hasFieldChanges
            ? "The AI proposed changes that include new fields. Please review everything below."
            : hasQuestionChanges && !hasRuleChanges
              ? "Please review the proposed question changes."
              : "Please review the proposed changes."}
        </p>
      </div>

      <div className="overflow-y-auto p-6 flex flex-col gap-6 flex-1">
          {/* Deleted Rules */}
          {proposal.deletedRuleIds.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-red-600">Rules to Delete</h4>
              <ul className="mt-2 flex flex-col gap-2">
                {proposal.deletedRuleIds.map((id, i) => {
                  const r = existingRules.find(er => er.id === id);
                  if (!r) return null;
                  return (
                    <li key={i} className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm flex items-start gap-2 opacity-70">
                      <span className="font-medium text-red-900/80 min-w-16 line-through">
                        {r.kind === "reject" ? "Reject if:" : "Require:"}
                      </span>
                      <div className="flex flex-col text-red-900/70 line-through">
                        {r.conditions.map((c, idx) => (
                          <div key={idx}>
                            {idx > 0 && <span className="text-[11px] font-bold text-red-900/40 uppercase mr-1">and</span>}
                            {c.fieldId} {c.operator} {c.value}
                          </div>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Modified Rules */}
          {proposal.modifiedRules.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-600">Rules to Modify</h4>
              <ul className="mt-2 flex flex-col gap-3">
                {proposal.modifiedRules.map((rule, i) => {
                  const original = existingRules.find(er => er.id === rule.id);
                  return (
                    <li key={i} className="rounded-xl border border-amber-200 bg-amber-50/50 overflow-hidden shadow-sm">
                      {original && (
                        <div className="p-3 text-sm flex items-start gap-2 bg-black/5 opacity-60">
                          <span className="font-medium text-foreground/80 min-w-16 line-through">
                            {original.kind === "reject" ? "Reject if:" : "Require:"}
                          </span>
                          <div className="flex flex-col text-foreground/70 line-through">
                            {original.conditions.map((c, idx) => (
                              <div key={idx}>
                                {idx > 0 && <span className="text-[11px] font-bold text-foreground/40 uppercase mr-1">and</span>}
                                {c.fieldId} {c.operator} {c.value}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      <div className="p-3 text-sm flex items-start gap-2 bg-white">
                        <span className="font-medium text-amber-900 min-w-16">
                          {rule.kind === "reject" ? "Reject if:" : "Require:"}
                        </span>
                        <div className="flex flex-col text-amber-900/80">
                          {rule.conditions.map((c, idx) => (
                            <div key={idx} className="font-medium">
                              {idx > 0 && <span className="text-[11px] font-bold text-amber-700/60 uppercase mr-1">and</span>}
                              {c.fieldId} {c.operator} {c.value}
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

          {/* New Rules */}
          {proposal.newRules.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-teal-700">New Rules</h4>
              <ul className="mt-2 flex flex-col gap-2">
                {proposal.newRules.map((rule, i) => (
                  <li key={i} className="rounded-lg border border-teal-100 bg-teal-50/30 p-3 text-sm flex items-start gap-2">
                    <span className="font-medium text-teal-900/80 min-w-16">
                      {rule.kind === "reject" ? "Reject if:" : "Require:"}
                    </span>
                    <div className="flex flex-col text-teal-900/80 font-medium">
                      {rule.conditions.map((c, idx) => (
                        <div key={idx}>
                          {idx > 0 && <span className="text-[11px] font-bold text-teal-700/60 uppercase mr-1">and</span>}
                          {c.fieldId} {c.operator} {c.value}
                        </div>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* New Fields */}
          {proposal.newFields.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-purple-600">Fields to Add</h4>
              <div className="mt-2 flex flex-wrap gap-2">
                {proposal.newFields.map((f, i) => (
                  <div key={i} className="rounded border border-purple-200 bg-purple-50 px-2 py-1 flex items-center gap-1.5 shadow-sm">
                    <span className="text-xs font-medium text-purple-900">{f.label || f.id}</span>
                    <span className="text-[10px] text-purple-700/60 uppercase tracking-widest bg-purple-100 px-1 rounded">{f.value_kind}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Deleted Questions */}
          {deletedQuestions.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-red-600">Questions to Remove</h4>
              <ul className="mt-2 flex flex-col gap-2">
                {deletedQuestions.map((q, i) => (
                  <li key={i} className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm opacity-70">
                    <div className="text-red-900/70 line-through">{q.text}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {q.fieldIds.map((fid) => (
                        <span key={fid} className="text-[10px] rounded bg-red-100 px-1.5 py-0.5 text-red-800/60 line-through">{fid}</span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Question Updates */}
          {proposal.proposedQuestions.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-blue-600">Question Flow Updates</h4>
              <ul className="mt-2 flex flex-col gap-3">
                {proposal.proposedQuestions.map((q, i) => {
                  const existing = existingQuestions.find((eq) => eq.id === q.id);
                  const isUpdate = !!existing;

                  return (
                    <li key={i} className="rounded-xl border border-blue-100 bg-blue-50/30 overflow-hidden shadow-sm">
                      <div className="bg-blue-100/50 px-3 py-1.5 flex items-center justify-between text-[11px] font-semibold text-blue-800 uppercase tracking-wide">
                        {isUpdate ? "Modified Existing Question" : "New Question"}
                      </div>
                      <div className="p-3 bg-white flex flex-col gap-2 relative">
                        {isUpdate && existing.text !== q.text && (
                          <div className="text-sm text-foreground/40 line-through mb-1">{existing.text}</div>
                        )}
                        <div className="text-sm font-medium text-foreground">{q.text}</div>

                        <div className="flex flex-wrap gap-1">
                          {q.fieldIds.map((fid) => {
                            const isNewlyLinked = isUpdate && !existing.fieldIds.includes(fid);
                            return (
                              <span key={fid} className={`text-[10px] rounded px-1.5 py-0.5 ${isNewlyLinked ? "bg-amber-100 text-amber-800 font-bold border border-amber-200" : "bg-black/5 text-black/50 border border-black/5"}`}>
                                {isNewlyLinked ? "+" : ""}
                                {fid}
                              </span>
                            );
                          })}
                        </div>

                        {q.branches.length > 0 && (
                          <BranchList branches={q.branches} fieldLabel={fieldLabel} />
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {!hasChanges && (
            <p className="text-sm text-foreground/50 italic">No meaningful changes were proposed.</p>
          )}
        </div>

        {showActions && (
          <div className="border-t border-black/5 p-6 pt-4 flex justify-end gap-3 bg-[#f7f9f8]/50">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-black/10 px-4 py-2 text-sm text-[#1a2e2a]/60 transition-colors hover:bg-black/5"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={!hasChanges}
              className="rounded-lg bg-teal-700 px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 shadow-sm disabled:opacity-50"
            >
              Accept & Apply
            </button>
          </div>
        )}
      </div>
    );
}
