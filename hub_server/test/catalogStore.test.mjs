import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RID = '11111111-1111-1111-1111-111111111111';
let dir;
let cache;

const MENU = () => ({
  restaurant_id: RID, categories: ['Starters'], uninitialized: false,
  items: [{ id: 'm1', name: 'Paneer Tikka', price: 230, category: 'Starters', isVeg: true, available: true }]
});
const TABLES = () => ({
  restaurant_id: RID, count: 2, uninitialized: false,
  tables: [
    { id: 1, name: 'T1', section: 'Main Hall', capacity: 4 },
    { id: 2, name: 'T2', section: 'AC Room', capacity: 4 }
  ]
});

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-test-'));
  process.env.HUB_DATA_DIR = dir;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  ({ restaurantCache: cache } = await import('../lib/restaurantCache.js'));
});

after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

function reset() {
  fs.rmSync(path.join(dir, 'backups'), { recursive: true, force: true });
  fs.writeFileSync(path.join(dir, 'menu_cache.json'), JSON.stringify(MENU()));
  fs.writeFileSync(path.join(dir, 'tables_cache.json'), JSON.stringify(TABLES()));
  cache.isUninitialized = false;
  cache.loadFromDisk();
}
const readJson = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
const addDish = name => menu => ({
  ok: true,
  data: { ...menu, items: [...menu.items, { id: `x_${name}`, name, price: 1, category: 'Starters', isVeg: true, available: true }] }
});
const addTable = data => ({
  ok: true,
  data: { ...data, count: data.tables.length + 1, tables: [...data.tables, { id: 3, name: 'T3', section: 'Garden', capacity: 2 }] }
});
const CLOUD_MENU = () => ({
  restaurant_id: RID, categories: ['Cloud'], uninitialized: false,
  items: [{ id: 'c1', name: 'Cloud Dish', price: 5, category: 'Cloud', isVeg: true, available: true }]
});
const CLOUD_TABLES = () => ({
  restaurant_id: RID, count: 1, uninitialized: false,
  tables: [{ id: 9, name: 'Cloud', section: 'X', capacity: 2 }]
});
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};
// Swap methods on `target` for one test only and put back exactly what was there before,
// so a test neither depends on nor leaves behind a stub.
async function withStubs(target, stubs, fn) {
  const saved = Object.keys(stubs).map(name => [name, Object.hasOwn(target, name), target[name]]);
  Object.assign(target, stubs);
  try {
    return await fn();
  } finally {
    for (const [name, wasOwn, value] of saved) {
      if (wasOwn) target[name] = value; else delete target[name];
    }
  }
}
// How each catalog is fetched, edited and inspected in the in-flight pull tests below.
const RACE = {
  menu: {
    fetcher: 'fetchMenuFromSupabase', cloud: CLOUD_MENU, edit: addDish('Local'),
    rows: 'items', rowsAfterEdit: 2, event: 'menu_updated', file: 'menu_cache.json',
    get: () => cache.getMenuCache()
  },
  tables: {
    fetcher: 'fetchTablesFromSupabase', cloud: CLOUD_TABLES, edit: addTable,
    rows: 'tables', rowsAfterEdit: 3, event: 'tables_updated', file: 'tables_cache.json',
    get: () => cache.getTablesCache()
  }
};

test('legacy caches report revision 0 and derive sections in first-seen order', () => {
  reset();
  assert.equal(cache.getMenuCache().revision, 0);
  const t = cache.getTablesCache();
  assert.equal(t.revision, 0);
  assert.deepEqual(t.sections, ['Main Hall', 'AC Room']);
});

test('updateCatalog bumps the revision, persists atomically and keeps a backup', async () => {
  reset();
  const res = await cache.updateCatalog('menu', 0, addDish('Chaas'));
  assert.equal(res.ok, true);
  assert.equal(res.data.revision, 1);

  const onDisk = readJson('menu_cache.json');
  assert.equal(onDisk.revision, 1);
  assert.equal(onDisk.source, 'hub');
  assert.equal(onDisk.items.length, 2);
  assert.equal(fs.existsSync(path.join(dir, 'menu_cache.json.tmp')), false, 'temp file must be renamed away');

  const backups = fs.readdirSync(path.join(dir, 'backups')).filter(f => f.startsWith('menu_cache.'));
  assert.equal(backups.length, 1);
  const backup = JSON.parse(fs.readFileSync(path.join(dir, 'backups', backups[0]), 'utf-8'));
  assert.equal(backup.items.length, 1, 'backup holds the pre-edit menu');
  assert.equal(cache.getMenuCache().revision, 1);
});

