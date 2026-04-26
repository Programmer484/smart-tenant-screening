"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export function ShareLinkModal({
  open,
  propertyId,
  onClose,
}: {
  open: boolean;
  propertyId: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [tenantName, setTenantName] = useState("");

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    if (open) {
      setTenantName(""); // Reset when opened
    }
  }, [open]);

  if (!open) return null;

  async function copyShareLink() {
    let url = `${window.location.origin}/chat/${propertyId}`;
    if (tenantName.trim()) {
      url += `?name=${encodeURIComponent(tenantName.trim())}`;
    }
    await navigator.clipboard.writeText(url);
    toast.success("Chat link copied — share it with applicants");
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="fixed inset-0 z-50 m-auto w-full max-w-md rounded-xl border border-black/8 bg-white p-0 shadow-xl backdrop:bg-black/40"
    >
      <div className="p-6">
        <h3 className="text-base font-semibold text-[#1a2e2a]">Share Link</h3>
        <p className="mt-2 text-sm text-[#1a2e2a]/60">
          Personalize the link for a specific applicant, or leave it blank for a general link.
        </p>
        
        <div className="mt-4">
          <label htmlFor="tenantName" className="mb-1 block text-sm font-medium text-[#1a2e2a]/80">
            Applicant Name (Optional)
          </label>
          <input
            id="tenantName"
            type="text"
            placeholder="e.g. John Doe"
            value={tenantName}
            onChange={(e) => setTenantName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void copyShareLink();
              }
            }}
            className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm placeholder:text-black/30 focus:border-teal-600/40 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
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
            onClick={() => void copyShareLink()}
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Copy Link
          </button>
        </div>
      </div>
    </dialog>
  );
}
