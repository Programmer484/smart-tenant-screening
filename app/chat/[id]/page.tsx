"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { PropertyRecord, ListingLink, AiInstructions } from "@/lib/property";
import { resolveFields, resolveAiInstructions } from "@/lib/property";
import type { LandlordField } from "@/lib/landlord-field";
import type { LandlordRule } from "@/lib/landlord-rule";

type Role = "assistant" | "user";
type Extraction = { fieldId: string; value: string };
type Message = { id: string; role: Role; text: string; extracted?: Extraction[] };
type ApiMessage = { role: "user" | "assistant"; content: string };

type ChatConfig = {
  id: string;
  title: string;
  description: string;
  fields: LandlordField[];
  rules: LandlordRule[];
  links: ListingLink[];
  aiInstructions: AiInstructions;
};

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

function ExtractionLog({ extracted }: { extracted: Extraction[] }) {
  const [open, setOpen] = useState(false);
  if (!extracted.length) return null;
  return (
    <div className="mt-1 ml-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-[10px] text-[#1a2e2a]/35 hover:text-[#1a2e2a]/60"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={`transition-transform ${open ? "rotate-90" : ""}`}>
          <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {extracted.length} field{extracted.length > 1 ? "s" : ""} extracted
      </button>
      {open && (
        <pre className="mt-1.5 rounded-lg border border-black/8 bg-black/[0.03] px-3 py-2 font-mono text-[10px] leading-relaxed text-[#1a2e2a]/60">
          {JSON.stringify(extracted, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function ChatPage() {
  const { id: propertyId } = useParams<{ id: string }>();
  const supabase = createClient();

  const [config, setConfig] = useState<ChatConfig | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);

  // Lifecycle state (server-authoritative via session DB)
  const [rejected, setRejected] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [qualified, setQualified] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const inputDisabled = rejected || completed;

  function cookieName(pid: string) {
    return `st_session_${pid}`;
  }

  function getCookie(name: string): string | null {
    const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return m ? decodeURIComponent(m[1] ?? "") : null;
  }

  function setCookie(name: string, value: string) {
    const maxAgeDays = 7;
    const maxAge = maxAgeDays * 24 * 60 * 60;
    document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
  }

  async function fetchGreeting(cfg: ChatConfig, sid: string) {
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: cfg.title,
          description: cfg.description,
          fields: cfg.fields,
          rules: cfg.rules,
          aiInstructions: cfg.aiInstructions,
          answers: {},
          messages: [{ role: "user", content: "(new conversation — introduce yourself and ask the first screening question)" }],
          sessionId: sid,
          propertyId: cfg.id,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { reply?: string };
        setMessages([{ id: generateId(), role: "assistant", text: data.reply ?? "Welcome! How can I help you today?" }]);
      } else {
        setMessages([{ id: generateId(), role: "assistant", text: `Welcome! I'm here to help with your application for ${cfg.title}.` }]);
      }
    } catch {
      setMessages([{ id: generateId(), role: "assistant", text: `Welcome! I'm here to help with your application for ${cfg.title}.` }]);
    }
  }

  useEffect(() => {
    async function load() {
      const [propRes, sharedRes] = await Promise.all([
        supabase.from("properties").select("*").eq("id", propertyId).single(),
        supabase.from("shared_fields").select("*").order("sort_order"),
      ]);

      if (propRes.error || !propRes.data) {
        setMessages([{
          id: "init", role: "assistant",
          text: "This listing could not be found.",
        }]);
        return;
      }

      const p = propRes.data as PropertyRecord;
      const sharedAll = (sharedRes.data as LandlordField[] | null) ?? [];
      const fields = resolveFields(p, sharedAll);

      const cfg: ChatConfig = {
        id: p.id,
        title: p.title,
        description: p.description,
        fields,
        rules: (p.rules as LandlordRule[]) ?? [],
        links: (p.links as ListingLink[]) ?? [],
        aiInstructions: resolveAiInstructions(p.ai_instructions),
      };
      setConfig(cfg);

      // Cookie-based session id (resume on refresh, same browser/device)
      const cn = cookieName(propertyId);
      const existing = getCookie(cn);
      const sid = existing && existing.length > 10 ? existing : crypto.randomUUID();
      if (!existing) setCookie(cn, sid);
      setSessionId(sid);

      // Restore prior state (server reads cookie + uses service role)
      try {
        const res = await fetch(`/api/session?propertyId=${encodeURIComponent(propertyId)}`);
        if (res.ok) {
          const data = (await res.json()) as {
            answers?: Record<string, string>;
            messages?: { role: "user" | "assistant"; content: string }[];
            status?: string;
          };

          setAnswers(data.answers ?? {});
          setMessages((data.messages ?? []).map((m) => ({
            id: generateId(),
            role: m.role,
            text: m.content,
          })));

          if (data.status === "rejected") setRejected(true);
          if (data.status === "qualified") {
            setQualified(true);
            setCompleted(true);
          }
        } else {
          // New session — get AI greeting via the chat API
          await fetchGreeting(cfg, sid);
        }
      } catch {
        await fetchGreeting(cfg, sid);
      }
    }
    void load();
  }, [propertyId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || sending || !config || inputDisabled || !sessionId) return;

    const userMsg: Message = { id: generateId(), role: "user", text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setSending(true);

    // Include init message so AI sees the greeting with the first question
    const apiHistory: ApiMessage[] = nextMessages.map((m) => ({
      role: m.role,
      content: m.text,
    }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: config.title,
          description: config.description,
          fields: config.fields,
          rules: config.rules,
          aiInstructions: config.aiInstructions,
          answers,
          messages: apiHistory,
          sessionId,
          propertyId: config.id,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        const errMsg = (errData as { error?: string } | null)?.error ?? "Something went wrong.";
        setMessages((prev) => [
          ...prev,
          { id: generateId(), role: "assistant", text: errMsg },
        ]);
        return;
      }

      const data = (await res.json()) as {
        reply?: string;
        extracted?: Extraction[];
        sessionStatus?: string;
      };

      const extracted = data.extracted ?? [];
      const reply = data.reply ?? "Something went wrong.";
      const status = data.sessionStatus ?? "in_progress";

      setMessages((prev) => [
        ...prev,
        { id: generateId(), role: "assistant", text: reply, extracted },
      ]);

      if (extracted.length) {
        setAnswers((prev) => {
          const next = { ...prev };
          for (const { fieldId, value } of extracted) {
            if (config.fields.some((f) => f.id === fieldId)) next[fieldId] = value;
          }
          return next;
        });
      }

      // Update lifecycle state from server response
      if (status === "rejected") {
        setRejected(true);
      } else if (status === "completed") {
        setCompleted(true);
        setQualified(true);
      } else if (status === "qualified") {
        setQualified(true);
      }

    } catch {
      setMessages((prev) => [
        ...prev,
        { id: generateId(), role: "assistant", text: "Network error — please try again." },
      ]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  const answeredCount = Object.keys(answers).length;
  const totalFields = config?.fields.length ?? 0;

  return (
    <div className="flex h-full min-h-screen flex-col" style={{ background: "#f0ede6" }}>
      <header className="flex items-center gap-3 border-b border-black/8 bg-[#f0ede6] px-6 py-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-teal-800/10 text-teal-800">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
            <rect x="2" y="7" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M5 7V5a4 4 0 0 1 8 0v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <rect x="7" y="11" width="4" height="3" rx="0.75" fill="currentColor" />
          </svg>
        </div>
        <div className="flex flex-1 items-baseline gap-3 min-w-0">
          <h1 className="truncate text-sm font-semibold text-[#1a2e2a]">
            {config?.title || "Rental Application"}
          </h1>
          {totalFields > 0 && (
            <span className="shrink-0 text-xs text-[#1a2e2a]/45">
              {answeredCount}/{totalFields} answered
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button type="button" onClick={() => setDebugOpen((o) => !o)}
            className="text-xs text-[#1a2e2a]/40 underline-offset-2 hover:text-[#1a2e2a]/70 hover:underline">
            {debugOpen ? "Hide debug" : "Debug"}
          </button>
        </div>
      </header>

      {debugOpen && (
        <div className="border-b border-black/8 bg-black/[0.03] px-6 py-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#1a2e2a]/40">Answers state</p>
          {Object.keys(answers).length === 0 ? (
            <p className="font-mono text-[11px] text-[#1a2e2a]/40">No answers yet.</p>
          ) : (
            <pre className="font-mono text-[11px] leading-relaxed text-[#1a2e2a]/70">
              {JSON.stringify(answers, null, 2)}
            </pre>
          )}
        </div>
      )}

      <main className="flex flex-1 flex-col items-center overflow-y-auto px-4 py-8">
        <div className="flex w-full max-w-xl flex-col gap-3">
          {messages.map((msg) => (
            <div key={msg.id} className="flex flex-col">
              <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
                  msg.role === "assistant" ? "rounded-tl-sm bg-white text-[#1a2e2a]" : "rounded-tr-sm bg-teal-800 text-white"
                }`}>
                  {msg.text}
                </div>
              </div>
              {msg.role === "assistant" && msg.extracted && (
                <ExtractionLog extracted={msg.extracted} />
              )}
            </div>
          ))}

          {sending && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-tl-sm bg-white px-4 py-3 shadow-sm">
                <span className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#1a2e2a]/30"
                      style={{ animationDelay: `${i * 150}ms` }} />
                  ))}
                </span>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </main>

      <footer className="border-t border-black/8 bg-[#f0ede6] px-4 py-4">
        {completed ? (
          <div className="mx-auto flex w-full max-w-xl items-center gap-3 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0 text-teal-600" aria-hidden>
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.4" />
              <path d="M5 8.5l2 2 4-4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="text-sm text-teal-800">Your application is complete. We'll be in touch!</p>
          </div>
        ) : rejected ? (
          <div className="mx-auto flex w-full max-w-xl items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0 text-red-500" aria-hidden>
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.4" />
              <path d="M8 4.5v4M8 10.5v1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <p className="text-sm text-red-700">This application has been closed.</p>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-xl items-end gap-3">
            <textarea ref={inputRef} rows={1} value={input} disabled={sending}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
              }}
              placeholder="Type your answer..."
              className="min-h-[44px] flex-1 resize-none overflow-hidden rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-[#1a2e2a] placeholder:text-[#1a2e2a]/40 focus:border-teal-700/40 focus:outline-none focus:ring-2 focus:ring-teal-700/20 disabled:opacity-60"
            />
            <button type="button" onClick={() => void send()} disabled={!input.trim() || sending}
              aria-label="Send"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-700 text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-40">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                <path d="M15.5 9 3 3l2.5 6L3 15l12.5-6Z" fill="currentColor" />
              </svg>
            </button>
          </div>
        )}
      </footer>
    </div>
  );
}
