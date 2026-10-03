import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startHub, call, RESTAURANT_ID } from './helpers/spawnHub.mjs';

const MENU = {
  restaurant_id: RESTAURANT_ID,
  categories: ['Starters'],
  items: [{ id: 'm1', name: 'Paneer Tikka', price: 230, category: 'Starters', isVeg: true, available: true }]
};
const TABLES = {
  restaurant_id: RESTAURANT_ID,
  tables: [
    { id: 1, name: 'T1', section: 'Main Hall', capacity: 4 },
    { id: 2, name: 'T2', section: 'Main Hall', capacity: 4 }
  ]
};

let rec;      // reception: loopback is trusted
let handset;  // remote handset: loopback is NOT trusted, needs a token
let token;

before(async () => {
  rec = await startHub({ port: 4598, trustLoopback: true, menu: MENU, tables: TABLES });
  handset = await startHub({ port: 4597, trustLoopback: false, menu: MENU, tables: TABLES });
  const enrol = await call(handset, '/auth/device', { method: 'POST', body: { enrollment_code: 'TESTCODE', device_label: 'test' } });
  token = (await enrol.json()).device_token;
});

after(() => {
  rec?.stop();
  handset?.stop();
});

const json = async res => res.json();
const menuRev = async () => (await json(await call(rec, '/menu'))).revision;
const tablesRev = async () => (await json(await call(rec, '/tables/layout'))).revision;
const waitFor = async (pred, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    await new Promise(r => setTimeout(r, 25));
  }
  return false;
};

// ---------------------------------------------------------------- reads

test('GET /menu and /tables/layout expose revision, and layout exposes sections', async () => {
  const menu = await json(await call(rec, '/menu'));
  assert.equal(menu.revision, 0);
  const layout = await json(await call(rec, '/tables/layout'));
  assert.equal(layout.revision, 0);
  assert.deepEqual(layout.sections, ['Main Hall']);
});

// ---------------------------------------------------------------- menu items

test('POST /admin/menu/items adds an item, bumps the revision and refuses a stale base', async () => {
  const res = await call(rec, '/admin/menu/items', {
    method: 'POST',
    body: { base_revision: 0, item: { name: 'Masala Chaas', category: 'Beverages', price: 50, isVeg: true, station: 'bar' } }
  });
  assert.equal(res.status, 201);
  const body = await json(res);
  assert.equal(body.success, true);
  assert.equal(body.revision, 1);
  assert.equal(body.item.name, 'Masala Chaas');

  const menu = await json(await call(rec, '/menu'));
  assert.equal(menu.revision, 1);
  assert.ok(menu.items.some(i => i.name === 'Masala Chaas'));
  assert.ok(menu.categories.includes('Beverages'));

  const stale = await call(rec, '/admin/menu/items', {
    method: 'POST',
    body: { base_revision: 0, item: { name: 'Other', category: 'Beverages', price: 5, isVeg: true } }
  });
  assert.equal(stale.status, 409);
  const staleBody = await json(stale);
  assert.equal(staleBody.code, 'STALE_REVISION');
  assert.equal(staleBody.current_revision, 1);

  const missing = await call(rec, '/admin/menu/items', {
    method: 'POST',
    body: { item: { name: 'Other', category: 'Beverages', price: 5, isVeg: true } }
  });
  assert.equal(missing.status, 400);
  assert.equal((await json(missing)).code, 'BASE_REVISION_REQUIRED');

  const invalid = await call(rec, '/admin/menu/items', {
    method: 'POST',
    body: { base_revision: 1, item: { name: '', category: 'Beverages', price: 0, isVeg: true } }
  });
  assert.equal(invalid.status, 400);
  const invalidBody = await json(invalid);
  assert.equal(invalidBody.code, 'INVALID_ITEM');
  assert.ok(invalidBody.errors.length >= 2);
});

