"use client";

import { toast } from "sonner";

export function CopyLinkButton({ path }: { path: string }) {
  async function copy() {
    const url = `${window.location.origin}${path}`;
    await navigator.clipboard.writeText(url);
    toast.success("Link copied to clipboard");
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium text-[#1a2e2a] transition-colors hover:bg-[#f7f9f8]"
    >
      Copy link
    </button>
  );
}
