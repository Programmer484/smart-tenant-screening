"use client";

import { useEffect, useRef } from "react";
import type { LandlordField } from "@/lib/landlord-field";
import type { Question } from "@/lib/question";
import type { PropertyVariable } from "@/lib/property";
import { resolveVarTokens } from "@/lib/condition-utils";

export function DeleteFieldDialog({
  open,
  field,
  referencedQuestions,
  variables = [],
  onConfirm,
  onCancel,
}: {
  open: boolean;
  field: LandlordField | null;
  referencedQuestions: Question[];
  variables?: PropertyVariable[];
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

  if (!open || !field) return null;

  const count = referencedQuestions.length;
  const hasRefs = count > 0;

  return (
    <dialog
      ref={dialogRef}
      onClose={onCancel}
      className="fixed inset-0 z-50 m-auto w-full max-w-md rounded-xl border border-black/8 bg-white p-0 shadow-xl backdrop:bg-black/40"
    >
      <div className="p-6">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 3v5M8 11v1" stroke="#dc2626" strokeWidth="1.75" strokeLinecap="round" />
              <path d="M2.5 13.5l5-10a.6.6 0 011 0l5 10a.6.6 0 01-.5.9h-10a.6.6 0 01-.5-.9z" stroke="#dc2626" strokeWidth="1.5" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[#1a2e2a]">
              Delete &ldquo;{field.label || "this field"}&rdquo;?
            </h3>
            <p className="mt-1 text-sm text-[#1a2e2a]/55">
              {hasRefs
                ? `This field is linked to ${count} question${count !== 1 ? "s" : ""} that will need to be updated.`
                : "This field has no linked questions and can be safely removed."}
            </p>
          </div>
        </div>

        {/* Referenced questions */}
        {hasRefs && (
          <div className="mt-4 flex flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-[#1a2e2a]/35">
              Affected question{count !== 1 ? "s" : ""}
            </p>
            <ul className="flex flex-col gap-1.5">
              {referencedQuestions.map((q) => {
                const resolved = resolveVarTokens(q.text, variables);
                const text = resolved.length > 110 ? resolved.slice(0, 110) + "…" : resolved;
                const remaining = q.fieldIds.length - 1;
                return (
                  <li
                    key={q.id}
                    className="rounded-lg border border-black/8 bg-[#f7f9f8] px-3 py-2.5"
                  >
                    <p className="text-sm leading-snug text-[#1a2e2a]/80">&ldquo;{text}&rdquo;</p>
                    {remaining === 0 && (
                      <p className="mt-1 text-[11px] text-red-500/80">
                        No fields remain — this question will be deleted
                      </p>
                    )}
                    {remaining > 0 && (
                      <p className="mt-1 text-[11px] text-[#1a2e2a]/35">
                        {remaining} other field{remaining !== 1 ? "s" : ""} remain
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Footer */}
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
            Delete field
          </button>
        </div>
      </div>
    </dialog>
  );
}
