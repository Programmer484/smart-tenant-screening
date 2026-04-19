"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { toast } from "sonner";
import { deleteProperty } from "@/app/actions";
import { ConfirmDialog } from "./ConfirmDialog";

export function PropertyCardActions({
  propertyId,
  propertyTitle,
  isPublished = false,
}: {
  propertyId: string;
  propertyTitle: string;
  /** Applicant chat link is only valid after publish. */
  isPublished?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  async function handleCopyLink() {
    setMenuOpen(false);
    if (!isPublished) {
      toast.error("Publish this property before sharing the applicant chat link.");
      return;
    }
    const url = `${window.location.origin}/chat/${propertyId}`;
    await navigator.clipboard.writeText(url);
    toast.success("Link copied to clipboard");
  }

  function handleDelete() {
    setDeleteDialogOpen(false);
    const fd = new FormData();
    fd.set("id", propertyId);
    startTransition(() => deleteProperty(fd));
  }

  return (
    <>
      <div ref={menuRef} className="relative ml-auto">
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); setMenuOpen((o) => !o); }}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[#1a2e2a]/30 transition-colors hover:bg-black/5 hover:text-[#1a2e2a]/60"
          aria-label="More actions"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
            <circle cx="3" cy="7" r="1.25" />
            <circle cx="7" cy="7" r="1.25" />
            <circle cx="11" cy="7" r="1.25" />
          </svg>
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full z-20 mt-1 min-w-[160px] rounded-xl border border-black/8 bg-white py-1 shadow-lg">
            <button
              type="button"
              onClick={() => void handleCopyLink()}
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[#1a2e2a]/70 transition-colors hover:bg-black/[0.03]"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <rect x="4.5" y="4.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                <path d="M9.5 4.5V3a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3v5A1.5 1.5 0 0 0 3 9.5h1.5" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              Copy chat link
            </button>
            <hr className="my-1 border-black/5" />
            <button
              type="button"
              disabled={pending}
              onClick={() => { setMenuOpen(false); setDeleteDialogOpen(true); }}
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M1.5 3.5h11M5 3.5V2a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5m2 0l-.6 8a1.5 1.5 0 0 1-1.5 1.5H5.1a1.5 1.5 0 0 1-1.5-1.5l-.6-8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              {pending ? "Deleting…" : "Delete property"}
            </button>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={deleteDialogOpen}
        title={`Delete "${propertyTitle}"?`}
        description="This property and all its settings will be permanently removed."
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteDialogOpen(false)}
      />
    </>
  );
}
