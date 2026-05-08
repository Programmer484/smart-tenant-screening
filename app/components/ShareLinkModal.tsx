"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export function ShareLinkModal({
  open,
  slug,
  onClose,
}: {
  open: boolean;
  slug: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      setName("");
      el.showModal();
    }
    else if (!open && el.open) el.close();
  }, [open]);

  if (!open) return null;

  async function handleCopy() {
    let url = `${window.location.origin}/chat/${slug}`;
    if (name.trim()) {
      url += `?name=${encodeURIComponent(name.trim())}`;
    }
    await navigator.clipboard.writeText(url);
    toast.success("Chat link copied — share it with applicants");
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="fixed inset-0 z-50 m-auto max-w-md rounded-xl border border-black/8 bg-white p-0 shadow-xl backdrop:bg-black/40"
    >
      <div className="p-6">
        <h3 className="text-sm font-semibold text-[#1a2e2a]">Generate Screening Link</h3>
        <p className="mt-2 text-sm text-[#1a2e2a]/60">
          Optionally, enter the applicant's name below to personalize their screening experience.
        </p>
        <div className="mt-4">
          <label className="block text-xs font-medium text-[#1a2e2a]/80 mb-1">
            Applicant Name (Optional)
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. John Doe"
            autoFocus
            className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm focus:border-teal-700/40 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleCopy();
              }
            }}
          />
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-black/10 px-4 py-2 text-sm text-[#1a2e2a]/60 transition-colors hover:bg-[#f7f9f8]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Copy Link
          </button>
        </div>
      </div>
    </dialog>
  );
}
