/**
 * Hub server security & billing-integrity regression suite.
 *
 * Run with: npm test
 *
 * Each of these tests corresponds to a vulnerability that was live in the hub:
 * unauthenticated order entry, unauthenticated bill clearing, unauthenticated
 * revenue disclosure, wildcard CORS, and client-controlled pricing. They exist so
 * those cannot silently come back.
 *
 * The suite boots a real hub against a throwaway data directory -- it never
 * touches hub_server/data.
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, '..', 'server.js');

const PORT = 4599;
const BASE = `http://127.0.0.1:${PORT}`;
const ENROLLMENT_CODE = 'TESTCODE';
const RESTAURANT_ID = '11111111-1111-1111-1111-111111111111';

let child;
let dataDir;
let token;

const MENU = {
  restaurant_id: RESTAURANT_ID,
  categories: ['Starters'],
  items: [
    { id: 'm1', name: 'Paneer Tikka', price: 230, category: 'Starters', isVeg: true, available: true },
    { id: 'm2', name: 'Chicken Sukka', price: 220, category: 'Starters', isVeg: false, available: true },
    { id: 'm3', name: 'Sold Out Dish', price: 100, category: 'Starters', isVeg: true, available: false }
  ]
};

const TABLES = {
  restaurant_id: RESTAURANT_ID,
  tables: [
    { id: 1, name: 'T1', section: 'Main Hall', capacity: 4 },
    { id: 2, name: 'T2', section: 'Main Hall', capacity: 4 }
  ]
};

function api(pathname, { auth = false, ...opts } = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (auth) headers.Authorization = `Bearer ${token}`;
  return fetch(`${BASE}${pathname}`, { ...opts, headers });
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-test-'));
  fs.writeFileSync(path.join(dataDir, 'menu_cache.json'), JSON.stringify(MENU));
  fs.writeFileSync(path.join(dataDir, 'tables_cache.json'), JSON.stringify(TABLES));
  fs.writeFileSync(path.join(dataDir, 'tickets.json'), '[]');
  fs.writeFileSync(path.join(dataDir, 'sync_queue.json'), '[]');
  fs.writeFileSync(path.join(dataDir, 'hub_config.json'), JSON.stringify({
    paired: true,
    restaurant_id: RESTAURANT_ID,
    name: 'Test Kitchen',
    pairing_code: 'TST-0001',
    city: 'Nagpur',
    enrollment_code: ENROLLMENT_CODE,
    devices: []
  }));

  child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: String(PORT),
      HUB_DATA_DIR: dataDir,
      // Act as a remote handset rather than the trusted local KDS.
      HUB_TRUST_LOOPBACK: 'false',
      SUPABASE_URL: 'https://example.supabase.co'
    },
    stdio: 'ignore'
  });

  // Wait for the port to accept connections.
  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      await fetch(`${BASE}/pairing-info`);
      break;
    } catch {
      if (Date.now() > deadline) throw new Error('hub server did not start');
      await new Promise(r => setTimeout(r, 200));
    }
  }
});

after(() => {
  if (child) child.kill();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// C2 — device authentication
// ---------------------------------------------------------------------------

test('C2: unauthenticated order entry is refused', async () => {
  const res = await api('/orders', {
    method: 'POST',
    body: JSON.stringify({ table_id: 1, table_name: 'T1', items: [{ id: 'm1', qty: 1 }] })
  });
  assert.equal(res.status, 401);
});

test('C2: unauthenticated bill clearing is refused', async () => {
  const res = await api('/tables/1/clear', { method: 'POST' });
  assert.equal(res.status, 401);
});

test('C2: unauthenticated revenue disclosure is refused', async () => {
  const res = await api('/dashboard-data');
  assert.equal(res.status, 401);
});

test('C2: /pairing-info stays public but leaks no credentials', async () => {
  const res = await api('/pairing-info');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.name, 'Test Kitchen');
  assert.equal(body.enrollment_code, undefined, 'enrollment code must not be served over the LAN');
  assert.equal(body.pairing_code, undefined, 'pairing code must not be served over the LAN');
  assert.equal(body.devices, undefined, 'device tokens must not be served over the LAN');
});

test('C2: a wrong enrollment code is refused', async () => {
  const res = await api('/auth/device', {
    method: 'POST',
    body: JSON.stringify({ enrollment_code: 'WRONGCODE' })
  });
  assert.equal(res.status, 401);
});

test('C2: the correct enrollment code issues a working token', async () => {
  const res = await api('/auth/device', {
    method: 'POST',
    body: JSON.stringify({ enrollment_code: ENROLLMENT_CODE, device_label: 'Test handset' })
  });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.ok(body.device_token, 'expected a device token');
  token = body.device_token;

  const authed = await api('/dashboard-data', { auth: true });
  assert.equal(authed.status, 200, 'token should unlock protected endpoints');
});

test('C2: CORS does not allow arbitrary web origins', async () => {
  const res = await api('/pairing-info', { headers: { Origin: 'https://evil.example' } });
  assert.notEqual(
    res.headers.get('access-control-allow-origin'),
    '*',
    'wildcard CORS lets any website drive the POS'
  );
  assert.notEqual(res.headers.get('access-control-allow-origin'), 'https://evil.example');
});

// ---------------------------------------------------------------------------
// C3 — billing integrity
// ---------------------------------------------------------------------------

test('C3: client-supplied prices are ignored in favour of the hub menu', async () => {
  const res = await api('/orders', {
    auth: true,
    method: 'POST',
    body: JSON.stringify({
      table_id: 1,
      table_name: 'T1',
      items: [{ id: 'm1', name: 'Free Lunch', qty: 2, price: 0.01 }]
    })
  });

  assert.equal(res.status, 201);
  const { ticket } = await res.json();

  assert.equal(ticket.items[0].price, 230, 'price must come from the hub menu');
  assert.equal(ticket.items[0].name, 'Paneer Tikka', 'name must come from the hub menu');
  assert.equal(ticket.total_amount, 460, 'total must be recomputed server-side');
});

test('C3: items that are not on the menu are rejected', async () => {
  const res = await api('/orders', {
    auth: true,
    method: 'POST',
    body: JSON.stringify({
      table_id: 1,
      table_name: 'T1',
      items: [{ id: 'not-a-real-item', name: 'Injected', qty: 1, price: 5 }]
    })
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'INVALID_ITEMS');
});

test('C3: unavailable items are rejected', async () => {
  const res = await api('/orders', {
    auth: true,
    method: 'POST',
    body: JSON.stringify({ table_id: 1, table_name: 'T1', items: [{ id: 'm3', qty: 1 }] })
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.details[0].reason, 'ITEM_UNAVAILABLE');
});

test('C3: invalid quantities are rejected', async () => {
  for (const qty of [0, -5, 1000, 'abc']) {
    const res = await api('/orders', {
      auth: true,
      method: 'POST',
      body: JSON.stringify({ table_id: 1, table_name: 'T1', items: [{ id: 'm1', qty }] })
    });
    assert.equal(res.status, 400, `qty ${qty} should be rejected`);
  }
});

// ---------------------------------------------------------------------------
// Regression — the happy path still works end to end
// ---------------------------------------------------------------------------

test('order -> ready -> clear still works for an enrolled device', async () => {
  const created = await api('/orders', {
    auth: true,
    method: 'POST',
    body: JSON.stringify({ table_id: 2, table_name: 'T2', items: [{ id: 'm2', qty: 3 }] })
  });
  assert.equal(created.status, 201);
  const { ticket } = await created.json();
  assert.equal(ticket.total_amount, 660);

  const ready = await api(`/orders/${ticket.id}/ready`, { auth: true, method: 'POST' });
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).ticket.status, 'ready');

  const cleared = await api('/tables/2/clear', { auth: true, method: 'POST' });
  assert.equal(cleared.status, 200);
  assert.equal((await cleared.json()).cleared_count, 1);
});

test('idempotency still returns the original ticket for a repeated request id', async () => {
  const payload = JSON.stringify({
    order_request_id: 'req_fixed_for_test',
    table_id: 1,
    table_name: 'T1',
    items: [{ id: 'm1', qty: 1 }]
  });

  const first = await api('/orders', { auth: true, method: 'POST', body: payload });
  const second = await api('/orders', { auth: true, method: 'POST', body: payload });

  const a = await first.json();
  const b = await second.json();

  assert.equal(b.duplicate, true);
  assert.equal(b.ticket.ticket_number, a.ticket.ticket_number);
});