test('PUT merges the provided keys and DELETE removes the item', async () => {
  const menu = await json(await call(rec, '/menu'));
  const chaas = menu.items.find(i => i.name === 'Masala Chaas');

  const put = await call(rec, `/admin/menu/items/${chaas.id}`, {
    method: 'PUT',
    body: { base_revision: menu.revision, item: { price: 60 } }
  });
  assert.equal(put.status, 200);
  const updated = (await json(await call(rec, '/menu'))).items.find(i => i.id === chaas.id);
  assert.equal(updated.price, 60);
  assert.equal(updated.station, 'bar', 'omitted keys are preserved');

  const rev = await menuRev();
  const del = await call(rec, `/admin/menu/items/${chaas.id}?base_revision=${rev}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.ok(!(await json(await call(rec, '/menu'))).items.some(i => i.id === chaas.id));

  const gone = await call(rec, `/admin/menu/items/${chaas.id}?base_revision=${await menuRev()}`, { method: 'DELETE' });
  assert.equal(gone.status, 404);
});

// ---------------------------------------------------------------- categories

test('category add, rename, reorder and delete', async () => {
  let r = await call(rec, '/admin/menu/categories', { method: 'POST', body: { base_revision: await menuRev(), name: 'Drinks' } });
  assert.equal(r.status, 201);

  r = await call(rec, '/admin/menu/categories', { method: 'PUT', body: { base_revision: await menuRev(), from: 'Drinks', to: 'Cold Drinks' } });
  assert.equal(r.status, 200);

  r = await call(rec, '/admin/menu/categories/order', { method: 'PUT', body: { base_revision: await menuRev(), names: ['Cold Drinks', 'Starters', 'Beverages'] } });
  assert.equal(r.status, 200);
  const menu = await json(await call(rec, '/menu'));
  assert.deepEqual(menu.categories, ['Cold Drinks', 'Starters', 'Beverages']);

  r = await call(rec, `/admin/menu/categories?name=${encodeURIComponent('Cold Drinks')}&base_revision=${await menuRev()}`, { method: 'DELETE' });
  assert.equal(r.status, 200);

  r = await call(rec, `/admin/menu/categories?name=Starters&base_revision=${await menuRev()}`, { method: 'DELETE' });
  assert.equal(r.status, 409);
  assert.equal((await json(r)).code, 'CATEGORY_NOT_EMPTY');
});

// ---------------------------------------------------------------- import

test('import preview does not write; commit applies; replace needs confirmation', async () => {
  const rows = [
    { name: 'Paneer Tikka', category: 'Starters', price: '240' },
    { name: 'New Dish', category: 'Starters', price: '100', veg: 'yes' }
  ];
  const before = await menuRev();

  const preview = await call(rec, '/admin/menu/import/preview', { method: 'POST', body: { rows } });
  assert.equal(preview.status, 200);
  const p = await json(preview);
  assert.deepEqual(p.counts, { new: 1, updated: 1, unchanged: 0, error: 0, removed: 0 });
  assert.equal(p.rows[0].item, undefined, 'preview rows omit the full item');
  assert.equal(await menuRev(), before, 'preview must not write');

  const commit = await call(rec, '/admin/menu/import/commit', { method: 'POST', body: { base_revision: before, rows } });
  assert.equal(commit.status, 200);
  const c = await json(commit);
  assert.equal(c.revision, before + 1);
  assert.equal(c.counts.new, 1);
  const menu = await json(await call(rec, '/menu'));
  assert.equal(menu.items.find(i => i.name === 'Paneer Tikka').price, 240);
  assert.ok(menu.items.some(i => i.name === 'New Dish'));

  const unconfirmed = await call(rec, '/admin/menu/import/commit', {
    method: 'POST', body: { base_revision: await menuRev(), rows, mode: 'replace' }
  });
  assert.equal(unconfirmed.status, 400);
  assert.equal((await json(unconfirmed)).code, 'CONFIRM_REQUIRED');

  const blocked = await call(rec, '/admin/menu/import/commit', {
    method: 'POST', body: { base_revision: await menuRev(), rows: [{ name: 'Bad', category: 'Starters', price: 'x', veg: 'yes' }] }
  });
  assert.equal(blocked.status, 400);
  const blockedBody = await json(blocked);
  assert.equal(blockedBody.code, 'INVALID_ROWS');
  assert.equal(blockedBody.details[0].row, 2);
});

test('import bodies above the global 256 KB limit are accepted; more than 2000 rows are refused', async () => {
  const pad = 'x'.repeat(100);
  const big = Array.from({ length: 2000 }, (_, i) => ({ name: `Dish ${i} ${pad}`, category: 'Bulk', price: '10', veg: 'yes' }));
  assert.ok(JSON.stringify({ rows: big }).length > 256 * 1024, 'fixture must exceed the global limit');

  const ok = await call(rec, '/admin/menu/import/preview', { method: 'POST', body: { rows: big } });
  assert.equal(ok.status, 200);
  assert.equal((await json(ok)).counts.new, 2000);

  const tooMany = await call(rec, '/admin/menu/import/preview', {
    method: 'POST', body: { rows: [...big, { name: 'One too many', category: 'Bulk', price: '10', veg: 'yes' }] }
  });
  assert.equal(tooMany.status, 400);
  assert.equal((await json(tooMany)).code, 'TOO_MANY_ROWS');
});

// ---------------------------------------------------------------- tables

test('PUT /admin/tables/layout saves sections, order, rename and a new table; stale base is refused', async () => {
  const layout = {
    base_revision: 0,
    sections: ['Main Hall', 'Patio'],
    tables: [
      { id: 1, name: 'T1', section: 'Main Hall', capacity: 4 },
      { id: 2, name: 'Window', section: 'Main Hall', capacity: 4 },
      { name: 'P1', section: 'Patio', capacity: 6 }
    ]
  };
  const res = await call(rec, '/admin/tables/layout', { method: 'PUT', body: layout });
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.revision, 1);
  assert.equal(body.tables[2].id, 3, 'a new table gets the next id');

  const live = await json(await call(rec, '/tables'));
  assert.deepEqual(live.sections, ['Main Hall', 'Patio']);
  assert.deepEqual(live.tables.map(t => t.name), ['T1', 'Window', 'P1']);

  const stale = await call(rec, '/admin/tables/layout', { method: 'PUT', body: layout });
  assert.equal(stale.status, 409);
  assert.equal((await json(stale)).code, 'STALE_REVISION');

  const dup = await call(rec, '/admin/tables/layout', {
    method: 'PUT',
    body: { ...layout, base_revision: 1, tables: [{ id: 1, name: 'T1', section: 'Main Hall', capacity: 4 }, { id: 2, name: 't1', section: 'Main Hall', capacity: 4 }] }
  });
  assert.equal(dup.status, 400);
  assert.equal((await json(dup)).code, 'INVALID_LAYOUT');
});

test('a table with an open bill cannot be renamed or deleted, but can be moved', async () => {
  const order = await call(rec, '/orders', { method: 'POST', body: { table_id: 1, table_name: 'T1', items: [{ id: 'm1', qty: 1 }] } });
  assert.ok(order.ok, 'fixture order must be accepted');

  const base = await tablesRev();
  const rename = await call(rec, '/admin/tables/layout', {
    method: 'PUT',
    body: {
      base_revision: base,
      sections: ['Main Hall', 'Patio'],
      tables: [
        { id: 1, name: 'Renamed', section: 'Main Hall', capacity: 4 },
        { id: 2, name: 'Window', section: 'Main Hall', capacity: 4 },
        { id: 3, name: 'P1', section: 'Patio', capacity: 6 }
      ]
    }
  });
  assert.equal(rename.status, 409);
  const renameBody = await json(rename);
  assert.equal(renameBody.code, 'TABLE_HAS_OPEN_BILL');
  assert.deepEqual(renameBody.details, [{ id: 1, name: 'T1', action: 'rename' }]);

  const move = await call(rec, '/admin/tables/layout', {
    method: 'PUT',
    body: {
      base_revision: base,
      sections: ['Main Hall', 'Patio'],
      tables: [
        { id: 1, name: 'T1', section: 'Patio', capacity: 8 },
        { id: 2, name: 'Window', section: 'Main Hall', capacity: 4 },
        { id: 3, name: 'P1', section: 'Patio', capacity: 6 }
      ]
    }
  });
  assert.equal(move.status, 200);

  const cleared = await call(rec, '/tables/1/clear', { method: 'POST' });
  assert.ok(cleared.ok);
});

test('menu and layout commits are broadcast over the live socket', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${rec.port}/live`);
  const seen = [];
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  ws.on('message', m => seen.push(JSON.parse(m.toString()).type));

  const t = await call(rec, '/admin/tables/layout', {
    method: 'PUT',
    body: {
      base_revision: await tablesRev(),
      sections: ['Main Hall', 'Patio'],
      tables: [
        { id: 1, name: 'T1', section: 'Patio', capacity: 8 },
        { id: 2, name: 'Window', section: 'Main Hall', capacity: 4 },
        { id: 3, name: 'P1', section: 'Patio', capacity: 6 }
      ]
    }
  });
  assert.equal(t.status, 200);
  assert.ok(await waitFor(() => seen.includes('tables_updated')), 'tables_updated must be broadcast');

  const m = await call(rec, '/admin/menu/categories', { method: 'POST', body: { base_revision: await menuRev(), name: 'Specials' } });
  assert.equal(m.status, 201);
  assert.ok(await waitFor(() => seen.includes('menu_updated')), 'menu_updated must be broadcast');
  ws.close();
});

