"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createNewProperty } from "@/app/actions";

export function NewPropertyButton() {
  const [modalOpen, setModalOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (modalOpen && !el.open) {
      setTitle("");
      el.showModal();
    } else if (!modalOpen && el.open) {
      el.close();
    }
  }, [modalOpen]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Please enter a property name");
      return;
    }
    
    setPending(true);
    const fd = new FormData();
    fd.set("title", title.trim());
    
    try {
      const res = await createNewProperty(fd);
      router.push(`/property/${res.id}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to create property. The name might already be taken.");
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="flex items-center gap-1.5 rounded-lg bg-teal-800 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        New Property
      </button>

      <dialog
        ref={dialogRef}
        onClose={() => !pending && setModalOpen(false)}
        className="fixed inset-0 z-50 m-auto max-w-sm rounded-xl border border-black/8 bg-white p-0 shadow-xl backdrop:bg-black/40"
      >
        <form onSubmit={handleSubmit} className="p-6">
          <h3 className="text-sm font-semibold text-[#1a2e2a]">New Property</h3>
          <p className="mt-2 text-sm text-[#1a2e2a]/60">
            Enter a unique name for this property. This will be used in the chat link.
          </p>
          <div className="mt-4">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. 123 Main St"
              autoFocus
              disabled={pending}
              className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm focus:border-teal-700/40 focus:outline-none focus:ring-2 focus:ring-teal-700/20 disabled:opacity-60"
            />
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              disabled={pending}
              className="rounded-lg border border-black/10 px-4 py-2 text-sm text-[#1a2e2a]/60 transition-colors hover:bg-[#f7f9f8] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending || !title.trim()}
              className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
