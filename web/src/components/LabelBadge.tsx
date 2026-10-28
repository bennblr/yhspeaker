import { cn } from '../lib/utils';

export function LabelBadge({ label, className }: { label?: string; className?: string }) {
  if (!label) return null;
  return (
    <span
      className={cn(
        'max-w-[9rem] shrink-0 truncate rounded border border-accent/25 bg-accent/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent',
        className,
      )}
      title={label}
    >
      {label}
    </span>
  );
}
