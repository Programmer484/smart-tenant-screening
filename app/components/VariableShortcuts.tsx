"use client";

import React from "react";
import type { PropertyVariable } from "@/lib/property";

export function VariableShortcuts({
  variables,
  onInsert,
}: {
  variables: PropertyVariable[];
  onInsert: (varId: string) => void;
}) {
  if (!variables || variables.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 items-center mt-1.5">
      <span className="text-[10px] text-foreground/40 uppercase tracking-wider font-semibold mr-1">Insert:</span>
      {variables.map((v) => (
        <button
          key={v.id}
          type="button"
          onClick={() => onInsert(v.id)}
          className="rounded border border-teal-700/20 bg-teal-50 px-1.5 py-0.5 text-[10px] font-mono text-teal-800 transition-colors hover:bg-teal-100 hover:border-teal-700/30"
          title={`Insert {{${v.id}}}`}
        >
          {v.id}
        </button>
      ))}
    </div>
  );
}

export function insertAtCursor(
  text: string,
  varId: string,
  ref: React.RefObject<HTMLTextAreaElement | null>,
  onChange: (newText: string) => void
) {
  const insertStr = `{{${varId}}}`;
  if (!ref.current) {
    onChange(text + insertStr);
    return;
  }
  const el = ref.current;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const before = text.substring(0, start);
  const after = text.substring(end);
  onChange(before + insertStr + after);
  
  // Need to restore cursor position after render
  setTimeout(() => {
    if (el) {
      el.selectionStart = el.selectionEnd = start + insertStr.length;
      el.focus();
    }
  }, 0);
}
