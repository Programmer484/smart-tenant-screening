"use client";

import React, { useState, useId, useMemo } from "react";
import {
  FIELD_VALUE_KINDS,
  FieldValueKind,
  LandlordField,
  validateLandlordFieldId,
  validateLandlordFieldLabel,
  validateEnumOptions,
} from "@/lib/landlord-field";
import type { Question } from "@/lib/question";
import { generateId } from "./RuleBuilder";

const KIND_LABELS: Record<FieldValueKind, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  boolean: "Yes/No",
  enum: "Options",
};

function labelToFieldId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 40);
}

function emptyField(): LandlordField & { _key: string; _isNew?: boolean } {
  return {
    _key: generateId(),
    id: "",
    label: "",
    value_kind: "text",
    _isNew: true,
  };
}

type FieldWithKey = LandlordField & { _key: string; _isNew?: boolean };

/** Build `fieldId -> ["Q1", "Q1.2"]` so each field row can show where it's
 *  collected. Labels match the hierarchical ids used on the Questions tab. */
function buildQuestionPathLabels(questions: Question[]): Map<string, string[]> {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const children = new Map<string, Question[]>();
  const roots: Question[] = [];
  for (const q of questions) {
    const pid = q.parentQuestionId;
    if (pid && pid !== q.id && byId.has(pid)) {
      const arr = children.get(pid) ?? [];
      arr.push(q);
      children.set(pid, arr);
    } else {
      roots.push(q);
    }
  }
  const result = new Map<string, string[]>();
  const assign = (q: Question, label: string) => {
    for (const fid of q.fieldIds) {
      const list = result.get(fid) ?? [];
      list.push(label);
      result.set(fid, list);
    }
    const kids = children.get(q.id) ?? [];
    kids.forEach((c, i) => assign(c, `${label}.${i + 1}`));
  };
  roots.forEach((r, i) => assign(r, `Q${i + 1}`));
  return result;
}

