import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { PropertyRecord } from "@/lib/property";
import { createNewProperty } from "@/app/actions";
import { PropertyCardActions } from "@/app/components/PropertyCardActions";

export default async function PropertiesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: properties } = await supabase
    .from("properties")
    .select("id,title,description,fields,questions,rules,published_at,created_at,updated_at")
    .order("created_at", { ascending: false });

  const list = (properties as PropertyRecord[] | null) ?? [];

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1a2e2a]">Properties</h1>
          <p className="mt-1 text-sm text-[#1a2e2a]/50">Manage your screening chatbots</p>
        </div>
        <form action={createNewProperty}>
          <button
            type="submit"
            className="flex items-center gap-1.5 rounded-lg bg-teal-800 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            New Property
          </button>
        </form>
      </div>

      {list.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-black/15 py-20 text-center">
          <p className="text-sm font-medium text-[#1a2e2a]/50">No properties yet</p>
          <p className="mt-1 text-xs text-[#1a2e2a]/35">Click &quot;New Property&quot; to get started</p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((p) => {
            const fieldCount = (p.fields ?? []).length;
            const questionCount = (p.questions ?? []).length;
            const ruleCount = p.rules?.length ?? 0;
            const desc = (p.description ?? "").trim();
            const updatedAt = p.updated_at ?? p.created_at;
            const relTime = updatedAt ? timeAgo(updatedAt) : null;
            const isPublished = !!p.published_at;

            return (
              <div
                key={p.id}
                className="group rounded-xl border border-black/8 bg-white shadow-sm transition-shadow hover:shadow-md"
              >
                <Link
                  href={`/property/${p.id}`}
                  className="block px-6 py-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-semibold text-[#1a2e2a] group-hover:text-teal-800 transition-colors">
                          {p.title}
                        </h2>
                        <span
                          className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            isPublished ? "bg-teal-100 text-teal-800" : "bg-black/[0.06] text-[#1a2e2a]/45"
                          }`}
                        >
                          {isPublished ? "Published" : "Draft"}
                        </span>
                      </div>
                      {desc && (
                        <p className="mt-1.5 line-clamp-1 text-sm text-[#1a2e2a]/45">
                          {desc}
                        </p>
                      )}
                      <p className="mt-2 text-xs text-[#1a2e2a]/40">
                        {fieldCount} field{fieldCount !== 1 ? "s" : ""} · {questionCount} question{questionCount !== 1 ? "s" : ""} ·{" "}
                        {ruleCount} rule{ruleCount !== 1 ? "s" : ""}
                        {relTime && (
                          <span className="text-[#1a2e2a]/25"> · updated {relTime}</span>
                        )}
                      </p>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="mt-1 shrink-0 text-[#1a2e2a]/20 transition-colors group-hover:text-teal-700" aria-hidden>
                      <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </Link>
                <div className="flex items-center gap-2 border-t border-black/5 px-6 py-3">
                  {isPublished ? (
                    <Link
                      href={`/chat/${p.id}`}
                      target="_blank"
                      className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium text-[#1a2e2a]/60 transition-colors hover:bg-[#f7f9f8] hover:text-[#1a2e2a]"
                    >
                      Chat
                    </Link>
                  ) : (
                    <span
                      title="Publish this property from the editor to enable applicant chat"
                      className="cursor-not-allowed rounded-lg border border-black/5 px-3 py-1.5 text-xs font-medium text-[#1a2e2a]/30"
                    >
                      Chat
                    </span>
                  )}
                  <Link
                    href={`/applicants?property=${p.id}`}
                    className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium text-[#1a2e2a]/60 transition-colors hover:bg-[#f7f9f8] hover:text-[#1a2e2a]"
                  >
                    Applicants
                  </Link>
                  <PropertyCardActions propertyId={p.id} propertyTitle={p.title} isPublished={isPublished} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
