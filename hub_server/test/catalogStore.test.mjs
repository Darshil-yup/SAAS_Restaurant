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
