"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PropertyVariable } from "@/lib/property";

export function VariablePickerPopover({
  open,
  anchorRect,
  variables,
  onInsert,
  onClose,
}: {
  open: boolean;
  anchorRect: DOMRect | null;
  variables: PropertyVariable[];
  onInsert: (token: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) { setQuery(""); return; }
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

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

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return variables;
    return variables.filter(
      (v) =>
        v.label.toLowerCase().includes(q) ||
        v.id.toLowerCase().includes(q) ||
        v.value.toLowerCase().includes(q),
    );
  }, [variables, query]);

  if (!open || !anchorRect) return null;

  const top = Math.min(window.innerHeight - 320, anchorRect.bottom + 6);
  const left = Math.min(window.innerWidth - 300, Math.max(8, anchorRect.left));

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Insert variable"
      className="fixed z-[60] flex w-[280px] flex-col rounded-xl border border-black/10 bg-white shadow-xl"
      style={{ top, left, maxHeight: 320 }}
    >
      <div className="border-b border-black/5 p-2">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search variables..."
          className="w-full rounded-md border border-black/10 bg-[#f7f9f8] px-2 py-1.5 text-xs text-foreground placeholder:text-foreground/40 focus:border-teal-700/40 focus:bg-white focus:outline-none focus:ring-1 focus:ring-teal-700/20"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-1">
        {variables.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs italic text-foreground/40">
            No variables defined — add them in the Variables tab
          </p>
        ) : visible.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs italic text-foreground/40">No matches</p>
        ) : (
          visible.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => { onInsert(`{{${v.id}}}`); onClose(); }}
              className="flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left transition-colors hover:bg-black/5"
            >
              <span className="font-mono text-[11px] font-semibold text-indigo-700">{`{{${v.id}}}`}</span>
              <div className="flex w-full items-center justify-between gap-2">
                <span className="text-xs text-foreground/55">{v.label}</span>
                {v.value && (
                  <span className="max-w-[100px] truncate font-mono text-[10px] text-foreground/35">{v.value}</span>
                )}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
