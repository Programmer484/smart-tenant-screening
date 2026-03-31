import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { PropertyRecord } from "@/lib/property";
import { createNewProperty, deleteProperty } from "@/app/actions";
import { DeleteButton } from "./delete-button";
import { CopyLinkButton } from "./copy-link-button";

function StatusBadge({ status }: { status: PropertyRecord["status"] }) {
  return status === "published" ? (
    <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-semibold text-teal-800">
      Published
    </span>
  ) : (
    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-500">
      Draft
    </span>
  );
}

export default async function PropertiesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: properties } = await supabase
    .from("properties")
    .select("id,title,status,own_fields,shared_field_ids,rules,created_at")
    .order("created_at", { ascending: false });

  const list = (properties as PropertyRecord[] | null) ?? [];

  return (
    <div className="min-h-screen bg-[#f7f9f8]">
      {/* Nav */}
      <header className="border-b border-black/8 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-800 text-white">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                <rect x="1" y="6" width="14" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M4 6V4.5a4 4 0 0 1 8 0V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <rect x="6.25" y="9.5" width="3.5" height="2.5" rx="0.75" fill="currentColor" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-[#1a2e2a]">RentScreen</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/applicants"
              className="flex items-center gap-1.5 rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm text-[#1a2e2a]/70 transition-colors hover:bg-[#f7f9f8]"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <circle cx="5" cy="4" r="2.5" stroke="currentColor" strokeWidth="1.3" />
                <path d="M1 12c0-2.21 1.79-4 4-4s4 1.79 4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <path d="M10 6.5a2 2 0 1 0 0-4M13 12c0-1.66-1.12-3.07-2.67-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              All Applicants
            </Link>
            <Link
              href="/shared-fields"
              className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm text-[#1a2e2a]/70 transition-colors hover:bg-[#f7f9f8]"
            >
              Shared Questions
            </Link>
            <form action={createNewProperty}>
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-lg bg-teal-800 px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                New Property
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Body */}
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[#1a2e2a]">Properties</h1>
          <p className="mt-1 text-sm text-[#1a2e2a]/50">Manage your screening chatbots</p>
        </div>

        {list.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-black/15 py-16 text-center">
            <p className="text-sm font-medium text-[#1a2e2a]/50">No properties yet</p>
            <p className="mt-1 text-xs text-[#1a2e2a]/35">Click &quot;New Property&quot; to get started</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((p) => {
              const fieldCount =
                (p.shared_field_ids?.length ?? 0) + (p.own_fields?.length ?? 0);
              const ruleCount = p.rules?.length ?? 0;
              return (
                <div
                  key={p.id}
                  className="rounded-xl border border-black/8 bg-white p-5 shadow-sm"
                >
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <h2 className="text-sm font-semibold leading-snug text-[#1a2e2a]">
                      {p.title}
                    </h2>
                    <StatusBadge status={p.status} />
                  </div>
                  <p className="mb-4 text-xs text-[#1a2e2a]/45">
                    {fieldCount} question{fieldCount !== 1 ? "s" : ""} ·{" "}
                    {ruleCount} rule{ruleCount !== 1 ? "s" : ""}
                  </p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/property/${p.id}`}
                        className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium text-[#1a2e2a] transition-colors hover:bg-[#f7f9f8]"
                      >
                        Edit
                      </Link>
                      <Link
                        href={`/chat/${p.id}`}
                        target="_blank"
                        className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium text-[#1a2e2a] transition-colors hover:bg-[#f7f9f8]"
                      >
                        Test
                      </Link>
                      <CopyLinkButton path={`/chat/${p.id}`} />
                      <Link
                        href={`/applicants?property=${p.id}`}
                        className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium text-[#1a2e2a] transition-colors hover:bg-[#f7f9f8]"
                      >
                        Applicants
                      </Link>
                    </div>
                    <DeleteButton action={deleteProperty} id={p.id} title={p.title} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
