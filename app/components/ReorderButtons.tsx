export function ReorderButtons({
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: {
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
}) {
  if (!onMoveUp && !onMoveDown) return null;

  return (
    <div className="shrink-0 flex flex-col items-center justify-center px-1.5 gap-0.5 text-foreground/20 group-hover:text-foreground/40">
      <button
        type="button"
        onClick={onMoveUp}
        disabled={isFirst || !onMoveUp}
        title="Move up"
        aria-label="Move up"
        className="flex h-6 w-6 items-center justify-center rounded hover:bg-black/5 hover:text-foreground/70 disabled:opacity-0 transition-all focus:outline-none"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M12 10L8 6l-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
      <button
        type="button"
        onClick={onMoveDown}
        disabled={isLast || !onMoveDown}
        title="Move down"
        aria-label="Move down"
        className="flex h-6 w-6 items-center justify-center rounded hover:bg-black/5 hover:text-foreground/70 disabled:opacity-0 transition-all focus:outline-none"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
    </div>
  );
}
