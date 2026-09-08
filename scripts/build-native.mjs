// Sprint 7.5 — native iOS shell build pipeline.
//
// The static export cannot include the server API routes (POST handlers are
// unsupported in `output: 'export'`), and they are E2E-only anyway — the
// native app talks to Supabase over HTTPS. So this script:
//   1. temporarily moves src/app/api aside
//   2. runs `next build` with NATIVE_SHELL=1 (static export → ./out)
//   3. always restores src/app/api
// The web build (`npm run build`) is never affected.

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const apiDir = join(root, 'src', 'app', 'api');
const stashDir = join(root, '.api-stash-native-build');

function restore() {
  if (existsSync(stashDir)) {
    if (existsSync(apiDir)) rmSync(apiDir, { recursive: true, force: true });
    renameSync(stashDir, apiDir);
  }
}

process.on('exit', restore);
process.on('SIGINT', () => {
  restore();
  process.exit(130);
});
process.on('SIGTERM', () => {
  restore();
  process.exit(143);
});

mkdirSync(root, { recursive: true });
if (existsSync(stashDir)) rmSync(stashDir, { recursive: true, force: true });
renameSync(apiDir, stashDir);

try {
  execSync('npx next build', {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NATIVE_SHELL: '1' },
  });
} finally {
  restore();
}
console.log('\n[native] static export ready in ./out');