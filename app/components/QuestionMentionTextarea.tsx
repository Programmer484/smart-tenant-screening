"use client";

import { useRef, useState, useCallback } from "react";
import TextareaAutosize from "react-textarea-autosize";
import type { Question } from "@/lib/question";

type MentionState = { query: string; atIndex: number } | null;

function detectMention(text: string, cursor: number): MentionState {
  const before = text.slice(0, cursor);
  const atIdx = before.lastIndexOf("@");
  if (atIdx === -1) return null;
  const fragment = before.slice(atIdx + 1);
  // Cancel if fragment contains whitespace, brackets, or newlines
  if (/[\s\[\]\n]/.test(fragment)) return null;
  return { query: fragment, atIndex: atIdx };
}

type Props = {
  value: string;
  onChange: (v: string) => void;
  questions: Question[];
  rows?: number;
  disabled?: boolean;
  placeholder?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  autoFocus?: boolean;
  className?: string;
};

export default function QuestionMentionTextarea({
  value,
  onChange,
  questions,
  rows = 4,
  disabled,
  placeholder,
  onKeyDown,
  autoFocus,
  className = "",
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<MentionState>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  const filtered = mention
    ? questions.filter((q) =>
        q.text.toLowerCase().includes(mention.query.toLowerCase()),
      )
    : [];

  const closeMention = useCallback(() => setMention(null), []);

  function recheckMention() {
    const ta = textareaRef.current;
    if (!ta) return;
    const m = detectMention(ta.value, ta.selectionStart ?? ta.value.length);
    setMention(m);
    if (m) setActiveIdx(0);
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const text = e.target.value;
    onChange(text);
    const cursor = e.target.selectionStart ?? text.length;
    const m = detectMention(text, cursor);
    setMention(m);
    if (m) setActiveIdx(0);
  }

  function selectQuestion(q: Question) {
    if (!mention) return;
    const before = value.slice(0, mention.atIndex);
    const after = value.slice(mention.atIndex + 1 + mention.query.length);
    const chip = `@[${q.text}]`;
    const newValue = before + chip + after;
    onChange(newValue);
    setMention(null);
    setTimeout(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      const pos = before.length + chip.length;
      ta.setSelectionRange(pos, pos);
      ta.focus();
    }, 0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mention) {
      // Escape always dismisses the dropdown, even when empty
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeMention();
        return;
      }
      if (filtered.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActiveIdx((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          const choice = filtered[activeIdx] ?? filtered[0];
          if (choice) {
            e.preventDefault();
            selectQuestion(choice);
            return;
          }
        }
      }
    }
    onKeyDown?.(e);
  }

  return (
    <div className="relative">
      <TextareaAutosize
        ref={textareaRef}
        minRows={rows}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onSelect={recheckMention}
        onBlur={closeMention}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        className={className}
      />

      {mention && filtered.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 z-20 mb-1 max-h-52 overflow-y-auto rounded-lg border border-black/10 bg-white shadow-lg">
          {filtered.map((q, i) => (
            <button
              key={q.id}
              type="button"
              // mousedown fires before blur so we can select before the dropdown closes
              onMouseDown={(e) => {
                e.preventDefault();
                selectQuestion(q);
              }}
              className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors ${
                i === activeIdx
                  ? "bg-teal-50 text-teal-900"
                  : "text-foreground/80 hover:bg-foreground/5"
              }`}
            >
              <span className="line-clamp-1 text-sm font-medium">{q.text}</span>
              {q.branches.length > 0 && (
                <span className="text-[11px] text-foreground/40">
                  {q.branches.length} branch{q.branches.length !== 1 ? "es" : ""}
                </span>
              )}
            </button>
          ))}
          <div className="border-t border-black/5 px-3 py-1.5">
            <span className="text-[10px] text-foreground/30">
              ↑↓ navigate · Enter to select · Esc to dismiss
            </span>
          </div>
        </div>
      )}

      {mention && filtered.length === 0 && mention.query.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 z-20 mb-1 rounded-lg border border-black/10 bg-white px-3 py-2 shadow-lg">
          <span className="text-sm text-foreground/40">No matching questions</span>
        </div>
      )}
    </div>
  );
}
