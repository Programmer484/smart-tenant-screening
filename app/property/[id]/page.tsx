"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { PropertyRecord, ListingLink, AiInstructions } from "@/lib/property";
import { DEFAULT_AI_INSTRUCTIONS, resolveAiInstructions } from "@/lib/property";
import type { LandlordField } from "@/lib/landlord-field";
import type { LandlordRule } from "@/lib/landlord-rule";
import LandlordFieldsSection from "@/app/components/LandlordFieldsSection";
import RulesSection from "@/app/components/RulesSection";

const TABS = ["Questions", "Rules", "Links", "AI Behavior"] as const;

type Tab = (typeof TABS)[number];

// ─── Shared-fields list (read-only, always active for all properties) ────────

function SharedFieldsList({ allShared }: { allShared: LandlordField[] }) {
  if (allShared.length === 0) {
    return (
      <p className="text-sm text-foreground/40">
        No shared questions yet.{" "}
        <Link href="/shared-fields" className="text-teal-700 hover:underline">
          Add some →
        </Link>
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {allShared.map((f) => (
        <div
          key={f.id}
          className="flex items-center gap-3 rounded-lg border border-foreground/10 bg-white px-3 py-2.5"
        >
          <span className="flex-1 text-sm text-foreground/80">{f.label}</span>
          <span className="text-[11px] text-foreground/35">{f.value_kind}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────

export default function PropertySetupPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();

  // Property state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ownFields, setOwnFields] = useState<LandlordField[]>([]);
  const [rules, setRules] = useState<LandlordRule[]>([]);
  const [links, setLinks] = useState<ListingLink[]>([]);
  const [aiInstructions, setAiInstructions] = useState<AiInstructions>(DEFAULT_AI_INSTRUCTIONS);
  const [status, setStatus] = useState<"draft" | "published">("draft");

  // UI state
  const [allShared, setAllShared] = useState<LandlordField[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("Questions");
  const [loadingPhase, setLoadingPhase] = useState<null | "fields" | "rules">(null);
  const [saving, setSaving] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load property + shared fields
  useEffect(() => {
    async function load() {
      const [propRes, sharedRes] = await Promise.all([
        supabase.from("properties").select("*").eq("id", id).single(),
        supabase.from("shared_fields").select("*").order("sort_order"),
      ]);

      if (propRes.error || !propRes.data) {
        setError("Property not found.");
        setPageLoading(false);
        return;
      }

      const p = propRes.data as PropertyRecord;
      setTitle(p.title);
      setDescription(p.description);
      setOwnFields(p.own_fields ?? []);
      setRules(p.rules ?? []);
      setLinks(p.links ?? []);
      setAiInstructions(resolveAiInstructions(p.ai_instructions));
      setStatus(p.status);

      setAllShared((sharedRes.data ?? []) as LandlordField[]);
      setPageLoading(false);
    }
    void load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save property to DB
  const save = useCallback(
    async (overrides?: Partial<PropertyRecord>) => {
      setSaving(true);
      const { error } = await supabase
        .from("properties")
        .update({
          title: title.trim() || "New Property",
          description: description.trim(),
          own_fields: ownFields,
          rules,
          links: links.filter((l) => l.label.trim() && l.url.trim()),
          ai_instructions: aiInstructions,
          status,
          updated_at: new Date().toISOString(),
          ...overrides,
        })
        .eq("id", id);
      setSaving(false);
      if (error) console.error("[save]", error);
    },
    [id, title, description, ownFields, rules, links, aiInstructions, status, supabase], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── Convert property-specific → shared ──────────────────────────────

  async function makeShared(field: LandlordField) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const nextSort = allShared.length;
    const row = {
      id: field.id,
      user_id: user.id,
      label: field.label,
      value_kind: field.value_kind,
      collect_hint: field.collect_hint ?? null,
      options: field.options ?? null,
      sort_order: nextSort,
    };

    const { error } = await supabase.from("shared_fields").upsert(row, { onConflict: "user_id,id" });
    if (error) { console.error("[make-shared]", error); return; }

    setOwnFields((prev) => prev.filter((f) => f.id !== field.id));
    setAllShared((prev) => prev.some((f) => f.id === field.id) ? prev : [...prev, field]);
  }

  // ── Three-pass generation ───────────────────────────────────────────────

  async function handleGenerate() {
    if (!description.trim()) return;
    try {
      // Pass 1: generate property-specific questions (excluding shared topics)
      setLoadingPhase("fields");
      const fieldsRes = await fetch("/api/generate-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          excludeLabels: allShared.map((f) => f.label),
        }),
      });
      const fieldsData = (await fieldsRes.json()) as { fields?: LandlordField[] };
      const newFields = fieldsData.fields ?? [];
      setOwnFields(newFields);

      // Pass 2: generate rules from all questions (shared + new)
      setLoadingPhase("rules");
      const resolvedFields = [...allShared, ...newFields];
      const rulesRes = await fetch("/api/generate-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, fields: resolvedFields }),
      });
      const rulesData = (await rulesRes.json()) as { rules?: LandlordRule[] };
      setRules(rulesData.rules ?? []);
    } catch (err) {
      console.error("[generate]", err);
    } finally {
      setLoadingPhase(null);
    }
  }

  // ── Property info generation ───────────────────────────────────────────


  // ─────────────────────────────────────────────────────────────────────────

  if (pageLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f9f8]">
        <p className="text-sm text-foreground/50">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f9f8]">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  const allResolvedFields = [...allShared, ...ownFields].filter(
    (f, i, arr) => arr.findIndex((x) => x.id === f.id) === i,
  );
  const resolvedFieldCount = allResolvedFields.length;

  return (
    <div className="min-h-screen bg-[#f7f9f8]">
      {/* Nav */}
      <header className="border-b border-black/8 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
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
          <div className="flex items-center gap-2">
            <span className="text-xs text-foreground/40">
              {status === "published" ? "Published" : "Draft"}
            </span>
            <button
              type="button"
              onClick={async () => {
                const next = status === "draft" ? "published" : "draft";
                setStatus(next);
                await save({ status: next });
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                status === "published"
                  ? "bg-teal-100 text-teal-800 hover:bg-teal-200"
                  : "border border-black/10 text-foreground/60 hover:bg-white"
              }`}
            >
              {status === "published" ? "Unpublish" : "Publish"}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-8 px-6 py-10">
        {/* Title + description */}
        <section className="space-y-4">
          <input
            type="text"
            placeholder="Property title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-foreground/10 bg-white px-4 py-2.5 text-base font-semibold text-foreground placeholder:font-normal placeholder:text-foreground/30 focus:border-teal-700/40 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
          />
          <div className="relative">
            <textarea
              rows={5}
              placeholder="Describe your property — rent, rules, requirements, pet policy, lease length, etc."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !loadingPhase) {
                  e.preventDefault();
                  void handleGenerate();
                }
              }}
              className="w-full resize-none rounded-lg border border-foreground/10 bg-white px-4 py-3 text-sm text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
            />
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!description.trim() || loadingPhase !== null}
              className="absolute bottom-3 right-3 rounded-md bg-teal-700 px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {loadingPhase === "fields"
                ? "Generating questions…"
                : loadingPhase === "rules"
                  ? "Generating rules…"
                  : "Generate"}
            </button>
          </div>
        </section>

        {/* Tabs */}
        <section>
          <div className="mb-6 flex gap-1 border-b border-foreground/8">
            {TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-3 pb-3 text-sm font-medium transition-colors ${
                  activeTab === tab
                    ? "border-b-2 border-teal-700 text-teal-700"
                    : "text-foreground/50 hover:text-foreground/80"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {activeTab === "Questions" && (
            <div className="space-y-8">
              {/* Shared questions (always active) */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-foreground/80">Shared questions</h3>
                    <p className="text-xs text-foreground/40">
                      Active across all properties.{" "}
                      <Link href="/shared-fields" className="text-teal-700 hover:underline">
                        Manage →
                      </Link>
                    </p>
                  </div>
                  <span className="text-xs text-foreground/40">
                    {allShared.length} questions
                  </span>
                </div>
                <SharedFieldsList allShared={allShared} />
              </div>

              <div className="border-t border-foreground/8 pt-8">
                <div className="mb-3">
                  <h3 className="text-sm font-medium text-foreground/80">Property-specific questions</h3>
                  <p className="text-xs text-foreground/40">
                    Unique to this listing. AI will not generate duplicates of shared questions.
                  </p>
                </div>
                <LandlordFieldsSection
                  fields={ownFields}
                  onChange={setOwnFields}
                  onBeforeDelete={(field) => {
                    const linked = rules.filter((r) => r.fieldId === field.id);
                    if (linked.length === 0) return true;
                    const names = linked.map((r) => `${field.label} ${r.operator} ${r.value}`).join("\n  • ");
                    if (!confirm(`Deleting "${field.label}" will also remove ${linked.length} rule(s):\n  • ${names}\n\nProceed?`)) {
                      return false;
                    }
                    setRules((prev) => prev.filter((r) => r.fieldId !== field.id));
                    return true;
                  }}
                  fieldAction={(field) => (
                    <button
                      type="button"
                      onClick={() => void makeShared(field)}
                      title="Move to shared pool and select for this property"
                      className="whitespace-nowrap text-[11px] text-foreground/30 hover:text-teal-700"
                    >
                      → shared
                    </button>
                  )}
                />
              </div>
            </div>
          )}

          {activeTab === "Rules" && (
            <RulesSection
              fields={allResolvedFields}
              rules={rules}
              onChange={setRules}
            />
          )}

          {activeTab === "Links" && (
            <div className="space-y-3">
              <p className="text-sm text-foreground/60">
                Links sent to qualified applicants at the end of the chat.
              </p>
              {links.map((link, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Label"
                    value={link.label}
                    onChange={(e) => {
                      const next = [...links];
                      next[i] = { ...next[i], label: e.target.value };
                      setLinks(next);
                    }}
                    className="w-32 rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm focus:border-teal-700/40 focus:outline-none"
                  />
                  <input
                    type="url"
                    placeholder="https://…"
                    value={link.url}
                    onChange={(e) => {
                      const next = [...links];
                      next[i] = { ...next[i], url: e.target.value };
                      setLinks(next);
                    }}
                    className="flex-1 rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm focus:border-teal-700/40 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setLinks(links.filter((_, j) => j !== i))}
                    className="text-foreground/30 hover:text-red-500"
                    aria-label="Remove link"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setLinks([...links, { label: "", url: "" }])}
                className="text-sm text-teal-700 hover:underline"
              >
                + Add link
              </button>
            </div>
          )}

          {activeTab === "AI Behavior" && (
            <div className="space-y-6">
              {/* Behavioral settings */}
              <div className="space-y-4 rounded-lg border border-foreground/8 bg-white p-5">
                <h3 className="text-sm font-medium text-foreground/80">Conversation controls</h3>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground/60">
                      Off-topic limit
                    </label>
                    <p className="text-[11px] text-foreground/35">
                      Consecutive off-topic messages before auto-rejection. 0 = unlimited.
                    </p>
                    <input
                      type="number"
                      min={0}
                      value={aiInstructions.offTopicLimit ?? 3}
                      onChange={(e) =>
                        setAiInstructions((prev) => ({
                          ...prev,
                          offTopicLimit: Math.max(0, parseInt(e.target.value) || 0),
                        }))
                      }
                      className="w-24 rounded-lg border border-foreground/10 px-3 py-2 text-sm focus:border-teal-700/40 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground/60">
                      Post-qualified follow-ups
                    </label>
                    <p className="text-[11px] text-foreground/35">
                      Messages allowed after qualification. 0 = close immediately.
                    </p>
                    <input
                      type="number"
                      min={0}
                      value={aiInstructions.qualifiedFollowUps ?? 3}
                      onChange={(e) =>
                        setAiInstructions((prev) => ({
                          ...prev,
                          qualifiedFollowUps: Math.max(0, parseInt(e.target.value) || 0),
                        }))
                      }
                      className="w-24 rounded-lg border border-foreground/10 px-3 py-2 text-sm focus:border-teal-700/40 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground/60">
                    Unknown info handling
                  </label>
                  <p className="text-[11px] text-foreground/35">
                    When an applicant asks about something not in the description.
                  </p>
                  <div className="flex gap-4 pt-1">
                    <label className="flex items-center gap-2 text-sm text-foreground/70">
                      <input
                        type="radio"
                        name="unknownInfo"
                        checked={(aiInstructions.unknownInfoBehavior ?? "deflect") === "deflect"}
                        onChange={() =>
                          setAiInstructions((prev) => ({ ...prev, unknownInfoBehavior: "deflect" }))
                        }
                        className="accent-teal-700"
                      />
                      Say &quot;I don&apos;t know, contact landlord&quot;
                    </label>
                    <label className="flex items-center gap-2 text-sm text-foreground/70">
                      <input
                        type="radio"
                        name="unknownInfo"
                        checked={aiInstructions.unknownInfoBehavior === "ignore"}
                        onChange={() =>
                          setAiInstructions((prev) => ({ ...prev, unknownInfoBehavior: "ignore" }))
                        }
                        className="accent-teal-700"
                      />
                      Redirect to screening
                    </label>
                  </div>
                </div>
              </div>

              {/* Style instructions */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/80">
                  Style instructions
                </label>
                <p className="text-xs text-foreground/40">
                  Tell the AI how to behave — tone, formatting, how to handle specific situations.
                </p>
                <textarea
                  rows={5}
                  value={aiInstructions.style}
                  onChange={(e) =>
                    setAiInstructions((prev) => ({ ...prev, style: e.target.value }))
                  }
                  placeholder="e.g. Be concise. Use a friendly but professional tone. If the applicant asks about parking, mention the garage."
                  className="w-full resize-none rounded-lg border border-foreground/10 bg-white px-4 py-3 text-sm text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                />
              </div>

              {/* Example Q&A pairs */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-foreground/80">
                      Example conversations
                    </label>
                    <p className="text-xs text-foreground/40">
                      Show the AI how you want it to respond in specific scenarios.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setAiInstructions((prev) => ({
                        ...prev,
                        examples: [...(prev.examples ?? []), { user: "", assistant: "" }],
                      }))
                    }
                    className="text-sm text-teal-700 hover:underline"
                  >
                    + Add example
                  </button>
                </div>

                {(aiInstructions.examples ?? []).length === 0 && (
                  <p className="text-sm text-foreground/30">No examples yet.</p>
                )}

                {(aiInstructions.examples ?? []).map((ex, i) => (
                  <div
                    key={i}
                    className="space-y-2 rounded-lg border border-foreground/8 bg-white p-4"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/35">
                        Example {i + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setAiInstructions((prev) => ({
                            ...prev,
                            examples: (prev.examples ?? []).filter((_, j) => j !== i),
                          }))
                        }
                        className="text-xs text-foreground/30 hover:text-red-500"
                      >
                        Remove
                      </button>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-foreground/50">
                        Tenant says:
                      </label>
                      <input
                        type="text"
                        value={ex.user}
                        onChange={(e) => {
                          const next = [...(aiInstructions.examples ?? [])];
                          next[i] = { ...next[i], user: e.target.value };
                          setAiInstructions((prev) => ({ ...prev, examples: next }));
                        }}
                        placeholder="e.g. Is the apartment pet-friendly?"
                        className="w-full rounded-lg border border-foreground/10 bg-foreground/[0.02] px-3 py-2 text-sm focus:border-teal-700/40 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-foreground/50">
                        AI should respond:
                      </label>
                      <textarea
                        rows={2}
                        value={ex.assistant}
                        onChange={(e) => {
                          const next = [...(aiInstructions.examples ?? [])];
                          next[i] = { ...next[i], assistant: e.target.value };
                          setAiInstructions((prev) => ({ ...prev, examples: next }));
                        }}
                        placeholder="e.g. We do allow small pets with a $500 deposit. Do you have any pets?"
                        className="w-full resize-none rounded-lg border border-foreground/10 bg-foreground/[0.02] px-3 py-2 text-sm focus:border-teal-700/40 focus:outline-none"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Footer actions */}
        <section className="flex items-center justify-between border-t border-foreground/10 pt-6">
          <p className="text-sm text-foreground/50">
            {resolvedFieldCount} question{resolvedFieldCount !== 1 ? "s" : ""} ·{" "}
            {rules.length} rule{rules.length !== 1 ? "s" : ""}
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="rounded-lg border border-foreground/10 px-4 py-2 text-sm text-foreground/60 transition-colors hover:bg-white disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={async () => {
                await save();
                router.push(`/chat/${id}`);
              }}
              className="rounded-lg bg-teal-700 px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              Preview chat →
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
