"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { PropertyRecord, PropertyLinks, AiInstructions } from "@/lib/property";
import { DEFAULT_AI_INSTRUCTIONS, DEFAULT_LINKS, resolveAiInstructions } from "@/lib/property";
import type { LandlordField } from "@/lib/landlord-field";
import type { LandlordRule } from "@/lib/landlord-rule";
import LandlordFieldsSection from "@/app/components/LandlordFieldsSection";
import RulesSection from "@/app/components/RulesSection";
import { PropertyEditorSkeleton } from "@/app/components/Skeleton";
import { ConfirmDialog } from "@/app/components/ConfirmDialog";

const TABS = ["Questions", "Rules", "Links", "AI Behavior"] as const;

type Tab = (typeof TABS)[number];

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

function migrateRules(rawRules: any[]): LandlordRule[] {
  return rawRules.map((r) => {
    if (r.action) return r as LandlordRule;
    return {
      id: r.id || generateId(),
      action: "reject",
      conditions: [{
        id: generateId(),
        fieldId: r.fieldId || "",
        operator: r.operator || "==",
        value: r.value || ""
      }]
    };
  });
}

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
          className="flex items-center gap-3 rounded-lg border border-foreground/10 bg-[#f7f9f8] px-3 py-2.5"
        >
          <span className="flex-1 text-sm text-foreground/80">{f.label}</span>
          <span className="text-[11px] text-foreground/35">{f.value_kind}</span>
        </div>
      ))}
    </div>
  );
}

