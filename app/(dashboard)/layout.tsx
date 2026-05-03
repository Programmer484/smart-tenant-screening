import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { signOut } from "@/app/actions";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="min-h-screen bg-[#f7f9f8]">
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
          <nav className="flex items-center gap-3">
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

            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm text-red-400 transition-colors hover:bg-red-50 hover:text-red-500"
              >
                Sign out
              </button>
            </form>
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
