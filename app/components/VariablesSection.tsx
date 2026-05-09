"use client";

import { useEffect, useRef, useState } from "react";
import type { PropertyVariable } from "@/lib/property";
import { FIELD_VALUE_KINDS, type FieldValueKind } from "@/lib/landlord-field";

const KIND_LABELS: Record<FieldValueKind, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  boolean: "Yes/No",
  enum: "Options",
};

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

function labelToKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 40);
}

const KEY_RE = /^[a-z][a-z0-9_]*$/;

type VarRow = PropertyVariable & { _clientId: string; _isNew?: boolean };

function VariableRow({
  row,
  onChange,
  onDelete,
}: {
  row: VarRow;
  onChange: (updated: VarRow) => void;
  onDelete: () => void;
}) {
  const isLocked = !row._isNew;
  const keyError = row.key && !KEY_RE.test(row.key)
    ? "snake_case only: letters, numbers, underscores; start with a letter"
    : null;

  function handleLabelChange(label: string) {
    const updated: VarRow = { ...row, label };
    if (!isLocked && (!row.key || row.key === labelToKey(row.label))) {
      updated.key = labelToKey(label);
    }
    onChange(updated);
  }

  const inputCls = "rounded-lg border border-foreground/10 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-foreground/35 focus:border-foreground/25 focus:outline-none focus:ring-1 focus:ring-foreground/15";

  return (
    <div className="flex items-start gap-3 rounded-xl border border-foreground/10 bg-background p-3 shadow-sm">
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Label */}
          <input
            type="text"
            value={row.label}
            onChange={(e) => handleLabelChange(e.target.value)}
            placeholder="Label (e.g. Move-in date)"
            className={`min-w-0 flex-1 ${inputCls}`}
          />
          {/* Key */}
          <input
            type="text"
            value={row.key}
            readOnly={isLocked}
            onChange={(e) => { if (!isLocked) onChange({ ...row, key: e.target.value }); }}
            placeholder="key_name"
            title={isLocked ? "Key cannot be changed once created — it may be used in question text" : ""}
            className={`w-40 rounded-md border px-2 py-1 font-mono text-xs focus:outline-none ${
              isLocked
                ? "cursor-not-allowed border-transparent bg-foreground/5 text-foreground/40"
                : "border-foreground/8 bg-foreground/[0.02] text-foreground/60 placeholder:text-foreground/25 focus:border-foreground/20"
            }`}
          />
          {/* Type */}
          <select
            value={row.value_kind ?? "text"}
            onChange={(e) => onChange({ ...row, value_kind: e.target.value as FieldValueKind })}
            className="rounded-md border border-foreground/8 bg-foreground/[0.02] px-2 py-1 text-xs text-foreground/60 focus:border-foreground/20 focus:outline-none"
          >
            {FIELD_VALUE_KINDS.map((k) => (
              <option key={k} value={k}>{KIND_LABELS[k]}</option>
            ))}
          </select>
        </div>
        {keyError && <p className="text-xs text-red-500">{keyError}</p>}
        {/* Value — input type enforced by value_kind */}
        {(row.value_kind ?? "text") === "boolean" ? (
          <select
            value={row.value || "true"}
            onChange={(e) => onChange({ ...row, value: e.target.value })}
            className={`w-full ${inputCls}`}
          >
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        ) : (
          <input
            type={
              (row.value_kind ?? "text") === "number" ? "number" :
              (row.value_kind ?? "text") === "date"   ? "date"   : "text"
            }
            value={row.value}
            onChange={(e) => onChange({ ...row, value: e.target.value })}
            placeholder={
              (row.value_kind ?? "text") === "number" ? "e.g. 2500" :
              (row.value_kind ?? "text") === "date"   ? "" :
              "e.g. June 1, 2025"
            }
            className={`w-full ${inputCls}`}
          />
        )}
        <p className="text-[10px] text-foreground/35">
          Inserts as <span className="font-mono text-violet-600">{`{{${row.key || "key_name"}}}`}</span> in question text
        </p>
      </div>
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete variable"
        className="mt-1 shrink-0 rounded-lg p-1.5 text-foreground/25 transition-colors hover:bg-red-50 hover:text-red-500"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

function fingerprint(vars: PropertyVariable[]) {
  return vars.map((v) => v.id).join("\0") + "\0" + vars.length;
}

export default function VariablesSection({
  variables,
  onChange,
}: {
  variables: PropertyVariable[];
  onChange: (vars: PropertyVariable[]) => void;
}) {
  const [rows, setRows] = useState<VarRow[]>(() =>
    variables.map((v) => ({ ...v, _clientId: generateId() }))
  );
  const sigRef = useRef(fingerprint(variables));

  useEffect(() => {
    const sig = fingerprint(variables);
    if (sig !== sigRef.current) {
      sigRef.current = sig;
      setRows(variables.map((v) => ({ ...v, _clientId: generateId() })));
    }
  }, [variables]);

  function update(next: VarRow[]) {
    setRows(next);
    const plain: PropertyVariable[] = next.map(({ _clientId: _, _isNew: __, ...v }) => v);
    sigRef.current = fingerprint(plain);
    onChange(plain);
  }

  function handleAdd() {
    update([...rows, { _clientId: generateId(), _isNew: true, id: generateId(), key: "", label: "", value: "", value_kind: "text" }]);
  }

  return (
    <section className="flex flex-col gap-3">
      {rows.length > 0 ? (
        <div className="flex flex-col gap-3">
          {rows.map((row, i) => (
            <VariableRow
              key={row._clientId}
              row={row}
              onChange={(updated) => {
                const next = [...rows];
                next[i] = updated;
                update(next);
              }}
              onDelete={() => update(rows.filter((_, j) => j !== i))}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-foreground/35">
          No variables yet. Add one to reference it in question text like{" "}
          <span className="font-mono text-violet-600">{"{{move_in_date}}"}</span>.
        </p>
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