export default function PropertySetupPage() {
  const { id } = useParams<{ id: string }>();
  const supabase = createClient();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ownFields, setOwnFields] = useState<LandlordField[]>([]);
  const [rules, setRules] = useState<LandlordRule[]>([]);
  const [links, setLinks] = useState<PropertyLinks>(DEFAULT_LINKS);
  const [aiInstructions, setAiInstructions] = useState<AiInstructions>(DEFAULT_AI_INSTRUCTIONS);

  const [allShared, setAllShared] = useState<LandlordField[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("Questions");
  const [loadingPhase, setLoadingPhase] = useState<null | "fields" | "rules">(null);
  const [saving, setSaving] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [lastSavedRef] = useState(() => ({ current: "" }));
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [deleteFieldDialog, setDeleteFieldDialog] = useState<{ field: LandlordField; linkedRules: string } | null>(null);
  const [pendingDeleteField, setPendingDeleteField] = useState<LandlordField | null>(null);

  const descRef = useRef<HTMLTextAreaElement>(null);

  // Auto-expand description textarea
  useEffect(() => {
    const el = descRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [description]);

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
      const migratedRules = migrateRules((p.rules as any[]) ?? []);
      setOwnFields(p.own_fields ?? []);
      setRules(migratedRules);
      setLinks({ ...DEFAULT_LINKS, ...(p.links as Partial<PropertyLinks>) });
      setAiInstructions(resolveAiInstructions(p.ai_instructions));

      setAllShared((sharedRes.data ?? []) as LandlordField[]);
      lastSavedRef.current = JSON.stringify({ title: p.title, description: p.description, ownFields: p.own_fields ?? [], rules: migratedRules, links: { ...DEFAULT_LINKS, ...(p.links as Partial<PropertyLinks>) }, aiInstructions: resolveAiInstructions(p.ai_instructions) });
      setPageLoading(false);
    }
    void load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (pageLoading) return;
    const current = JSON.stringify({ title, description, ownFields, rules, links, aiInstructions });
    setDirty(current !== lastSavedRef.current);
  }, [title, description, ownFields, rules, links, aiInstructions, pageLoading, lastSavedRef]);

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirty) { e.preventDefault(); }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

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
          links,
          ai_instructions: aiInstructions,
          updated_at: new Date().toISOString(),
          ...overrides,
        })
        .eq("id", id);
      setSaving(false);
      if (error) { console.error("[save]", error); toast.error("Failed to save"); }
      else {
        lastSavedRef.current = JSON.stringify({ title, description, ownFields, rules, links, aiInstructions });
        setDirty(false);
        toast.success("Property saved");
      }
    },
    [id, title, description, ownFields, rules, links, aiInstructions, supabase], // eslint-disable-line react-hooks/exhaustive-deps
  );

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
    if (error) { console.error("[make-shared]", error); toast.error("Failed to make shared"); return; }

    setOwnFields((prev) => prev.filter((f) => f.id !== field.id));
    setAllShared((prev) => prev.some((f) => f.id === field.id) ? prev : [...prev, field]);
  }

  function requestGenerate() {
    if (!description.trim()) return;
    if (ownFields.length > 0 || rules.length > 0) {
      setGenerateDialogOpen(true);
      return;
    }
    void doGenerate();
  }

  async function doGenerate() {
    setGenerateDialogOpen(false);
    if (!description.trim()) return;
    try {
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

      setLoadingPhase("rules");
      const resolvedFields = [...allShared, ...newFields];
      const rulesRes = await fetch("/api/generate-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, fields: resolvedFields }),
      });
      const rulesData = (await rulesRes.json()) as { rules?: LandlordRule[] };
      setRules(migrateRules(rulesData.rules ?? []));
      toast.success("Questions and rules generated — review them, then save and share!");
    } catch (err) {
      console.error("[generate]", err);
      toast.error("Generation failed — please try again");
    } finally {
      setLoadingPhase(null);
    }
  }

  if (pageLoading) {
    return <PropertyEditorSkeleton />;
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-32">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  const allResolvedFields = [...allShared, ...ownFields].filter(
    (f, i, arr) => arr.findIndex((x) => x.id === f.id) === i,
  );
  const resolvedFieldCount = allResolvedFields.length;

  const isNew = !description.trim() && ownFields.length === 0 && rules.length === 0;

  async function copyShareLink() {
    const url = `${window.location.origin}/chat/${id}`;
    await navigator.clipboard.writeText(url);
    toast.success("Chat link copied — share it with applicants");
  }

  return (
    <>
      {/* ── Sticky sub-header ─────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 border-b border-black/8 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <Link href="/" className="shrink-0 text-[#1a2e2a]/45 transition-colors hover:text-[#1a2e2a]">
              Properties
            </Link>
            <span className="text-[#1a2e2a]/20">/</span>
            <span className="truncate font-medium text-[#1a2e2a]">
              {title || "Untitled"}
            </span>
            <span className="ml-1 text-xs text-[#1a2e2a]/30">
              {resolvedFieldCount} question{resolvedFieldCount !== 1 ? "s" : ""} · {rules.length} rule{rules.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void copyShareLink()}
              className="flex items-center gap-1.5 rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium text-[#1a2e2a]/50 transition-colors hover:bg-[#f7f9f8] hover:text-[#1a2e2a]"
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M10.5 5h-1a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v0a2 2 0 0 0-2-2ZM4.5 5h-1a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v0a2 2 0 0 0-2-2ZM5 7h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              Share link
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${
                dirty
                  ? "border-teal-700/30 bg-teal-50 text-teal-800 hover:bg-teal-100"
                  : "border-black/10 text-[#1a2e2a]/50 hover:bg-[#f7f9f8]"
              }`}
            >
              {saving ? "Saving…" : dirty ? "Save*" : "Save"}
            </button>
            <button
              type="button"
              onClick={async () => {
                await save();
                window.open(`/chat/${id}`, "_blank");
              }}
              className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
            >
              Preview →
            </button>
          </div>
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">

        {/* Onboarding guide — visible only for fresh properties */}
        {isNew && (
          <section className="rounded-xl border border-teal-200 bg-teal-50/60 p-5">
            <h2 className="text-sm font-semibold text-teal-900">Quick setup</h2>
            <ol className="mt-2 space-y-1.5 text-sm text-teal-800/70">
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-700 text-[10px] font-bold text-white">1</span>
                Name your property and paste the listing description below
              </li>
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-700 text-[10px] font-bold text-white">2</span>
                Click <strong>Generate with AI</strong> — it creates screening questions and eligibility rules automatically
              </li>
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-700 text-[10px] font-bold text-white">3</span>
                Review, save, then click <strong>Share link</strong> in the header to send applicants your screening chat
              </li>
            </ol>
          </section>
        )}

        {/* Property details card */}
        <section className="rounded-xl border border-black/8 bg-white shadow-sm">
          <div className="space-y-4 p-6">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1a2e2a]/40">
              Property details
            </h2>
            <input
              type="text"
              placeholder="Property title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-foreground/10 bg-[#f7f9f8] px-4 py-2.5 text-base font-semibold text-foreground placeholder:font-normal placeholder:text-foreground/30 focus:border-teal-700/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-700/20"
            />
            <textarea
              ref={descRef}
              placeholder="Describe your property — rent, rules, requirements, pet policy, lease length, etc."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !loadingPhase) {
                  e.preventDefault();
                  requestGenerate();
                }
              }}
              className="min-h-[120px] w-full resize-none overflow-hidden rounded-lg border border-foreground/10 bg-[#f7f9f8] px-4 py-3 text-sm text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-700/20"
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={requestGenerate}
                disabled={!description.trim() || loadingPhase !== null}
                className="flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path d="M7 1v3M7 10v3M1 7h3M10 7h3M2.75 2.75l2.12 2.12M9.13 9.13l2.12 2.12M11.25 2.75l-2.12 2.12M4.87 9.13l-2.12 2.12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                {loadingPhase === "fields"
                  ? "Generating questions…"
                  : loadingPhase === "rules"
                    ? "Generating rules…"
                    : "Generate with AI"}
              </button>
            </div>
          </div>
        </section>

        {/* Configuration card */}
        <section className="rounded-xl border border-black/8 bg-white shadow-sm">
          {/* Tab bar */}
          <div className="flex gap-1 border-b border-black/5 px-6 pt-1">
            {TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-3 text-sm font-medium transition-colors ${
                  activeTab === tab
                    ? "border-b-2 border-teal-700 text-teal-700"
                    : "text-foreground/45 hover:text-foreground/70"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="p-6">
            {activeTab === "Questions" && (
              <div className="space-y-8">
                {/* Shared questions */}
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
                      {allShared.length} question{allShared.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <SharedFieldsList allShared={allShared} />
                </div>

                {/* Property-specific questions */}
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
                    allFields={allResolvedFields}
                    rules={rules}
                    onRulesChange={setRules}
                    onBeforeDelete={(field) => {
                      const linked = rules.filter((r) => r.conditions.some(c => c.fieldId === field.id) || r.targetFieldId === field.id);
                      if (linked.length === 0) return true;
                      setPendingDeleteField(field);
                      setDeleteFieldDialog({ field, linkedRules: `${linked.length} linked rule(s)` });
                      return false;
                    }}
                    fieldAction={(field) => (
                      <button
                        type="button"
                        onClick={() => void makeShared(field)}
                        className="rounded-md border border-foreground/10 px-2 py-1 text-[11px] font-medium text-foreground/45 transition-colors hover:border-teal-700/30 hover:bg-teal-50 hover:text-teal-700"
                      >
                        Make shared
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
              <div className="space-y-5">
                <p className="text-sm text-foreground/60">
                  Shared with qualified applicants at the end of the screening.
                </p>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground/60">
                    Video tour link
                  </label>
                  <input
                    type="url"
                    placeholder="https://…"
                    value={links.videoUrl}
                    onChange={(e) => setLinks((prev) => ({ ...prev, videoUrl: e.target.value }))}
                    className="w-full rounded-lg border border-foreground/10 bg-[#f7f9f8] px-3 py-2 text-sm focus:border-teal-700/40 focus:bg-white focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground/60">
                    Booking link
                  </label>
                  <input
                    type="url"
                    placeholder="https://…"
                    value={links.bookingUrl}
                    onChange={(e) => setLinks((prev) => ({ ...prev, bookingUrl: e.target.value }))}
                    className="w-full rounded-lg border border-foreground/10 bg-[#f7f9f8] px-3 py-2 text-sm focus:border-teal-700/40 focus:bg-white focus:outline-none"
                  />
                </div>
              </div>
            )}

            {activeTab === "AI Behavior" && (
              <div className="space-y-6">
                <div className="space-y-4 rounded-lg border border-foreground/8 bg-[#f7f9f8] p-5">
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
                        className="w-24 rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm focus:border-teal-700/40 focus:outline-none"
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
                        className="w-24 rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm focus:border-teal-700/40 focus:outline-none"
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

                <div className="space-y-4 rounded-lg border border-foreground/8 bg-[#f7f9f8] p-5">
                  <h3 className="text-sm font-medium text-foreground/80">Eligibility responses</h3>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground/60">
                      First concern (clarification)
                    </label>
                    <p className="text-[11px] text-foreground/35">
                      How the AI should respond when an applicant first fails a rule.
                    </p>
                    <textarea
                      rows={2}
                      value={aiInstructions.clarificationPrompt}
                      onChange={(e) =>
                        setAiInstructions((prev) => ({ ...prev, clarificationPrompt: e.target.value }))
                      }
                      placeholder="e.g. Let the applicant know their answer doesn't meet the requirement and give them a chance to correct it."
                      className="w-full resize-none rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground/60">
                      Confirmed rejection
                    </label>
                    <p className="text-[11px] text-foreground/35">
                      How the AI should respond when an applicant still fails after clarification.
                    </p>
                    <textarea
                      rows={2}
                      value={aiInstructions.rejectionPrompt}
                      onChange={(e) =>
                        setAiInstructions((prev) => ({ ...prev, rejectionPrompt: e.target.value }))
                      }
                      placeholder="e.g. Let the applicant know they don't meet the requirement, state the reason, and close the conversation."
                      className="w-full resize-none rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:outline-none"
                    />
                  </div>
                </div>

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
                    className="w-full resize-none rounded-lg border border-foreground/10 bg-[#f7f9f8] px-4 py-3 text-sm text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                  />
                </div>

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
                      className="space-y-2 rounded-lg border border-foreground/8 bg-[#f7f9f8] p-4"
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
                          className="w-full rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm focus:border-teal-700/40 focus:outline-none"
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
                          className="w-full resize-none rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm focus:border-teal-700/40 focus:outline-none"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={generateDialogOpen}
        title="Replace existing questions and rules?"
        description={`This will replace your ${ownFields.length} question(s) and ${rules.length} rule(s) with AI-generated ones.`}
        confirmLabel="Replace"
        destructive
        onConfirm={() => void doGenerate()}
        onCancel={() => setGenerateDialogOpen(false)}
      />
      <ConfirmDialog
        open={deleteFieldDialog !== null}
        title={`Delete "${deleteFieldDialog?.field.label ?? ""}"?`}
        description={deleteFieldDialog ? `This will also remove linked rule(s):\n${deleteFieldDialog.linkedRules}` : ""}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (pendingDeleteField) {
            setRules((prev) => prev.filter((r) => !r.conditions.some(c => c.fieldId === pendingDeleteField.id) && r.targetFieldId !== pendingDeleteField.id));
            setOwnFields((prev) => prev.filter((f) => f.id !== pendingDeleteField.id));
          }
          setDeleteFieldDialog(null);
          setPendingDeleteField(null);
        }}
        onCancel={() => { setDeleteFieldDialog(null); setPendingDeleteField(null); }}
      />
    </>
  );
}
