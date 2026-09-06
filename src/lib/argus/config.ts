// Single source of truth for the AI identity + feature flag.
// EVERY UI copy reference must import from here — the acceptance gate greps
// for hardcoded identity strings anywhere else in src/.

export const AI_NAME = 'Argus' as const;

/**
 * Master switch. `NEXT_PUBLIC_ARGUS_ENABLED=false` removes every AI surface
 * (hub, suggestion cards, badges, banners, settings section) and the app
 * behaves exactly as Sprint 4. Default is enabled.
 */
export const ARGUS_ENABLED: boolean = process.env.NEXT_PUBLIC_ARGUS_ENABLED !== 'false';

/** Tracked in every generation audit row; bump on prompt-contract changes. */
export const PROMPT_VERSION = 'argus-v1';

/** Online-only provider config. No key → the deterministic mock adapter. */
export const AI_PROVIDER_DEFAULT = 'anthropic' as const;

export function aiApiKey(): string | null {
  return process.env.NEXT_PUBLIC_AI_API_KEY ?? null;
}