// Sprint 7.8 — designed empty states (friendly, green-accented, one CTA).
// The spec: no challenges → starters teaser + Ghost Division one-liner ·
// no program → builder teaser · no history → first-workout nudge.

import Link from 'next/link';

export default function EmptyState({
  title,
  line,
  cta,
  href,
  testid,
}: {
  title: string;
  line: string;
  cta?: string;
  href?: string;
  testid?: string;
}) {
  return (
    <div
      data-testid={testid}
      className="rounded-2xl border border-border bg-surface px-6 py-8 text-center"
    >
      <div className="mx-auto mb-3 h-2 w-2 rounded-full bg-accent" aria-hidden />
      <p className="text-lg font-extrabold text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-xs text-sm text-ink-dim">{line}</p>
      {cta && href && (
        <Link
          href={href}
          className="btn-chunky mt-5 inline-flex h-12 items-center px-6 text-sm"
        >
          {cta}
        </Link>
      )}
    </div>
  );
}