test('stale or missing base_revision is refused and nothing is written', async () => {
  reset();
  await cache.updateCatalog('menu', 0, addDish('A'));

  const stale = await cache.updateCatalog('menu', 0, addDish('B'));
  assert.equal(stale.ok, false);
  assert.equal(stale.status, 409);
  assert.equal(stale.code, 'STALE_REVISION');
  assert.equal(stale.current_revision, 1);

  const missing = await cache.updateCatalog('menu', undefined, addDish('C'));
  assert.equal(missing.status, 400);
  assert.equal(missing.code, 'BASE_REVISION_REQUIRED');

  assert.equal(readJson('menu_cache.json').items.length, 2);
});

test('a mutator failure passes through and writes nothing', async () => {
  reset();
  const res = await cache.updateCatalog('menu', 0, () => ({ ok: false, status: 400, code: 'NOPE', error: 'nope' }));
  assert.deepEqual([res.ok, res.status, res.code], [false, 400, 'NOPE']);
  assert.equal(cache.getMenuCache().revision, 0);
  assert.equal(readJson('menu_cache.json').revision, undefined);
});

test('concurrent edits on the same revision serialise: one wins, one gets 409', async () => {
  reset();
  const [a, b] = await Promise.all([
    cache.updateCatalog('menu', 0, addDish('A')),
    cache.updateCatalog('menu', 0, addDish('B'))
  ]);
  assert.deepEqual([a.ok, b.ok].sort(), [false, true]);
  assert.equal(readJson('menu_cache.json').items.length, 2);
});

test('only the last 10 backups are kept', async () => {
  reset();
  for (let i = 0; i < 13; i++) {
    const r = await cache.updateCatalog('menu', i, addDish(`D${i}`));
    assert.equal(r.ok, true);
  }
  const backups = fs.readdirSync(path.join(dir, 'backups')).filter(f => f.startsWith('menu_cache.'));
  assert.equal(backups.length, 10);
});

test('an uninitialised hub refuses edits', async () => {
  reset();
  cache.isUninitialized = true;
  const res = await cache.updateCatalog('menu', 0, addDish('A'));
  assert.equal(res.status, 409);
  assert.equal(res.code, 'HUB_UNINITIALIZED');
  cache.isUninitialized = false;
});

test('once a catalog has been edited, a cloud pull no longer overwrites it', async () => {
  reset();
  await cache.updateCatalog('menu', 0, addDish('Local'));
  let menuPulls = 0;
  let tablePulls = 0;
  cache.fetchMenuFromSupabase = async () => { menuPulls++; return { restaurant_id: RID, categories: [], items: [], uninitialized: false }; };
  cache.fetchTablesFromSupabase = async () => {
    tablePulls++;
    return { ...TABLES(), count: 1, tables: [{ id: 9, name: 'Cloud', section: 'X', capacity: 2 }] };
  };
  cache.subscribeRealtime = () => {};

  await cache.handleReconnection(RID, () => {});

  assert.equal(menuPulls, 0, 'an edited menu must not be pulled');
  assert.equal(tablePulls, 1, 'an untouched catalog still follows the cloud');
  assert.equal(cache.getMenuCache().items.length, 2);
  assert.equal(cache.getTablesCache().tables[0].name, 'Cloud');
});

// ---------------------------------------------------------------------------
// Fix A: a cloud pull must never overwrite a hub edit, even one already in flight
// ---------------------------------------------------------------------------

