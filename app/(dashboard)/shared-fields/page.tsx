"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { LandlordField } from "@/lib/landlord-field";
import LandlordFieldsSection from "@/app/components/LandlordFieldsSection";
import { SharedFieldsSkeleton } from "@/app/components/Skeleton";

export default function SharedFieldsPage() {
  const supabase = createClient();
  const [fields, setFields] = useState<LandlordField[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("shared_fields")
        .select("*")
        .order("sort_order");

      setFields((data ?? []) as LandlordField[]);
      setLoading(false);
    }
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const rows = fields.map((f, i) => ({
        id: f.id,
        user_id: user.id,
        label: f.label,
        value_kind: f.value_kind,
        collect_hint: f.collect_hint ?? null,
        options: f.options ?? null,
        sort_order: i,
      }));

      const { error: delErr } = await supabase
        .from("shared_fields").delete().eq("user_id", user.id);
      if (delErr) { console.error("[shared-fields] delete:", delErr); toast.error("Failed to save"); return; }

      if (rows.length > 0) {
        const deduped = [...new Map(rows.map((r) => [r.id, r])).values()];
        const { error: insErr } = await supabase.from("shared_fields").insert(deduped);
        if (insErr) { console.error("[shared-fields] insert:", insErr); toast.error("Failed to save"); return; }
      }
      toast.success("Shared questions saved");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#1a2e2a]">Shared Questions</h1>
          <p className="mt-1 text-sm text-[#1a2e2a]/50">
            These questions appear across all your properties.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {loading ? (
        <SharedFieldsSkeleton />
      ) : (
        <LandlordFieldsSection fields={fields} onChange={setFields} />
      )}
    </div>
  );
}
