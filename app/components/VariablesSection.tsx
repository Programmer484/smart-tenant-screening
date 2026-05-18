"use client";

import { useEffect, useRef, useState } from "react";
import type { PropertyVariable } from "@/lib/property";
import { ConfirmDialog } from "@/app/components/ConfirmDialog";
import { generateId, labelToId } from "@/lib/id-utils";
import {
  ValueKindSelect,
  MonoKeyInput,
  InlineDeleteButton,
  textInputCls,
} from "@/app/components/field-primitives";

const KEY_RE = /^[a-z][a-z0-9_]*$/;

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

  const keyError = row.key && !KEY_RE.test(row.key)
    ? "snake_case only: letters, numbers, underscores; start with a letter"
    : null;
  const duplicateLabelError = row.label.trim() &&
    siblings.filter(s => s.label.trim().toLowerCase() === row.label.trim().toLowerCase()).length > 1
    ? "Variable name must be unique" : null;
  const duplicateKeyError = row.key.trim() &&
    siblings.filter(s => s.key.trim() === row.key.trim()).length > 1
    ? "Key must be unique" : null;

  const labelBeforeEdit = useRef(row.label);
  const keyBeforeEdit = useRef(row.key);

  function handleLabelChange(label: string) {
    const autoId = labelToId(row.label);
    const updated: VarRow = { ...row, label };
    if (!isLocked) {
      if (!row.key || row.key === autoId) updated.key = labelToId(label);
      if (!row.id  || row.id  === autoId) updated.id  = labelToId(label);
    }
    onChange(updated);
  }

  function handleLabelBlur() {
    if (duplicateLabelError) {
      const reverted: VarRow = { ...row, label: labelBeforeEdit.current };
      if (!isLocked && (!row.key || row.key === labelToId(row.label))) {
        reverted.key = labelToId(labelBeforeEdit.current);
      }
      onChange(reverted);
    } else {
      labelBeforeEdit.current = row.label;
    }
  }

  function handleKeyBlur() {
    if (duplicateKeyError) {
      onChange({ ...row, key: keyBeforeEdit.current });
    } else {
      keyBeforeEdit.current = row.key;
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
            onBlur={handleLabelBlur}
            placeholder="Label (e.g. Move-in date)"
            className={`min-w-0 flex-1 ${textInputCls}`}
          />
          <MonoKeyInput
            value={row.key}
            locked={isLocked}
            placeholder="key_name"
            lockedTitle="Key cannot be changed once created — it may be used in question text"
            onChange={(val) => onChange({ ...row, key: val })}
            onFocus={() => { keyBeforeEdit.current = row.key; }}
            onBlur={handleKeyBlur}
          />
          <ValueKindSelect
            value={row.value_kind ?? "text"}
            onChange={(k) => onChange({ ...row, value_kind: k })}
            exclude={["enum"]}
          />
        </div>
        {duplicateLabelError && <p className="text-xs text-red-500">{duplicateLabelError}</p>}
        {keyError && <p className="text-xs text-red-500">{keyError}</p>}
        {duplicateKeyError && <p className="text-xs text-red-500">{duplicateKeyError}</p>}
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
          Inserts as <span className="font-mono text-violet-600">{`{{${row.key || "key_name"}}}`}</span> in question text
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
}: {
  variables: PropertyVariable[];
  onChange: (vars: PropertyVariable[]) => void;
  questionTexts?: string[];
}) {
  const [rows, setRows] = useState<VarRow[]>(() =>
    variables.map((v) => ({ ...v, _clientId: generateId() }))
  );
  const sigRef = useRef(fingerprint(variables));
  const [pendingDeleteIdx, setPendingDeleteIdx] = useState<number | null>(null);

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
    update([...rows, { _clientId: generateId(), _isNew: true, id: "", key: "", label: "", value: "", value_kind: "text" }]);
  }

  function requestDelete(i: number) {
    const row = rows[i];
    const token = `{{${row.key}}}`;
    const referenced = row.key && questionTexts.some((t) => t.includes(token));
    if (referenced) {
      setPendingDeleteIdx(i);
    } else {
      update(rows.filter((_, j) => j !== i));
    }
  }

  const pendingRow = pendingDeleteIdx !== null ? rows[pendingDeleteIdx] : null;

  return (
    <section className="flex flex-col gap-3">
      {pendingRow && (
        <ConfirmDialog
          open={pendingDeleteIdx !== null}
          title={`Delete "{{${pendingRow.key}}}"?`}
          description={`This variable is referenced in one or more questions. Deleting it will leave {{${pendingRow.key}}} as plain text in those questions.`}
          confirmLabel="Delete anyway"
          destructive
          onConfirm={() => {
            update(rows.filter((_, j) => j !== pendingDeleteIdx));
            setPendingDeleteIdx(null);
          }}
          onCancel={() => setPendingDeleteIdx(null)}
        />
      )}
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
