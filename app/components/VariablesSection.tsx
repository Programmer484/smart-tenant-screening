"use client";

import { useEffect, useRef, useState } from "react";
import type { PropertyVariable } from "@/lib/property";
import { generateId, labelToId } from "@/lib/id-utils";
import {
  ValueKindSelect,
  InlineDeleteButton,
  textInputCls,
} from "@/app/components/field-primitives";

type VarRow = PropertyVariable & { _clientId: string; _isNew?: boolean };

function VariableRow({
  row,
  siblings,
  onChange,
  onDelete,
}: {
  row: VarRow;
  siblings: VarRow[];
  onChange: (updated: VarRow) => void;
  onDelete: () => void;
}) {
  const isLocked = !row._isNew;

  const [touched, setTouched] = useState(false);
  const emptyLabelError = touched && !row.label.trim() ? "Label is required" : null;
  const duplicateLabelError = row.label.trim() &&
    siblings.filter(s => s.label.trim().toLowerCase() === row.label.trim().toLowerCase()).length > 1
    ? "Variable name must be unique" : null;

  const labelBeforeEdit = useRef(row.label);

  function handleLabelChange(label: string) {
    const updated: VarRow = { ...row, label };
    if (!isLocked && (!row.id || row.id === labelToId(row.label))) {
      updated.id = labelToId(label);
    }
    onChange(updated);
  }

  function handleLabelBlur() {
    if (duplicateLabelError || emptyLabelError) {
      if (!labelBeforeEdit.current.trim()) {
        onDelete();
        return;
      }
      const reverted: VarRow = { ...row, label: labelBeforeEdit.current };
      if (!isLocked && (!row.id || row.id === labelToId(row.label))) {
        reverted.id = labelToId(labelBeforeEdit.current);
      }
      onChange(reverted);
    } else {
      labelBeforeEdit.current = row.label;
    }
  }

  return (
    <div className="flex items-start gap-3 rounded-xl border border-foreground/10 bg-background p-3 shadow-sm">
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={row.label}
            onChange={(e) => handleLabelChange(e.target.value)}
            onFocus={() => { labelBeforeEdit.current = row.label; }}
            onBlur={() => { setTouched(true); handleLabelBlur(); }}
            placeholder="Label (e.g. Move-in date)"
            className={`min-w-0 flex-1 ${textInputCls} ${emptyLabelError ? "border-red-400 focus:border-red-400 focus:ring-red-400/20" : ""}`}
          />
          <ValueKindSelect
            value={row.value_kind ?? "text"}
            onChange={(k) => onChange({ ...row, value_kind: k })}
            exclude={["enum"]}
          />
        </div>
        {emptyLabelError && <p className="text-xs text-red-500">{emptyLabelError}</p>}
        {duplicateLabelError && <p className="text-xs text-red-500">{duplicateLabelError}</p>}
        {(row.value_kind ?? "text") === "boolean" ? (
          <select
            value={row.value || "true"}
            onChange={(e) => onChange({ ...row, value: e.target.value })}
            className={`w-full ${textInputCls}`}
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
            className={`w-full ${textInputCls}`}
          />
        )}
        <p className="text-[10px] text-foreground/35">
          Appears as{" "}
          <span className="inline-flex items-center rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 leading-none">
            {row.label || "—"}
          </span>{" "}
          in question text
        </p>
      </div>
      <InlineDeleteButton onClick={onDelete} ariaLabel="Delete variable" />
    </div>
  );
}

function fingerprint(vars: PropertyVariable[]) {
  return vars.map((v) => v.id).join("\0") + "\0" + vars.length;
}

export default function VariablesSection({
  variables,
  onChange,
  questionTexts = [],
  onBeforeDelete,
}: {
  variables: PropertyVariable[];
  onChange: (vars: PropertyVariable[]) => void;
  questionTexts?: string[];
  onBeforeDelete?: (index: number) => boolean;
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
    update([...rows, { _clientId: generateId(), _isNew: true, id: "", label: "", value: "", value_kind: "text" }]);
  }

  function requestDelete(i: number) {
    if (onBeforeDelete) {
      const shouldProceed = onBeforeDelete(i);
      if (!shouldProceed) return;
    }
    update(rows.filter((_, j) => j !== i));
  }

  return (
    <section className="flex flex-col gap-3">
      {rows.length > 0 ? (
        <div className="flex flex-col gap-3">
          {rows.map((row, i) => (
            <VariableRow
              key={row._clientId}
              row={row}
              siblings={rows}
              onChange={(updated) => {
                const next = [...rows];
                next[i] = updated;
                update(next);
              }}
              onDelete={() => requestDelete(i)}
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
