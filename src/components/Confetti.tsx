// Sprint 7.8 — one-shot confetti burst (level-up, quest sweep, celebration).
// CSS-only, fires once per mount, 400ms, never loops. Reduced motion: static
// (renders nothing). Deterministic per-index geometry — no Math.random.

const COLORS = ['var(--color-accent)', 'var(--color-gold)', 'var(--color-ink)'];
const PIECES = 24;

export default function Confetti({ testid = 'confetti' }: { testid?: string }) {
  return (
    <div
      data-testid={testid}
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {Array.from({ length: PIECES }).map((_, i) => {
        // Deterministic spread across the top edge; three fall lanes.
        const left = (i * 97) % 100; // 0–99%
        const lane = i % 3;
        const delay = lane * 60;
        const drift = ((i * 37) % 21) - 10; // -10..10 px horizontal drift
        return (
          <span
            key={i}
            className="confetti-piece"
            style={{
              left: `${left}%`,
              background: COLORS[i % COLORS.length],
              animationDelay: `${delay}ms`,
              ['--confetti-x' as string]: `${drift}px`,
            }}
          />
        );
      })}
    </div>
  );
}