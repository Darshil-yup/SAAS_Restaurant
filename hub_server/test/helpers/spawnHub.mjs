import { spawn } from 'node:child_process';
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
  fs.writeFileSync(path.join(dataDir, 'menu_cache.json'), JSON.stringify(menu));
  fs.writeFileSync(path.join(dataDir, 'tables_cache.json'), JSON.stringify(tables));
  fs.writeFileSync(path.join(dataDir, 'tickets.json'), '[]');
  fs.writeFileSync(path.join(dataDir, 'sync_queue.json'), '[]');
  fs.writeFileSync(path.join(dataDir, 'hub_config.json'), JSON.stringify({
    paired: true,
    restaurant_id: RESTAURANT_ID,
    name: 'Test Kitchen',
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
    stdio: 'ignore'
  });

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      await fetch(`${base}/pairing-info`);
      break;
    } catch {
      if (Date.now() > deadline) throw new Error('hub server did not start');
      await sleep(200);
    }
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
