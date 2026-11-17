import { type ChildProcess, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fixture, PREFIX } from './helpers';

/**
 * Starts the background worker (it has no HTTP port, so Playwright's webServer
 * can't manage it) so emails are delivered to Mailpit during the run.
 * The API and web dev server are started by playwright.config.ts.
 */
export default async function globalSetup() {
  fixture('cleanup', PREFIX);
  let worker: ChildProcess | undefined;
  if (!process.env['E2E_EXTERNAL_WORKER']) {
    worker = spawn(process.execPath, ['dist/worker.js'], {
      cwd: resolve(import.meta.dirname, '../../../apps/api'),
      env: { ...process.env, LOG_LEVEL: 'warn' },
      stdio: 'inherit',
    });
  }
  return async () => {
    worker?.kill();
    fixture('cleanup', PREFIX);
  };
}
