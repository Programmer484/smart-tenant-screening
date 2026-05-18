"use client";

import { FIELD_VALUE_KINDS, type FieldValueKind } from "@/lib/landlord-field";

export const KIND_LABELS: Record<FieldValueKind, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  boolean: "Yes/No",
  enum: "Options",
};

export const textInputCls =
  "rounded-lg border border-foreground/10 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-foreground/35 focus:border-foreground/25 focus:outline-none focus:ring-1 focus:ring-foreground/15";

export function ValueKindSelect({
  value,
  onChange,
  exclude,
  disabled,
}: {
  value: FieldValueKind;
  onChange: (kind: FieldValueKind) => void;
  exclude?: FieldValueKind[];
  disabled?: boolean;
}) {
  const kinds = exclude ? FIELD_VALUE_KINDS.filter((k) => !exclude.includes(k)) : FIELD_VALUE_KINDS;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as FieldValueKind)}
      disabled={disabled}
      className={`rounded-md border px-2 py-1 text-xs focus:outline-none ${
        disabled
          ? "cursor-not-allowed border-transparent bg-foreground/5 text-foreground/40"
          : "border-foreground/8 bg-foreground/[0.02] text-foreground/60 focus:border-foreground/20"
      }`}
    >
      {kinds.map((k) => (
        <option key={k} value={k}>
          {KIND_LABELS[k]}
        </option>
      ))}
    </select>
  );
}

export function MonoKeyInput({
  value,
  locked,
  placeholder,
  lockedTitle,
  onChange,
  onFocus,
  onBlur,
}: {
  value: string;
  locked: boolean;
  placeholder: string;
  lockedTitle: string;
  onChange?: (val: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  return (
    <input
      type="text"
      value={value}
      readOnly={locked}
      onChange={(e) => { if (!locked) onChange?.(e.target.value); }}
      onFocus={onFocus}
      onBlur={onBlur}
      placeholder={placeholder}
      title={locked ? lockedTitle : ""}
      className={`w-40 rounded-md border px-2 py-1 font-mono text-xs focus:outline-none ${
        locked
          ? "cursor-not-allowed border-transparent bg-foreground/5 text-foreground/40"
          : "border-foreground/8 bg-foreground/[0.02] text-foreground/60 placeholder:text-foreground/25 focus:border-foreground/20"
      }`}
    />
  );
}

export function InlineDeleteButton({
  onClick,
  ariaLabel = "Delete",
}: {
  onClick: () => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="mt-1 shrink-0 rounded-lg p-1.5 text-foreground/25 transition-colors hover:bg-red-50 hover:text-red-500"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}

export function LockBadge({ title = "This field is required and cannot be removed" }: { title?: string }) {
  return (
    <div
      title={title}
      aria-label={title}
      className="mt-1 shrink-0 rounded-lg p-1.5 text-foreground/20"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect x="2" y="8" width="12" height="7" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5 8V5.5a3 3 0 016 0V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}