test('deleting every table leaves the floor empty instead of resurrecting the demo tables', async () => {
  const res = await call(rec, '/admin/tables/layout', {
    method: 'PUT', body: { base_revision: await tablesRev(), sections: ['Main Hall'], tables: [] }
  });
  assert.equal(res.status, 200);
  const live = await json(await call(rec, '/tables'));
  assert.equal(live.count, 0);
  assert.deepEqual(live.tables, []);
});

test('replace import (confirmed) leaves only the file contents', async () => {
  const rows = [{ name: 'Only Dish', category: 'Mains', price: '99', veg: 'yes' }];
  const res = await call(rec, '/admin/menu/import/commit', {
    method: 'POST', body: { base_revision: await menuRev(), rows, mode: 'replace', confirm_replace: true }
  });
  assert.equal(res.status, 200);
  const menu = await json(await call(rec, '/menu'));
  assert.deepEqual(menu.items.map(i => i.name), ['Only Dish']);
  assert.deepEqual(menu.categories, ['Mains']);
});

// ---------------------------------------------------------------- access control

test('enrolled handsets can read the menu but get 403 RECEPTION_ONLY on every admin route', async () => {
  const read = await call(handset, '/menu', { token });
  assert.equal(read.status, 200);

  const attempts = [
    ['POST', '/admin/menu/items', { base_revision: 0, item: { name: 'X', category: 'Starters', price: 1, isVeg: true } }],
    ['PUT', '/admin/menu/items/m1', { base_revision: 0, item: { price: 1 } }],
    ['DELETE', '/admin/menu/items/m1?base_revision=0', undefined],
    ['POST', '/admin/menu/categories', { base_revision: 0, name: 'X' }],
    ['PUT', '/admin/menu/categories', { base_revision: 0, from: 'Starters', to: 'X' }],
    ['PUT', '/admin/menu/categories/order', { base_revision: 0, names: [] }],
    ['DELETE', '/admin/menu/categories?name=Starters&base_revision=0', undefined],
    ['POST', '/admin/menu/import/preview', { rows: [] }],
    ['POST', '/admin/menu/import/commit', { base_revision: 0, rows: [] }],
    ['PUT', '/admin/tables/layout', { base_revision: 0, sections: [], tables: [] }]
  ];
  for (const [method, p, body] of attempts) {
    const res = await call(handset, p, { method, body, token });
    assert.equal(res.status, 403, `${method} ${p} must be reception-only`);
    assert.equal((await json(res)).code, 'RECEPTION_ONLY');
  }

  const anonymous = await call(handset, '/admin/tables/layout', { method: 'PUT', body: { base_revision: 0, sections: [], tables: [] } });
  assert.equal(anonymous.status, 403);

  const unchanged = await json(await call(handset, '/menu', { token }));
  assert.equal(unchanged.revision, 0, 'a refused edit must not change anything');
});
