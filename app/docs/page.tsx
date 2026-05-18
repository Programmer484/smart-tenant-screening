"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { DOCS_SECTIONS } from "@/lib/docs-content";

type Message = { role: "user" | "assistant"; content: string };

function renderContent(text: string) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let key = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line === "---") {
      elements.push(<hr key={key++} className="my-5 border-black/8" />);
    } else if (line.startsWith("**") && line.endsWith("**") && line.length > 4) {
      elements.push(
        <p key={key++} className="mt-5 mb-1.5 font-semibold text-[#1a2e2a]">
          {line.slice(2, -2)}
        </p>
      );
    } else if (line.startsWith("- ")) {
      elements.push(
        <li key={key++} className="ml-4 list-disc text-[#1a2e2a]/75 leading-relaxed">
          {renderInline(line.slice(2))}
        </li>
      );
    } else if (/^\d+\. /.test(line)) {
      const content = line.replace(/^\d+\. /, "");
      elements.push(
        <li key={key++} className="ml-4 list-decimal text-[#1a2e2a]/75 leading-relaxed">
          {renderInline(content)}
        </li>
      );
    } else if (line.trim() === "") {
      elements.push(<div key={key++} className="h-2" />);
    } else {
      elements.push(
        <p key={key++} className="text-[#1a2e2a]/75 leading-relaxed">
          {renderInline(line)}
        </p>
      );
    }
  }

  return elements;
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-semibold text-[#1a2e2a]">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={i} className="rounded bg-black/5 px-1 py-0.5 font-mono text-xs text-teal-800">{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState(DOCS_SECTIONS[0].id);
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (chatOpen) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      inputRef.current?.focus();
    }
  }, [messages, chatOpen]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const newMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setLoading(true);

    try {
      const res = await fetch("/api/docs-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });
      const data = await res.json();
      setMessages([...newMessages, { role: "assistant", content: data.reply ?? "Sorry, something went wrong." }]);
    } catch {
      setMessages([...newMessages, { role: "assistant", content: "Something went wrong. Please try again." }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const currentSection = DOCS_SECTIONS.find((s) => s.id === activeSection)!;

  return (
    <div className="min-h-screen bg-[#f7f9f8]">
      {/* Header */}
      <header className="border-b border-black/8 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-800 text-white">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                <rect x="1" y="6" width="14" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M4 6V4.5a4 4 0 0 1 8 0V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <rect x="6.25" y="9.5" width="3.5" height="2.5" rx="0.75" fill="currentColor" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-[#1a2e2a]">RentScreen</span>
          </Link>
          <span className="text-sm text-[#1a2e2a]/50">Help &amp; Documentation</span>
        </div>
      </header>

      <div className="mx-auto flex max-w-5xl gap-8 px-6 py-10">
        {/* Sidebar */}
        <aside className="w-52 shrink-0">
          <nav className="sticky top-10 space-y-0.5">
            {DOCS_SECTIONS.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  activeSection === section.id
                    ? "bg-teal-800 font-medium text-white"
                    : "text-[#1a2e2a]/60 hover:bg-black/5 hover:text-[#1a2e2a]"
                }`}
              >
                {section.title}
              </button>
            ))}
          </nav>
        </aside>

        {/* Main content */}
        <main className="min-w-0 flex-1">
          <h1 className="mb-6 text-2xl font-semibold text-[#1a2e2a]">{currentSection.title}</h1>
          <div className="space-y-0.5">{renderContent(currentSection.content)}</div>

          {/* Prev / Next */}
          <div className="mt-12 flex justify-between border-t border-black/8 pt-6">
            {(() => {
              const idx = DOCS_SECTIONS.findIndex((s) => s.id === activeSection);
              const prev = DOCS_SECTIONS[idx - 1];
              const next = DOCS_SECTIONS[idx + 1];
              return (
                <>
                  <div>
                    {prev && (
                      <button onClick={() => setActiveSection(prev.id)} className="text-sm text-teal-700 hover:underline">
                        ← {prev.title}
                      </button>
                    )}
                  </div>
                  <div>
                    {next && (
                      <button onClick={() => setActiveSection(next.id)} className="text-sm text-teal-700 hover:underline">
                        {next.title} →
                      </button>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </main>
      </div>

      {/* AI Chat widget */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
        {chatOpen && (
          <div className="flex h-[480px] w-[360px] flex-col overflow-hidden rounded-2xl border border-black/10 bg-white shadow-xl">
            {/* Chat header */}
            <div className="flex items-center justify-between border-b border-black/8 px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-800 text-white">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zM7 5h2v2H7V5zm0 4h2v4H7V9z" fill="currentColor" />
                  </svg>
                </div>
                <span className="text-sm font-medium text-[#1a2e2a]">Ask a question</span>
              </div>
              <button
                onClick={() => setChatOpen(false)}
                className="rounded p-1 text-[#1a2e2a]/40 hover:bg-black/5 hover:text-[#1a2e2a]"
                aria-label="Close"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && (
                <div className="space-y-2">
                  <p className="text-sm text-[#1a2e2a]/50">Hi! Ask me anything about RentScreen.</p>
                  {["How do rules work?", "How do I share my screening link?", "What field types can I use?"].map((q) => (
                    <button
                      key={q}
                      onClick={() => { setInput(q); inputRef.current?.focus(); }}
                      className="block w-full rounded-lg border border-black/8 px-3 py-2 text-left text-xs text-[#1a2e2a]/60 hover:bg-[#f7f9f8] hover:text-[#1a2e2a]"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                      m.role === "user"
                        ? "bg-teal-800 text-white"
                        : "bg-[#f7f9f8] text-[#1a2e2a]/80"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="rounded-xl bg-[#f7f9f8] px-3 py-2 text-sm text-[#1a2e2a]/40">
                    Thinking…
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="border-t border-black/8 p-3">
              <div className="flex items-end gap-2 rounded-lg border border-black/10 bg-[#f7f9f8] px-3 py-2">
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder="Ask a question…"
                  className="flex-1 resize-none bg-transparent text-sm text-[#1a2e2a] placeholder:text-[#1a2e2a]/40 focus:outline-none"
                  style={{ maxHeight: 80 }}
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || loading}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-teal-800 text-white transition-opacity disabled:opacity-40"
                  aria-label="Send"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M5 9V1M1 5l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Toggle button */}
        <button
          onClick={() => setChatOpen((o) => !o)}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-800 text-white shadow-lg transition-opacity hover:opacity-90"
          aria-label={chatOpen ? "Close help chat" : "Open help chat"}
        >
          {chatOpen ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zM7 5h2v2H7V5zm0 4h2v4H7V9z" fill="currentColor" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
