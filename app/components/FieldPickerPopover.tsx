"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LandlordField } from "@/lib/landlord-field";

const KIND_BADGE_COLORS: Record<string, string> = {
  text: "bg-slate-100 text-slate-600",
  number: "bg-blue-100 text-blue-700",
  boolean: "bg-emerald-100 text-emerald-700",
  date: "bg-amber-100 text-amber-700",
  enum: "bg-purple-100 text-purple-700",
  error: "bg-red-100 text-red-700",
};

export function FieldPickerPopover({
  open,
  anchorRect,
  fields,
  selectedIds,
  lockedFieldIds,
  lockedReason,
  onChange,
  onClose,
}: {
  open: boolean;
  anchorRect: DOMRect | null;
  fields: LandlordField[];
  selectedIds: string[];
  /** Fields claimed by another question. They render with a lock icon and
   *  cannot be selected from this picker. Already-selected fields are exempt
   *  (you can always unlink yourself). */
  lockedFieldIds?: Set<string>;
  /** Tooltip text shown on locked rows. Defaults to a generic message. */
  lockedReason?: string;
  onChange: (next: string[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  // Close on outside click + Escape
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  // Filter by search, then sort so locked (claimed-elsewhere) fields fall to
  // the bottom. Already-selected fields are exempt from locking and stay in
  // their original position so the landlord always sees their own picks at
  // the top of the list.
  const visibleFields = useMemo(() => {
    const q = query.trim().toLowerCase();
    const selected = new Set(selectedIds);
    
    // Inject missing fields as error rows so they can be deselected
    const missingIds = selectedIds.filter((id) => !fields.some((f) => f.id === id));
    const allFields = [
      ...fields,
      ...missingIds.map((id) => ({ id, label: `Missing: ${id}`, value_kind: "error" as any })),
    ];
    
    const filtered = q
      ? allFields.filter(
          (f) =>
            f.label.toLowerCase().includes(q) ||
            f.id.toLowerCase().includes(q) ||
            f.value_kind.toLowerCase().includes(q),
        )
      : allFields;
    return [...filtered].sort((a, b) => {
      const aLocked = !selected.has(a.id) && (lockedFieldIds?.has(a.id) ?? false) ? 1 : 0;
      const bLocked = !selected.has(b.id) && (lockedFieldIds?.has(b.id) ?? false) ? 1 : 0;
      return aLocked - bLocked; // unlocked (0) first, locked (1) last; stable within groups
    });
  }, [fields, query, selectedIds, lockedFieldIds]);

  // Index of the first locked row, so we can render a faint divider above it.
  const firstLockedIdx = useMemo(() => {
    const selected = new Set(selectedIds);
    return visibleFields.findIndex(
      (f) => !selected.has(f.id) && (lockedFieldIds?.has(f.id) ?? false),
    );
  }, [visibleFields, selectedIds, lockedFieldIds]);

  if (!open || !anchorRect) return null;

  const selected = new Set(selectedIds);
  const lockMsg = lockedReason ?? "Already linked to another question — unlink it there first.";
  const toggle = (id: string) => {
    const isSelected = selected.has(id);
    if (!isSelected && lockedFieldIds?.has(id)) return; // hard block — row is locked by another question
    const next = isSelected ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
    onChange(next);
  };

  // Position: open below the anchor, aligned to its left edge. Clamp to viewport.
  const top = Math.min(window.innerHeight - 360, anchorRect.bottom + 6);
  const left = Math.min(window.innerWidth - 340, Math.max(8, anchorRect.left));

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Pick linked fields"
      className="fixed z-[60] flex w-[320px] flex-col rounded-xl border border-black/10 bg-white shadow-xl"
      style={{ top, left, maxHeight: 360 }}
    >
      <div className="border-b border-black/5 p-2">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search fields..."
          className="w-full rounded-md border border-black/10 bg-[#f7f9f8] px-2 py-1.5 text-xs text-foreground placeholder:text-foreground/40 focus:border-teal-700/40 focus:bg-white focus:outline-none focus:ring-1 focus:ring-teal-700/20"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-1">
        {visibleFields.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs italic text-foreground/40">
            {fields.length === 0 ? "No fields defined yet" : "No matches"}
          </p>
        ) : (
          <div className="flex flex-col">
            {visibleFields.map((f, i) => {
              const isSelected = selected.has(f.id);
              const isLocked = !isSelected && (lockedFieldIds?.has(f.id) ?? false);
              const showLockedHeader = i === firstLockedIdx && firstLockedIdx > 0;
              return (
                <div key={f.id} className="contents">
                  {showLockedHeader && (
                    <div className="mt-1 flex items-center gap-2 px-2 pb-1 pt-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground/40">
                        Used by other questions
                      </span>
                      <span className="h-px flex-1 bg-black/5" />
                    </div>
                  )}
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => toggle(f.id)}
                  title={isLocked ? lockMsg : f.id}
                  className={`group flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                    isSelected
                      ? "bg-teal-50"
                      : isLocked
                        ? "cursor-not-allowed opacity-60"
                        : "hover:bg-black/5"
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      isSelected
                        ? "border-teal-700 bg-teal-700 text-white"
                        : isLocked
                          ? "border-black/10 bg-foreground/5"
                          : "border-black/15 bg-white"
                    }`}
                    aria-hidden
                  >
                    {isSelected && (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M2 5l2 2 4-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span className={`flex-1 truncate text-xs ${isLocked ? "text-foreground/40" : "text-foreground"}`}>
                    {f.label || f.id}
                  </span>
                  <span
                    className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                      KIND_BADGE_COLORS[f.value_kind] ?? "bg-black/5 text-foreground/50"
                    }`}
                  >
                    {f.value_kind}
                  </span>
                  {isLocked && (
                    <span className="shrink-0 text-foreground/45" aria-label="Locked — used elsewhere">
                      <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                        <rect x="2.5" y="5" width="7" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
                        <path d="M4 5V3.5a2 2 0 014 0V5" stroke="currentColor" strokeWidth="1.2" />
                      </svg>
                    </span>
                  )}
                </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-black/5 px-3 py-2 text-[11px] text-foreground/45">
        <span>{selectedIds.length} selected</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-0.5 text-foreground/55 transition-colors hover:bg-black/5"
        >
          Done
        </button>
      </div>
    </div>
  );
}