function FieldRow({
  field,
  index,
  total,
  usage,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  action,
}: {
  field: FieldWithKey;
  index: number;
  total: number;
  /** Hierarchical labels (e.g. "Q1.2") of questions that collect this field. */
  usage: string[];
  onChange: (updated: FieldWithKey) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  action?: React.ReactNode;
}) {
  const uid = useId();
  const idError = field.id ? validateLandlordFieldId(field.id) : null;
  const labelError = field.label ? validateLandlordFieldLabel(field.label) : null;
  const enumOptionsError =
    field.value_kind === "enum"
      ? validateEnumOptions(field.options)
      : null;

  const isLocked = !field._isNew;

  function handleLabelChange(newLabel: string) {
    const prevAutoId = labelToFieldId(field.label);
    const updated: FieldWithKey = { ...field, label: newLabel };
    if (!isLocked && (!field.id || field.id === prevAutoId)) {
      updated.id = labelToFieldId(newLabel);
    }
    onChange(updated);
  }

  return (
    <div className="flex gap-3 rounded-xl border border-foreground/10 bg-background p-3 shadow-sm">
      {/* Reorder controls */}
      <div className="flex flex-col items-center gap-0.5 pt-1 text-foreground/30">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={index === 0}
          aria-label="Move up"
          className="rounded p-0.5 transition-colors hover:text-foreground/70 disabled:opacity-20 disabled:cursor-not-allowed"
        >
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
        <button
          type="button"
          onClick={onMoveDown}
          disabled={index === total - 1}
          aria-label="Move down"
          className="rounded p-0.5 transition-colors hover:text-foreground/70 disabled:opacity-20 disabled:cursor-not-allowed"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Field content */}
      <div className="flex flex-1 flex-col gap-2">
        {/* Label */}
        <div>
          <input
            id={`${uid}-label`}
            type="text"
            value={field.label}
            onChange={(e) => handleLabelChange(e.target.value)}
            placeholder="Question or label for this field…"
            className="w-full rounded-lg border border-foreground/10 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-foreground/35 focus:border-foreground/25 focus:outline-none focus:ring-1 focus:ring-foreground/15"
          />
          {labelError && (
            <p className="mt-1 text-xs text-red-500">{labelError}</p>
          )}
        </div>

        {/* Compact meta row: ID · Type · Action */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            id={`${uid}-id`}
            type="text"
            value={field.id}
            readOnly={isLocked}
            onChange={(e) => {
              if (!isLocked) onChange({ ...field, id: e.target.value });
            }}
            placeholder="field_id"
            title={isLocked ? "Field ID cannot be changed once created" : ""}
            className={`w-40 rounded-md border px-2 py-1 font-mono text-xs focus:outline-none ${
              isLocked
                ? "bg-foreground/5 border-transparent text-foreground/40 cursor-not-allowed"
                : "bg-foreground/[0.02] border-foreground/8 text-foreground/60 placeholder:text-foreground/25 focus:border-foreground/20"
            }`}
          />
          <select
            id={`${uid}-kind`}
            value={field.value_kind}
            onChange={(e) => {
              const k = e.target.value as FieldValueKind;
              const next: FieldWithKey = { ...field, value_kind: k };
              if (k === "enum") {
                next.options =
                  field.options?.length ? [...field.options] : ["", ""];
              } else {
                delete next.options;
              }
              onChange(next);
            }}
            className="rounded-md border border-foreground/8 bg-foreground/[0.02] px-2 py-1 text-xs text-foreground/60 focus:border-foreground/20 focus:outline-none"
          >
            {FIELD_VALUE_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>

          {action && <div className="ml-auto">{action}</div>}
        </div>

        {field.id && (
          <p
            className="text-[11px] text-foreground/40"
            title={usage.length > 0 ? "Questions that collect this field" : "No question collects this field yet"}
          >
            {usage.length > 0
              ? <>Collected in: <span className="font-medium text-foreground/60">{usage.join(", ")}</span></>
              : <span className="italic">Not used in any question yet</span>}
          </p>
        )}

        {idError && (
          <p className="text-xs text-red-500">{idError}</p>
        )}

        {field.value_kind === "enum" ? (
          <div className="flex flex-col gap-2 pt-1">
            <span className="text-xs text-foreground/50">
              Answer choices (at least two)
            </span>
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
                    className="min-w-0 flex-1 rounded-lg border border-foreground/10 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-foreground/35 focus:border-foreground/25 focus:outline-none focus:ring-1 focus:ring-foreground/15"
                  />
                  <button
                    type="button"
                    disabled={(field.options ?? []).length <= 1}
                    onClick={() => {
                      const opts = (field.options ?? []).filter(
                        (_, j) => j !== optIdx,
                      );
                      onChange({
                        ...field,
                        options: opts.length ? opts : [""],
                      });
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
              onClick={() =>
                onChange({
                  ...field,
                  options: [...(field.options ?? []), ""],
                })
              }
              className="self-start text-xs text-foreground/50 underline-offset-2 hover:text-foreground/75 hover:underline"
            >
              + Add choice
            </button>
            {enumOptionsError ? (
              <p className="text-xs text-red-500">{enumOptionsError}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Delete */}
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete field"
        className="mt-1 shrink-0 rounded-lg p-1.5 text-foreground/25 transition-colors hover:bg-red-50 hover:text-red-500"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export default function LandlordFieldsSection({
  fields,
  questions,
  onChange,
  fieldAction,
  onBeforeDelete,
}: {
  fields: LandlordField[];
  /** Used to annotate each field with the questions that collect it. Optional —
   *  when omitted we simply skip the usage chip. */
  questions?: Question[];
  onChange: (fields: LandlordField[]) => void;
  fieldAction?: (field: LandlordField) => React.ReactNode;
  /** Return false to cancel delete (e.g. parent will update `fields` after async confirm). */
  onBeforeDelete?: (field: LandlordField, index: number) => boolean;
}) {
  function fingerprint(f: LandlordField[]) {
    return f.map((x) => x.id).join("\0") + "\0" + f.length;
  }

  const usageByFieldId = useMemo(
    () => buildQuestionPathLabels(questions ?? []),
    [questions],
  );

  const [rows, setRows] = useState<FieldWithKey[]>(() =>
    fields.map((f) => ({ ...f, _key: generateId() }))
  );
  const [prevSig, setPrevSig] = useState<string>(() => fingerprint(fields));

  // Sync external `fields` prop → internal rows when they diverge.
  // Updating state during render is React's recommended pattern for syncing
  // derived state from props; it avoids the cascade from doing it in useEffect.
  const nextSig = fingerprint(fields);
  if (nextSig !== prevSig) {
    setPrevSig(nextSig);
    setRows(fields.map((f) => ({ ...f, _key: generateId() })));
  }

  function update(next: FieldWithKey[]) {
    setRows(next);
    const plain = next.map(({ _key: _, ...f }) => f);
    setPrevSig(fingerprint(plain));
    onChange(plain);
  }

  function handleChange(index: number, updated: FieldWithKey) {
    const next = [...rows];
    next[index] = updated;
    update(next);
  }

  function handleDelete(index: number) {
    const field = rows[index];
    if (field && onBeforeDelete && !onBeforeDelete(field, index)) return;
    update(rows.filter((_, i) => i !== index));
  }

  function handleMoveUp(index: number) {
    if (index === 0) return;
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

  function handleAdd() {
    update([...rows, emptyField()]);
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
              usage={field.id ? (usageByFieldId.get(field.id) ?? []) : []}
              onChange={(updated) => handleChange(i, updated)}
              onDelete={() => handleDelete(i)}
              onMoveUp={() => handleMoveUp(i)}
              onMoveDown={() => handleMoveDown(i)}
              action={fieldAction && field.id ? fieldAction(field) : undefined}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={handleAdd}
        className="self-start rounded-lg border border-dashed border-foreground/20 px-4 py-2 text-sm text-foreground/50 transition-colors hover:border-foreground/40 hover:text-foreground/70"
      >
        + Add field
      </button>
    </section>
  );
}
