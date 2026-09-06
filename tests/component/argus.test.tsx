// Sprint 5 component tests — the /argus hub: render, generate → preview flow,
// offline gating, and the ARGUS_ENABLED kill switch.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import ArgusPage from '@/app/argus/page';
import { db } from '@/lib/db';
import { useSyncStore } from '@/lib/sync/store';
import { setMockMode } from '@/lib/argus/adapter';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/argus',
}));

beforeEach(async () => {
  cleanup();
  localStorage.removeItem('lab.argusMock');
  useSyncStore.setState({ online: true });
  setMockMode('valid');
  await Promise.all([
    db.ai_generation_logs.clear(),
    db.challenge_defs.clear(),
    db.challenge_runs.clear(),
    db.ai_suggestions.clear(),
  ]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('Argus hub', () => {
  it('renders greeting, capabilities, prompt and generate button', () => {
    render(<ArgusPage />);
    expect(screen.getByTestId('argus-title')).toBeInTheDocument();
    expect(screen.getByTestId('argus-greeting')).toHaveTextContent("Hey — I'm");
    const capabilities = screen.getByTestId('capability-list');
    expect(capabilities).toHaveTextContent('Challenge authoring');
    expect(capabilities).toHaveTextContent('Recovery reading');
    expect(screen.getByTestId('argus-prompt')).toBeInTheDocument();
    expect(screen.getByTestId('generate-button')).toBeEnabled();
  });

  it('generate → preview with calibration receipt and policy, no def written yet', async () => {
    render(<ArgusPage />);
    fireEvent.click(screen.getByTestId('generate-button'));
    const preview = await screen.findByTestId('draft-preview');
    expect(preview).toHaveTextContent('Volume Block');
    expect(screen.getByTestId('calibration-receipt')).toHaveTextContent('Calibration receipt');
    expect(screen.getByTestId('preview-policy')).toHaveTextContent('checkpoint(s)');
    expect(screen.getByTestId('confirm-draft')).toBeEnabled();
    expect(screen.getByTestId('discard-draft')).toBeEnabled();
    // Preview only — nothing persisted until confirm.
    expect(await db.challenge_defs.toArray()).toHaveLength(0);
  });

  it('discard clears the preview and audits rejected_user', async () => {
    render(<ArgusPage />);
    fireEvent.click(screen.getByTestId('generate-button'));
    await screen.findByTestId('draft-preview');
    fireEvent.click(screen.getByTestId('discard-draft'));
    await waitFor(() => expect(screen.queryByTestId('draft-preview')).toBeNull());
    const logs = await db.ai_generation_logs.toArray();
    expect(logs.some((l) => l.outcome === 'rejected_user')).toBe(true);
  });

  it('offline gates generation with a note', () => {
    useSyncStore.setState({ online: false });
    render(<ArgusPage />);
    expect(screen.getByTestId('generate-button')).toBeDisabled();
    expect(screen.getByTestId('offline-note')).toHaveTextContent('drafting needs a connection');
  });

  it('ARGUS_ENABLED=false renders the kill-switch message', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_ARGUS_ENABLED', 'false');
    const { default: FlaggedOffPage } = await import('@/app/argus/page');
    render(<FlaggedOffPage />);
    expect(screen.getByText('Not available.')).toBeInTheDocument();
    expect(screen.queryByTestId('argus-title')).toBeNull();
    expect(screen.queryByTestId('generate-button')).toBeNull();
  });
});