"use client";

import { useState, useTransition } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

export function DeleteButton({
  action,
  id,
  title,
}: {
  action: (formData: FormData) => Promise<void>;
  id: string;
  title: string;
}) {
  const [pending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);

  function handleConfirm() {
    setDialogOpen(false);
    const fd = new FormData();
    fd.set("id", id);
    startTransition(() => action(fd));
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => setDialogOpen(true)}
        className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50"
      >
        {pending ? "…" : "Delete"}
      </button>
      <ConfirmDialog
        open={dialogOpen}
        title={`Delete "${title}"?`}
        description="This property and all its settings will be permanently removed."
        confirmLabel="Delete"
        destructive
        onConfirm={handleConfirm}
        onCancel={() => setDialogOpen(false)}
      />
    </>
  );
}
