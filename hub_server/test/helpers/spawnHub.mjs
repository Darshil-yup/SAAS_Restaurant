import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'server.js');
export const RESTAURANT_ID = '11111111-1111-1111-1111-111111111111';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Boots a real hub against a throwaway data directory. `trustLoopback: true`
 * makes requests from 127.0.0.1 act as the reception laptop; `false` makes them
 * act as a remote handset that must present a token.
 */
export async function startHub({ port, trustLoopback, menu, tables, enrollmentCode = 'TESTCODE' }) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-catalog-'));
  // Unique per start and served by /pairing-info. The readiness check below only accepts an
  // answer carrying it, so a stale hub already holding the port can never pass for this one.
  const hubName = `Test Kitchen ${crypto.randomUUID()}`;
  fs.writeFileSync(path.join(dataDir, 'menu_cache.json'), JSON.stringify(menu));
  fs.writeFileSync(path.join(dataDir, 'tables_cache.json'), JSON.stringify(tables));
  fs.writeFileSync(path.join(dataDir, 'tickets.json'), '[]');
  fs.writeFileSync(path.join(dataDir, 'sync_queue.json'), '[]');
  fs.writeFileSync(path.join(dataDir, 'hub_config.json'), JSON.stringify({
    paired: true,
    restaurant_id: RESTAURANT_ID,
    name: hubName,
    pairing_code: 'TST-0001',
    city: 'Nagpur',
    enrollment_code: enrollmentCode,
    devices: []
  }));

  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: String(port),
      HUB_DATA_DIR: dataDir,
      HUB_TRUST_LOOPBACK: trustLoopback ? 'true' : 'false',
      SUPABASE_URL: 'https://example.supabase.co'
    },
    // stdout is ignored; the last 2 KB of stderr is kept so a hub that dies at startup can say why.
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderrTail = '';
  child.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk).slice(-2000); });
  let closed = false;
  child.once('close', () => { closed = true; });
  let spawnError = null;
  child.once('error', err => { spawnError = err; });

  const hasExited = () => child.exitCode !== null || child.signalCode !== null;
  const fail = async reason => {
    if (hasExited()) for (let i = 0; i < 10 && !closed; i++) await sleep(50); // let stderr drain
    child.kill();
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    throw new Error(`hub server on port ${port} ${reason}${stderrTail.trim() ? `\n--- hub stderr ---\n${stderrTail.trim()}` : ''}`);
  };

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20000;
  for (;;) {
    if (spawnError) await fail(`could not be started: ${spawnError.message}`);
    // The hub is gone and will never answer. A taken port looks like this (exit code 0 included):
    // the hub's crash handler swallows the EADDRINUSE, so the process just runs out of work and exits.
    if (hasExited()) {
      await fail(`exited during startup (exit code ${child.exitCode ?? child.signalCode}). Is the port already in use?`);
    }
    try {
      const info = await (await fetch(`${base}/pairing-info`)).json();
      if (info?.name === hubName) break;
    } catch {
      // Nothing is listening yet, or what answers is not a hub.
    }
    if (Date.now() > deadline) await fail('did not start within 20 s');
    await sleep(200);
  }

  return {
    base,
    port,
    dataDir,
    stop() {
      child.kill();
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  };
}

/** JSON fetch helper: `call(hub, '/path', { method, body, token })`. */
export function call(hub, pathname, { method = 'GET', body, token } = {}) {
  return fetch(`${hub.base}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}