for (const kind of ['menu', 'tables']) {
  test(`an in-flight cloud pull cannot overwrite a ${kind} edit that committed while it was waiting`, { timeout: 10000 }, async () => {
    const r = RACE[kind];
    const otherFetcher = kind === 'menu' ? 'fetchTablesFromSupabase' : 'fetchMenuFromSupabase';
    reset();
    const gate = deferred();
    const inFlight = deferred();
    const broadcasts = [];
    let fetches = 0;
    await withStubs(cache, {
      [r.fetcher]: () => { fetches++; inFlight.resolve(); return gate.promise; },
      [otherFetcher]: async () => null,
      subscribeRealtime: () => {}
    }, async () => {
      const pull = cache.handleReconnection(RID, type => broadcasts.push(type));
      await inFlight.promise; // revision is still 0 and the cloud call is pending

      const edit = await cache.updateCatalog(kind, 0, r.edit);
      assert.equal(edit.ok, true);
      assert.equal(edit.data.revision, 1);

      gate.resolve(r.cloud()); // the stale cloud answer finally lands
      await pull;

      await cache.handleReconnection(RID, type => broadcasts.push(type)); // authoritative now: skip the fetch entirely
      assert.equal(fetches, 1, 'an authoritative catalog is not even fetched');
    });

    assert.equal(r.get().revision, 1);
    assert.equal(r.get()[r.rows].length, r.rowsAfterEdit, 'the hub edit survived in memory');
    const onDisk = readJson(r.file);
    assert.equal(onDisk.revision, 1);
    assert.equal(onDisk[r.rows].length, r.rowsAfterEdit, 'the hub edit survived on disk');
    assert.equal(broadcasts.includes(r.event), false, 'stale cloud data must not be broadcast');
  });
}

test('with no edit the pull still applies, keeps revision 0 and is broadcast', { timeout: 10000 }, async () => {
  reset();
  const gate = deferred();
  const inFlight = deferred();
  const broadcasts = [];
  await withStubs(cache, {
    fetchMenuFromSupabase: () => { inFlight.resolve(); return gate.promise; },
    fetchTablesFromSupabase: async () => CLOUD_TABLES(),
    subscribeRealtime: () => {}
  }, async () => {
    const pull = cache.handleReconnection(RID, type => broadcasts.push(type));
    await inFlight.promise;
    gate.resolve(CLOUD_MENU());
    await pull;
  });

  assert.equal(cache.getMenuCache().revision, 0);
  assert.deepEqual(cache.getMenuCache().items.map(i => i.id), ['c1']);
  assert.deepEqual(readJson('menu_cache.json').items.map(i => i.id), ['c1']);
  assert.equal(cache.getTablesCache().tables[0].name, 'Cloud');
  assert.deepEqual(broadcasts, ['menu_updated', 'tables_updated']);

  // Pull first, edit second: the pulled catalog is still revision 0, so an edit based on it is accepted.
  const edit = await cache.updateCatalog('menu', 0, addDish('After'));
  assert.equal(edit.ok, true);
  assert.equal(edit.data.revision, 1);
  assert.deepEqual(edit.data.items.map(i => i.id), ['c1', 'x_After']);
});

test('applyPulledCatalog applies cloud data only while that catalog is not hub-authoritative', async () => {
  reset();
  assert.equal(await cache.applyPulledCatalog('menu', CLOUD_MENU()), true);
  assert.equal(cache.getMenuCache().revision, 0);
  assert.deepEqual(readJson('menu_cache.json').items.map(i => i.id), ['c1']);

  // It runs in the same write chain as updateCatalog: queued behind an edit, the pull sees revision 1 and loses.
  const [edit, applied] = await Promise.all([
    cache.updateCatalog('menu', 0, addDish('Local')),
    cache.applyPulledCatalog('menu', CLOUD_MENU())
  ]);
  assert.equal(edit.ok, true);
  assert.equal(applied, false);
  assert.deepEqual(cache.getMenuCache().items.map(i => i.id), ['c1', 'x_Local']);
  assert.equal(readJson('menu_cache.json').revision, 1);

  // Authority is per catalog: tables were never edited, so they still follow the cloud.
  assert.equal(await cache.applyPulledCatalog('tables', CLOUD_TABLES()), true);
  assert.equal(cache.getTablesCache().tables[0].name, 'Cloud');
});

