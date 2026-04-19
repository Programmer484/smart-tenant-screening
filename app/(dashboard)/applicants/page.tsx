"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { ApplicantsTableSkeleton } from "@/app/components/Skeleton";
import { ConfirmDialog } from "@/app/components/ConfirmDialog";

type Session = {
  id: string;
  listing_title: string;
  status: string | null;
  answers: Record<string, string>;
  message_count: number;
  created_at: string;
  updated_at: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

const STATUS_OPTIONS = ["all", "qualified", "rejected", "in_progress"] as const;
type StatusFilter = (typeof STATUS_OPTIONS)[number];

function extractName(answers: Record<string, string>): string | null {
  const nameKeys = ["name", "full_name", "applicant_name", "tenant_name", "first_name"];
  for (const key of nameKeys) {
    if (answers[key] && String(answers[key]).trim()) return String(answers[key]).trim();
  }
  for (const [key, val] of Object.entries(answers)) {
    if (key.toLowerCase().includes("name") && String(val).trim()) return String(val).trim();
  }
  return null;
}

function badge(status: string | null) {
  if (status === "qualified")
    return <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-semibold text-teal-800">qualified</span>;
  if (status === "rejected")
    return <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">rejected</span>;
  return <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-500">in progress</span>;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

type ExpandedPanel = { type: "answers" | "chat"; sessionId: string };

export default function ApplicantsPage() {
  const supabase = createClient();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [expanded, setExpanded] = useState<ExpandedPanel | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [propertyContext, setPropertyContext] = useState<{ id: string; title: string; published: boolean } | null>(null);

  const propertyId = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("property")
    : null;

  useEffect(() => {
    async function load() {
      setLoading(true);
      let query = supabase
        .from("sessions")
        .select("*")
        .order("created_at", { ascending: false });

      if (propertyId) {
        query = query.eq("property_id", propertyId);
        supabase.from("properties").select("id,title,published_at").eq("id", propertyId).single()
          .then(({ data }) => {
            if (data) {
              setPropertyContext({
                id: data.id,
                title: data.title,
                published: !!data.published_at,
              });
            }
          });
      }

      const { data, error } = await query;
      if (error) { setError(error.message); }
      else { setSessions((data as Session[]) ?? []); }
      setLoading(false);
    }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function copyChatLink() {
    if (!propertyContext) return;
    if (!propertyContext.published) {
      toast.error("Publish this property before sharing the applicant chat link.");
      return;
    }
    const url = `${window.location.origin}/chat/${propertyContext.id}`;
    await navigator.clipboard.writeText(url);
    toast.success("Chat link copied");
  }

  function togglePanel(sessionId: string, type: "answers" | "chat") {
    if (expanded?.sessionId === sessionId && expanded.type === type) {
      setExpanded(null);
      return;
    }
    setExpanded({ type, sessionId });

    if (type === "chat") {
      setChatLoading(true);
      setChatMessages([]);
      supabase
        .from("messages")
        .select("id,role,content,created_at")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true })
        .then(({ data }) => {
          setChatMessages((data as ChatMessage[]) ?? []);
          setChatLoading(false);
        });
    }
  }

  async function deleteSession(id: string) {
    setDeleteTarget(null);
    setDeleting(id);
    try {
      const { error: msgErr } = await supabase.from("messages").delete().eq("session_id", id);
      if (msgErr) { console.error("[delete messages]", msgErr); toast.error("Failed to delete session"); return; }
      const { error: sesErr } = await supabase.from("sessions").delete().eq("id", id);
      if (sesErr) { console.error("[delete session]", sesErr); toast.error("Failed to delete session"); return; }
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (expanded?.sessionId === id) setExpanded(null);
      toast.success("Session deleted");
    } finally {
      setDeleting(null);
    }
  }

  const visible = sessions.filter((s) => {
    if (filter === "all") return true;
    if (filter === "in_progress") return s.status === "in_progress" || !s.status;
    return s.status === filter;
  });

  return (
    <main className="p-6 sm:p-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <h1 className="text-xl font-semibold text-[#1a2e2a]">Applicants</h1>
          <p className="mt-0.5 text-sm text-[#1a2e2a]/50">
            {sessions.length} session{sessions.length !== 1 ? "s" : ""} total
          </p>
        </div>

        {propertyContext && (
          <div className="mb-6 flex items-center justify-between rounded-xl border border-teal-100 bg-teal-50/50 px-5 py-3">
            <div className="flex items-center gap-2 text-sm">
              <Link
                href={`/property/${propertyContext.id}`}
                className="font-medium text-teal-800 hover:underline"
              >
                ← {propertyContext.title}
              </Link>
              <span className="text-teal-700/30">·</span>
              <span className="text-teal-700/60">
                {sessions.length} applicant{sessions.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void copyChatLink()}
                className="flex items-center gap-1.5 rounded-lg border border-teal-200 bg-white px-3 py-1.5 text-xs font-medium text-teal-800 transition-colors hover:bg-teal-50"
              >
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path d="M10.5 5h-1a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v0a2 2 0 0 0-2-2ZM4.5 5h-1a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v0a2 2 0 0 0-2-2ZM5 7h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                Share link
              </button>
              <Link
                href="/applicants"
                className="text-xs text-teal-700/50 transition-colors hover:text-teal-700"
              >
                View all →
              </Link>
            </div>
          </div>
        )}

        <div className="mb-4 flex gap-1">
          {STATUS_OPTIONS.map((opt) => (
            <button key={opt} onClick={() => setFilter(opt)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                filter === opt
                  ? "bg-[#1a2e2a] text-white"
                  : "text-[#1a2e2a]/50 hover:bg-white hover:text-[#1a2e2a]"
              }`}>
              {opt === "in_progress" ? "in progress" : opt}
            </button>
          ))}
        </div>

        {loading && <ApplicantsTableSkeleton />}
        {error && <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>}
        {!loading && !error && visible.length === 0 && (
          <p className="text-sm text-[#1a2e2a]/40">No applicants yet for this filter.</p>
        )}

        {!loading && !error && visible.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-[#1a2e2a]/10 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1a2e2a]/8 bg-[#f7f9f8] text-left text-[11px] font-semibold uppercase tracking-wider text-[#1a2e2a]/40">
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Applicant</th>
                  <th className="px-4 py-3">Listing</th>
                  <th className="px-4 py-3">Messages</th>
                  <th className="px-4 py-3">Updated</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => (
                  <Fragment key={s.id}>
                    <tr className="border-b border-[#1a2e2a]/6 last:border-0 hover:bg-[#f7f9f8]">
                      <td className="px-4 py-3">{badge(s.status)}</td>
                      <td className="px-4 py-3 font-medium text-[#1a2e2a]">
                        {extractName(s.answers) ?? <span className="text-[#1a2e2a]/30">Anonymous</span>}
                      </td>
                      <td className="px-4 py-3 text-[#1a2e2a]/60">{s.listing_title}</td>
                      <td className="px-4 py-3 text-[#1a2e2a]/60">{s.message_count}</td>
                      <td className="px-4 py-3 text-[#1a2e2a]/50">{formatDate(s.updated_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-3">
                          <button onClick={() => togglePanel(s.id, "answers")}
                            className={`text-[11px] font-medium hover:underline ${
                              expanded?.sessionId === s.id && expanded.type === "answers"
                                ? "text-[#1a2e2a]" : "text-teal-700"
                            }`}>
                            {expanded?.sessionId === s.id && expanded.type === "answers" ? "hide" : "answers"}
                          </button>
                          <button onClick={() => togglePanel(s.id, "chat")}
                            className={`text-[11px] font-medium hover:underline ${
                              expanded?.sessionId === s.id && expanded.type === "chat"
                                ? "text-[#1a2e2a]" : "text-teal-700"
                            }`}>
                            {expanded?.sessionId === s.id && expanded.type === "chat" ? "hide" : "chat log"}
                          </button>
                          <button onClick={() => setDeleteTarget({ id: s.id, title: s.listing_title })}
                            disabled={deleting === s.id}
                            className="text-[11px] font-medium text-red-400 hover:text-red-600 hover:underline disabled:opacity-50">
                            {deleting === s.id ? "…" : "delete"}
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Answers panel */}
                    {expanded?.sessionId === s.id && expanded.type === "answers" && (
                      <tr className="border-b border-[#1a2e2a]/6 bg-[#f7f9f8]">
                        <td colSpan={6} className="px-4 py-3">
                          {Object.keys(s.answers).length === 0 ? (
                            <p className="text-[11px] text-[#1a2e2a]/40">No answers collected yet.</p>
                          ) : (
                            <dl className="grid grid-cols-2 gap-x-8 gap-y-1 sm:grid-cols-3">
                              {Object.entries(s.answers).map(([k, v]) => (
                                <div key={k}>
                                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-[#1a2e2a]/40">{k}</dt>
                                  <dd className="text-[13px] text-[#1a2e2a]/80">{String(v)}</dd>
                                </div>
                              ))}
                            </dl>
                          )}
                        </td>
                      </tr>
                    )}

                    {/* Chat log panel */}
                    {expanded?.sessionId === s.id && expanded.type === "chat" && (
                      <tr className="border-b border-[#1a2e2a]/6 bg-[#f7f9f8]">
                        <td colSpan={6} className="px-4 py-4">
                          {chatLoading ? (
                            <p className="text-[11px] text-[#1a2e2a]/40">Loading chat…</p>
                          ) : chatMessages.length === 0 ? (
                            <p className="text-[11px] text-[#1a2e2a]/40">No messages recorded.</p>
                          ) : (
                            <div className="max-h-96 space-y-3 overflow-y-auto">
                              {chatMessages.map((m) => (
                                <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                                  <div className={`max-w-[70%] rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
                                    m.role === "user"
                                      ? "bg-teal-800 text-white"
                                      : "bg-white text-[#1a2e2a] shadow-sm ring-1 ring-black/5"
                                  }`}>
                                    <p className="whitespace-pre-wrap">{m.content}</p>
                                    <p className={`mt-1 text-[9px] ${
                                      m.role === "user" ? "text-white/50" : "text-[#1a2e2a]/30"
                                    }`}>
                                      {formatDate(m.created_at)}
                                    </p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this session?"
        description={deleteTarget ? `This will permanently remove the session from "${deleteTarget.title}" and all its messages.` : ""}
        confirmLabel="Delete"
        destructive
        onConfirm={() => deleteTarget && void deleteSession(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </main>
  );
}
