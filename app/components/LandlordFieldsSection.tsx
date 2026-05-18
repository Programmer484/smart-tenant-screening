"use client";

import React, { useState, useEffect, useRef, useId } from "react";
import {
  FieldValueKind,
  LandlordField,
  validateLandlordFieldId,
  validateLandlordFieldLabel,
  validateEnumOptions,
} from "@/lib/landlord-field";
import { generateId } from "@/lib/id-utils";
import {
  ValueKindSelect,
  InlineDeleteButton,
  LockBadge,
  textInputCls,
} from "@/app/components/field-primitives";

type FieldWithKey = LandlordField & { _key: string };

function emptyField(): FieldWithKey {
  return { _key: generateId(), id: generateId(), label: "", value_kind: "text" };
}

function FieldRow({
  field,
  index,
  total,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  action,
  siblings,
}: {
  field: FieldWithKey;
  index: number;
  total: number;
  onChange: (updated: FieldWithKey) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  action?: React.ReactNode;
  siblings: FieldWithKey[];
}) {
  const uid = useId();
  const labelError = field.label ? validateLandlordFieldLabel(field.label) : null;
  const duplicateLabelError = field.label.trim() &&
    siblings.filter(f => f.label.trim().toLowerCase() === field.label.trim().toLowerCase()).length > 1
    ? "Field name must be unique" : null;
  const enumOptionsError = field.value_kind === "enum" ? validateEnumOptions(field.options) : null;

  const labelBeforeEdit = useRef(field.label);

  function handleLabelBlur() {
    if (duplicateLabelError) {
      onChange({ ...field, label: labelBeforeEdit.current });
    } else {
      labelBeforeEdit.current = field.label;
    }
  }

  return (
    <div className="flex gap-3 rounded-xl border border-foreground/10 bg-background p-3 shadow-sm">
      {/* Reorder controls */}
      <div className="flex flex-col items-center gap-0.5 pt-1 text-foreground/30">
        {field.permanent ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="opacity-20 mt-0.5" aria-hidden>
            <rect x="1" y="5" width="10" height="2" rx="1" fill="currentColor" />
          </svg>
        ) : (
          <>
            <button type="button" onClick={onMoveUp} disabled={index === 0} aria-label="Move up"
              className="rounded p-0.5 transition-colors hover:text-foreground/70 disabled:opacity-20 disabled:cursor-not-allowed">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 8l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <svg width="10" height="14" viewBox="0 0 10 14" fill="none" className="opacity-40">
              <circle cx="3" cy="3" r="1" fill="currentColor" />
              <circle cx="7" cy="3" r="1" fill="currentColor" />
              <circle cx="3" cy="7" r="1" fill="currentColor" />
              <circle cx="7" cy="7" r="1" fill="currentColor" />
              <circle cx="3" cy="11" r="1" fill="currentColor" />
              <circle cx="7" cy="11" r="1" fill="currentColor" />
            </svg>
            <button type="button" onClick={onMoveDown} disabled={index === total - 1} aria-label="Move down"
              className="rounded p-0.5 transition-colors hover:text-foreground/70 disabled:opacity-20 disabled:cursor-not-allowed">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </>
        )}
      </div>

      {/* Field content */}
      <div className="flex flex-1 flex-col gap-2">
        <div>
          <input
            id={`${uid}-label`}
            type="text"
            value={field.label}
            onChange={(e) => onChange({ ...field, label: e.target.value })}
            onFocus={() => { labelBeforeEdit.current = field.label; }}
            onBlur={handleLabelBlur}
            placeholder="Question or label for this field…"
            className={`w-full ${textInputCls}`}
          />
          {labelError && <p className="mt-1 text-xs text-red-500">{labelError}</p>}
          {duplicateLabelError && <p className="mt-1 text-xs text-red-500">{duplicateLabelError}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ValueKindSelect
            value={field.value_kind}
            disabled={!!field.permanent}
            onChange={(k) => {
              const next: FieldWithKey = { ...field, value_kind: k };
              if (k === "enum") {
                next.options = field.options?.length ? [...field.options] : ["", ""];
              } else {
                delete next.options;
              }
              onChange(next);
            }}
          />
          {action && <div className="ml-auto">{action}</div>}
        </div>

        {field.value_kind === "enum" && (
          <div className="flex flex-col gap-2 pt-1">
            <span className="text-xs text-foreground/50">Answer choices (at least two)</span>
            <ul className="flex list-none flex-col gap-2 p-0">
              {(field.options ?? [""]).map((opt, optIdx) => (
                <li key={optIdx} className="flex gap-2">
                  <input
                    type="text"
                    value={opt}
                    onChange={(e) => {
                      const opts = [...(field.options ?? [""])];
                      opts[optIdx] = e.target.value;
                      onChange({ ...field, options: opts });
                    }}
                    placeholder={`Choice ${optIdx + 1}`}
                    className={`min-w-0 flex-1 ${textInputCls}`}
                  />
                  <button
                    type="button"
                    disabled={(field.options ?? []).length <= 1}
                    onClick={() => {
                      const opts = (field.options ?? []).filter((_, j) => j !== optIdx);
                      onChange({ ...field, options: opts.length ? opts : [""] });
                    }}
                    className="shrink-0 rounded-lg px-2 text-xs text-foreground/45 transition-colors hover:text-red-500 disabled:opacity-25"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => onChange({ ...field, options: [...(field.options ?? []), ""] })}
              className="self-start text-xs text-foreground/50 underline-offset-2 hover:text-foreground/75 hover:underline"
            >
              + Add choice
            </button>
            {enumOptionsError && <p className="text-xs text-red-500">{enumOptionsError}</p>}
          </div>
        )}
      </div>

      {field.permanent ? (
        <LockBadge />
      ) : (
        <InlineDeleteButton onClick={onDelete} ariaLabel="Delete field" />
      )}
    </div>
  );
}

export default function LandlordFieldsSection({
  fields,
  onChange,
  fieldAction,
  onBeforeDelete,
}: {
  fields: LandlordField[];
  onChange: (fields: LandlordField[]) => void;
  fieldAction?: (field: LandlordField) => React.ReactNode;
  onBeforeDelete?: (field: LandlordField, index: number) => boolean;
}) {
  function fingerprint(f: LandlordField[]) {
    return f.map((x) => x.id).join("\0") + "\0" + f.length;
  }

  const [rows, setRows] = useState<FieldWithKey[]>(() =>
    fields.map((f) => ({ ...f, _key: generateId() }))
  );
  const sigRef = useRef(fingerprint(fields));

  useEffect(() => {
    const sig = fingerprint(fields);
    if (sig !== sigRef.current) {
      sigRef.current = sig;
      setRows(fields.map((f) => ({ ...f, _key: generateId() })));
    }
  }, [fields]);

  function update(next: FieldWithKey[]) {
    setRows(next);
    const plain = next.map(({ _key: _, ...f }) => f);
    sigRef.current = fingerprint(plain);
    onChange(plain);
  }

  function handleChange(index: number, updated: FieldWithKey) {
    const next = [...rows];
    next[index] = updated;
    update(next);
  }

  function handleDelete(index: number) {
    const field = rows[index];
    if (field?.permanent) return;
    if (field && onBeforeDelete && !onBeforeDelete(field, index)) return;
    update(rows.filter((_, i) => i !== index));
  }

  function handleMoveUp(index: number) {
    if (index === 0) return;
    if (rows[index - 1]?.permanent) return;
    const next = [...rows];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    update(next);
  }

  function handleMoveDown(index: number) {
    if (index === rows.length - 1) return;
    const next = [...rows];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    update(next);
  }

  return (
    <section className="flex flex-col gap-3">
      {rows.length > 0 && (
        <div className="flex flex-col gap-3">
          {rows.map((field, i) => (
            <FieldRow
              key={field._key}
              field={field}
              index={i}
              total={rows.length}
              onChange={(updated) => handleChange(i, updated)}
              onDelete={() => handleDelete(i)}
              onMoveUp={() => handleMoveUp(i)}
              onMoveDown={() => handleMoveDown(i)}
              action={fieldAction && field.id ? fieldAction(field) : undefined}
              siblings={rows}
            />
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => update([...rows, emptyField()])}
        className="self-start rounded-lg border border-dashed border-foreground/20 px-4 py-2 text-sm text-foreground/50 transition-colors hover:border-foreground/40 hover:text-foreground/70"
      >
        + Add field
      </button>
    </section>
  );
}
