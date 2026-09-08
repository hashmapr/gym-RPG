'use client';

import { COLORS } from '@/lib/tokens';

// ChallengeDial — SVG progress ring. Monochrome: white fill on hairline track
// (color is information, not decoration). 48px minimum touch target,
// tabular-nums.

interface Props {
  /** 0..1 (clamped). */
  pct: number;
  size?: number;
  label?: string;
  sub?: string;
  state?: 'active' | 'complete' | 'fail';
}

const STATE_COLORS = {
  active: COLORS.textPrimary,
  complete: COLORS.textPrimary,
  fail: COLORS.textTertiary,
} as const;

export default function ChallengeDial({ pct, size = 72, label, sub, state = 'active' }: Props) {
  const clamped = Math.max(0, Math.min(1, pct));
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = STATE_COLORS[state];

  return (
    <div className="flex flex-col items-center shrink-0" style={{ width: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${Math.round(clamped * 100)}% complete`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={COLORS.border} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x="50%"
          y="50%"
          dominantBaseline="central"
          textAnchor="middle"
          className="fill-ink font-semibold"
          style={{ fontSize: size * 0.24, fontVariantNumeric: 'tabular-nums' }}
        >
          {Math.round(clamped * 100)}%
        </text>
      </svg>
      {label && <span className="mt-1 text-xs text-ink-dim text-center tabular-nums">{label}</span>}
      {sub && <span className="text-[10px] text-ink-faint text-center tabular-nums">{sub}</span>}
    </div>
  );
}