test('realtime events obey the same rule: an in-flight pull cannot overwrite an edit', { timeout: 10000 }, async () => {
  const { supabase } = await import('../lib/supabaseClient.js');
  const realSubscribe = Object.getPrototypeOf(cache).subscribeRealtime;
  const handlerKinds = [['menu_items', 'menu'], ['menu_categories', 'menu'], ['tables', 'tables']];

  for (const [table, kind] of handlerKinds) {
    const r = RACE[kind];
    reset();
    const handlers = {};
    const channel = { on(_evt, filter, handler) { handlers[filter.table] = handler; return channel; }, subscribe() { return channel; } };
    const gate = deferred();
    const inFlight = deferred();
    const broadcasts = [];
    let fetches = 0;
    try {
      await withStubs(supabase, { channel: () => channel, removeChannel: () => {} }, () =>
        withStubs(cache, {
          subscribeRealtime: realSubscribe, // the real one, whatever an earlier test left behind
          [r.fetcher]: () => { fetches++; inFlight.resolve(); return gate.promise; }
        }, async () => {
          cache.subscribeRealtime(RID, type => broadcasts.push(type));
          const pull = handlers[table]();
          await inFlight.promise;

          const edit = await cache.updateCatalog(kind, 0, r.edit);
          assert.equal(edit.ok, true, `${table}: edit accepted`);

          gate.resolve(r.cloud());
          await pull;

          await handlers[table](); // now authoritative: the event must not even reach the network
          assert.equal(fetches, 1, `${table}: no cloud fetch once the catalog is hub-authoritative`);
        }));
    } finally {
      cache.realtimeChannel = null; // never leave the fake channel on the singleton
    }

    assert.equal(r.get().revision, 1, `${table}: revision`);
    assert.equal(r.get()[r.rows].length, r.rowsAfterEdit, `${table}: edit survived in memory`);
    assert.equal(readJson(r.file)[r.rows].length, r.rowsAfterEdit, `${table}: edit survived on disk`);
    assert.equal(broadcasts.includes(r.event), false, `${table}: stale cloud data must not be broadcast`);
  }
});

// ---------------------------------------------------------------------------
// Fix B: an emptied catalog that was edited on the hub stays present across an offline boot
// ---------------------------------------------------------------------------

test('an emptied tables catalog edited on the hub is still present after an offline boot', async () => {
  reset();
  fs.writeFileSync(path.join(dir, 'tables_cache.json'), JSON.stringify({
    restaurant_id: RID, count: 0, tables: [], sections: ['Main Hall'], revision: 2, next_id: 13, source: 'hub', uninitialized: false
  }));
  try {
    assert.deepEqual(cache.loadFromDisk(), { hasMenu: true, hasTables: true });

    await cache.initCache(RID, () => {}); // SUPABASE_URL is the example host, so this boots offline
    assert.equal(cache.isUninitialized, false);
    const tables = cache.getTablesCache(RID);
    assert.equal(tables.uninitialized, false);
    assert.deepEqual(tables.tables, []);
    assert.deepEqual(tables.sections, ['Main Hall']);

    const res = await cache.updateCatalog('tables', 2, data => ({
      ok: true,
      data: { ...data, count: 1, next_id: 14, tables: [{ id: 13, name: 'T13', section: 'Main Hall', capacity: 2 }] }
    }));
    assert.equal(res.ok, true);
    assert.equal(res.data.revision, 3);
  } finally {
    cache.isUninitialized = false;
  }
});

test('an emptied menu edited on the hub is still present after an offline boot', async () => {
  reset();
  fs.writeFileSync(path.join(dir, 'menu_cache.json'), JSON.stringify({
    restaurant_id: RID, categories: [], items: [], revision: 1, source: 'hub', uninitialized: false
  }));
  try {
    assert.deepEqual(cache.loadFromDisk(), { hasMenu: true, hasTables: true });

    await cache.initCache(RID, () => {});
    assert.equal(cache.isUninitialized, false);
    const menu = cache.getMenuCache(RID);
    assert.equal(menu.uninitialized, false);
    assert.deepEqual(menu.items, []);
    assert.deepEqual(menu.categories, []);

    const res = await cache.updateCatalog('menu', 1, addDish('First'));
    assert.equal(res.ok, true);
    assert.equal(res.data.revision, 2);
  } finally {
    cache.isUninitialized = false;
  }
});

for (const kind of ['menu', 'tables']) {
  test(`a legacy empty ${kind} cache with no revision is still treated as missing`, async () => {
    reset();
    const empty = kind === 'menu'
      ? { restaurant_id: RID, categories: [], items: [], uninitialized: false }
      : { restaurant_id: RID, count: 0, tables: [], uninitialized: false };
    fs.writeFileSync(path.join(dir, `${kind}_cache.json`), JSON.stringify(empty));
    try {
      assert.deepEqual(cache.loadFromDisk(), { hasMenu: kind !== 'menu', hasTables: kind !== 'tables' });

      await cache.initCache(RID, () => {});
      assert.equal(cache.isUninitialized, true, 'an empty cloud-written cache is not an authoritative catalog');
      const res = await cache.updateCatalog(kind, 0, kind === 'menu' ? addDish('X') : addTable);
      assert.equal(res.code, 'HUB_UNINITIALIZED');
    } finally {
      cache.isUninitialized = false;
    }
  });
}
