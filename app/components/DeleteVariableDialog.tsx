"use client";

import { useEffect, useRef } from "react";
import type { Question } from "@/lib/question";
import type { PropertyVariable } from "@/lib/property";
import { resolveVarTokens, describeCondition } from "@/lib/condition-utils";
import type { LandlordField } from "@/lib/landlord-field";

export function DeleteVariableDialog({
  open,
  variable,
  referencedQuestions,
  conditionReferencedQuestions = [],
  variables = [],
  fields = [],
  onConfirm,
  onCancel,
}: {
  open: boolean;
  variable: PropertyVariable | null;
  referencedQuestions: Question[];
  conditionReferencedQuestions?: Question[];
  variables?: PropertyVariable[];
  fields?: LandlordField[];
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

  if (!open || !variable) return null;

  const textCount = referencedQuestions.length;
  const condCount = conditionReferencedQuestions.length;
  const hasRefs = textCount > 0 || condCount > 0;

  const token = `{{${variable.id}}}`;

  return (
    <dialog
      ref={dialogRef}
      onClose={onCancel}
      className="fixed inset-0 z-50 m-auto w-full max-w-md rounded-xl border border-black/8 bg-white p-0 shadow-xl backdrop:bg-black/40"
    >
      <div className="p-6">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 3v5M8 11v1" stroke="#dc2626" strokeWidth="1.75" strokeLinecap="round" />
              <path d="M2.5 13.5l5-10a.6.6 0 011 0l5 10a.6.6 0 01-.5.9h-10a.6.6 0 01-.5-.9z" stroke="#dc2626" strokeWidth="1.5" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[#1a2e2a]">
              Delete &ldquo;{variable.label || variable.id}&rdquo;?
            </h3>
            <p className="mt-1 text-sm text-[#1a2e2a]/55">
              {!hasRefs && "This variable is not used anywhere and can be safely removed."}
              {hasRefs && (
                <>
                  {[
                    textCount > 0 && `${textCount} question text${textCount !== 1 ? "s" : ""}`,
                    condCount > 0 && `${condCount} branch condition${condCount !== 1 ? "s" : ""}`,
                  ]
                    .filter(Boolean)
                    .join(" and ")}{" "}
                  reference{textCount + condCount === 1 ? "s" : ""}{" "}
                  <span className="font-mono text-violet-600">{token}</span>.
                </>
              )}
            </p>
          </div>
        </div>

        {textCount > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-[#1a2e2a]/35">
              Question text — token will be removed
            </p>
            <ul className="flex flex-col gap-1.5">
              {referencedQuestions.map((q) => {
                const resolved = resolveVarTokens(q.text, variables);
                const text = resolved.length > 110 ? resolved.slice(0, 110) + "…" : resolved;
                return (
                  <li key={q.id} className="rounded-lg border border-black/8 bg-[#f7f9f8] px-3 py-2.5">
                    <p className="text-sm leading-snug text-[#1a2e2a]/80">&ldquo;{text}&rdquo;</p>
                    <p className="mt-1 text-[11px] text-[#1a2e2a]/35">
                      <span className="font-mono text-violet-600">{token}</span>{" "}
                      will be removed from this question
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {condCount > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-[#1a2e2a]/35">
              Branch conditions — branch will be deleted
            </p>
            <ul className="flex flex-col gap-1.5">
              {conditionReferencedQuestions.map((q) => {
                const resolved = resolveVarTokens(q.text, variables);
                const text = resolved.length > 80 ? resolved.slice(0, 80) + "…" : resolved;
                const affectedBranches = q.branches.filter((b) => b.condition.value.includes(token));
                return (
                  <li key={q.id} className="rounded-lg border border-black/8 bg-[#f7f9f8] px-3 py-2.5">
                    <p className="text-sm leading-snug text-[#1a2e2a]/80">&ldquo;{text}&rdquo;</p>
                    <ul className="mt-1.5 flex flex-col gap-1">
                      {affectedBranches.map((b) => (
                        <li key={b.id} className="text-[11px] text-red-500/80">
                          Branch &ldquo;{describeCondition(b.condition, fields, variables)}&rdquo; will be deleted
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-black/10 px-4 py-2 text-sm text-[#1a2e2a]/60 transition-colors hover:bg-[#f7f9f8]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Delete variable
          </button>
        </div>
      </div>
    </dialog>
  );
}
