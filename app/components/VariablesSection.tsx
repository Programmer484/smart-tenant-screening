"use client";

import React, { useState } from "react";
import type { PropertyVariable } from "@/lib/property";
import { generateId } from "./RuleBuilder";

function emptyVariable(): PropertyVariable & { _key: string } {
  return {
    _key: generateId(),
    id: "",
    value: "",
  };
}

type VariableWithKey = PropertyVariable & { _key: string };

function VariableRow({
  variable,
  onChange,
  onDelete,
}: {
  variable: VariableWithKey;
  onChange: (updated: VariableWithKey) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex gap-3 rounded-xl border border-foreground/10 bg-background p-3 shadow-sm items-center">
      <div className="flex flex-1 gap-4">
        <div className="flex-1">
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-foreground/40 font-semibold">
            Variable Name (used as {'{{name}}'})
          </label>
          <input
            type="text"
            value={variable.id}
            onChange={(e) => onChange({ ...variable, id: e.target.value.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase() })}
            placeholder="e.g. date_available"
            className="w-full rounded-lg border border-foreground/10 bg-transparent px-3 py-2 text-sm font-mono text-foreground placeholder:text-foreground/35 focus:border-foreground/25 focus:outline-none focus:ring-1 focus:ring-foreground/15"
          />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-foreground/40 font-semibold">
            Value
          </label>
          <input
            type="text"
            value={variable.value}
            onChange={(e) => onChange({ ...variable, value: e.target.value })}
            placeholder="e.g. June 1st, 2026"
            className="w-full rounded-lg border border-foreground/10 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-foreground/35 focus:border-foreground/25 focus:outline-none focus:ring-1 focus:ring-foreground/15"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete variable"
        className="shrink-0 rounded-lg p-1.5 text-foreground/25 transition-colors hover:bg-red-50 hover:text-red-500 mt-5"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export default function VariablesSection({
  variables,
  onChange,
}: {
  variables: PropertyVariable[];
  onChange: (variables: PropertyVariable[]) => void;
}) {
  function fingerprint(v: PropertyVariable[]) {
    return v.map((x) => `${x.id}:${x.value}`).join("\0") + "\0" + v.length;
  }

  const [rows, setRows] = useState<VariableWithKey[]>(() =>
    variables.map((v) => ({ ...v, _key: generateId() }))
  );
  const [prevSig, setPrevSig] = useState<string>(() => fingerprint(variables));

  const nextSig = fingerprint(variables);
  if (nextSig !== prevSig) {
    setPrevSig(nextSig);
    setRows(variables.map((v) => ({ ...v, _key: generateId() })));
  }

  function update(next: VariableWithKey[]) {
    setRows(next);
    const plain = next.map(({ _key: _, ...v }) => v);
    setPrevSig(fingerprint(plain));
    onChange(plain);
  }

  function handleChange(index: number, updated: VariableWithKey) {
    const next = [...rows];
    next[index] = updated;
    update(next);
  }

  function handleDelete(index: number) {
    update(rows.filter((_, i) => i !== index));
  }

  function handleAdd() {
    update([...rows, emptyVariable()]);
  }

  return (
    <section className="flex flex-col gap-3">
      {rows.length > 0 && (
        <div className="flex flex-col gap-3">
          {rows.map((variable, i) => (
            <VariableRow
              key={variable._key}
              variable={variable}
              onChange={(updated) => handleChange(i, updated)}
              onDelete={() => handleDelete(i)}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={handleAdd}
        className="self-start rounded-lg border border-dashed border-foreground/20 px-4 py-2 text-sm text-foreground/50 transition-colors hover:border-foreground/40 hover:text-foreground/70"
      >
        + Add variable
      </button>
    </section>
  );
}
