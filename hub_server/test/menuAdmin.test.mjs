import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addItem, updateItem, deleteItem,
  addCategory, renameCategory, reorderCategories, deleteCategory
} from '../lib/menuAdmin.js';

const menu = () => ({
  restaurant_id: 'r', revision: 3,
  categories: ['Starters', 'Mains'],
  items: [
    { id: 'm1', name: 'Paneer Tikka', price: 230, category: 'Starters', isVeg: true, available: true },
    {
      id: 'm2', name: 'Dal Tadka', price: 190, category: 'Mains', isVeg: true, available: true,
      variants: [{ id: 'v_half', label: 'Half', price: 120, available: true }],
      modifier_groups: [{ id: 'g1', label: 'Spice', min: 1, max: 1, options: [{ id: 'o1', label: 'Mild', price_delta: 0, available: true }] }]
    }
  ]
});

test('addItem creates an item with a generated id and registers its category', () => {
  const r = addItem(menu(), { name: ' Masala Chaas ', category: 'Beverages', price: 50, isVeg: true, station: 'BAR' });
  assert.equal(r.ok, true);
  assert.match(r.meta.item.id, /^m_[0-9a-f]{8}$/);
  assert.equal(r.meta.item.name, 'Masala Chaas');
  assert.equal(r.meta.item.station, 'bar');
  assert.equal(r.meta.item.available, true);
  assert.deepEqual(r.data.categories, ['Starters', 'Mains', 'Beverages']);
  assert.equal(r.data.items.length, 3);
});

test('addItem reuses the existing spelling of a category', () => {
  const r = addItem(menu(), { name: 'Soup', category: 'starters', price: 80, isVeg: true });
  assert.equal(r.meta.item.category, 'Starters');
  assert.deepEqual(r.data.categories, ['Starters', 'Mains']);
});

test('addItem defaults the price to the first variant when none is given', () => {
  const r = addItem(menu(), {
    name: 'Chai', category: 'Mains', isVeg: true,
    variants: [{ id: 'v_c', label: 'Cutting', price: 20 }, { id: 'v_f', label: 'Full', price: 40 }]
  });
  assert.equal(r.ok, true);
  assert.equal(r.meta.item.price, 20);
});

test('addItem requires a price when there are no variants', () => {
  const r = addItem(menu(), { name: 'Chai', category: 'Mains', isVeg: true });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].field, 'price');
});

test('addItem rejects bad input with field-level errors', () => {
  const r = addItem(menu(), { name: '', category: 'Starters', price: 0, isVeg: 'yes' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.equal(r.code, 'INVALID_ITEM');
  assert.deepEqual(r.errors.map(e => e.field).sort(), ['isVeg', 'name', 'price']);
});

test('addItem rejects prices with more than 2 decimals and unknown stations', () => {
  const r = addItem(menu(), { name: 'X', category: 'Starters', price: 10.555, isVeg: true, station: 'grill' });
  assert.deepEqual(r.errors.map(e => e.field).sort(), ['price', 'station']);
});

test('addItem rejects duplicates (same name + category, case-insensitive)', () => {
  const r = addItem(menu(), { name: 'paneer tikka', category: 'STARTERS', price: 10, isVeg: true });
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.equal(r.code, 'DUPLICATE_ITEM');
});

test('addItem rejects malformed variants, modifier groups and day-parts', () => {
  const base = { name: 'X', category: 'Starters', price: 10, isVeg: true };
  const bad = (extra) => addItem(menu(), { ...base, ...extra });

  assert.equal(bad({ variants: [{ id: 'v', label: 'Half', price: 0 }] }).errors[0].field, 'variants');
  assert.equal(bad({ variants: [{ id: 'v', label: 'A', price: 1 }, { id: 'v', label: 'B', price: 2 }] }).errors[0].field, 'variants');
  assert.equal(bad({ variants: [{ label: 'No id', price: 1 }] }).errors[0].field, 'variants');
  assert.equal(
    bad({ modifier_groups: [{ id: 'g', label: 'Pick', min: 2, max: 2, options: [{ id: 'o', label: 'A', price_delta: 0 }] }] }).errors[0].field,
    'modifier_groups',
    'a minimum above the option count can never be satisfied'
  );
  assert.equal(
    bad({ modifier_groups: [{ id: 'g', label: 'Pick', options: [{ id: 'o', label: 'A', price_delta: 'x' }] }] }).errors[0].field,
    'modifier_groups'
  );
  assert.equal(bad({ day_parts: [{ id: 'd', label: 'Lunch', starts_at: '25:00', ends_at: '15:00', price: 1 }] }).errors[0].field, 'day_parts');
});

test('addItem accepts valid variants, modifier groups and day-parts', () => {
  const r = addItem(menu(), {
    name: 'Biryani', category: 'Mains', isVeg: false, price: 300,
    variants: [{ id: 'v_h', label: 'Half', price: 180 }],
    modifier_groups: [{ id: 'g', label: 'Spice', min: 1, max: 1, options: [{ id: 'o', label: 'Hot', price_delta: 0 }] }],
    day_parts: [{ id: 'd', label: 'Lunch', starts_at: '11:00', ends_at: '15:00', price: 250 }]
  });
  assert.equal(r.ok, true);
  assert.equal(r.meta.item.variants[0].available, true);
  assert.equal(r.meta.item.day_parts[0].price, 250);
});

test('updateItem merges only the provided keys', () => {
  const r = updateItem(menu(), 'm2', { price: 200 });
  assert.equal(r.ok, true);
  assert.equal(r.meta.item.price, 200);
  assert.equal(r.meta.item.variants.length, 1, 'variants preserved');
  assert.equal(r.meta.item.modifier_groups.length, 1, 'modifier groups preserved');
});

test('updateItem clears variants / modifier groups when sent an empty array', () => {
  const r = updateItem(menu(), 'm2', { variants: [], modifier_groups: [] });
  assert.equal(r.ok, true);
  assert.equal('variants' in r.meta.item, false);
  assert.equal('modifier_groups' in r.meta.item, false);
});

test('updateItem can 86 an item and move it to another category', () => {
  const r = updateItem(menu(), 'm1', { available: false, category: 'mains' });
  assert.equal(r.meta.item.available, false);
  assert.equal(r.meta.item.category, 'Mains');
});

test('updateItem 404s on an unknown id and blocks renames that collide', () => {
  assert.equal(updateItem(menu(), 'nope', { price: 1 }).code, 'ITEM_NOT_FOUND');
  const clash = updateItem(menu(), 'm1', { name: 'Dal Tadka', category: 'Mains' });
  assert.equal(clash.status, 409);
  assert.equal(clash.code, 'DUPLICATE_ITEM');
});

test('deleteItem removes the item; unknown id 404s', () => {
  const r = deleteItem(menu(), 'm1');
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.items.map(i => i.id), ['m2']);
  assert.equal(deleteItem(menu(), 'nope').status, 404);
});

test('categories: add, rename (relabels items), reorder, delete-only-when-empty', () => {
  const added = addCategory(menu(), ' Desserts ');
  assert.deepEqual(added.data.categories, ['Starters', 'Mains', 'Desserts']);
  assert.equal(addCategory(menu(), 'starters').code, 'CATEGORY_EXISTS');
  assert.equal(addCategory(menu(), '   ').code, 'INVALID_CATEGORY');

  const renamed = renameCategory(menu(), 'Starters', 'Appetisers');
  assert.deepEqual(renamed.data.categories, ['Appetisers', 'Mains']);
  assert.equal(renamed.data.items.find(i => i.id === 'm1').category, 'Appetisers');
  assert.equal(renameCategory(menu(), 'Starters', 'mains').code, 'CATEGORY_EXISTS');
  assert.equal(renameCategory(menu(), 'Nope', 'X').code, 'CATEGORY_NOT_FOUND');
  assert.equal(renameCategory(menu(), 'Starters', 'starters').ok, true, 'a case-only rename of itself is allowed');

  assert.deepEqual(reorderCategories(menu(), ['Mains', 'Starters']).data.categories, ['Mains', 'Starters']);
  assert.equal(reorderCategories(menu(), ['Mains']).code, 'INVALID_ORDER');
  assert.equal(reorderCategories(menu(), ['Mains', 'Mains']).code, 'INVALID_ORDER');

  assert.equal(deleteCategory(menu(), 'Starters').code, 'CATEGORY_NOT_EMPTY');
  const withEmpty = addCategory(menu(), 'Desserts').data;
  assert.deepEqual(deleteCategory(withEmpty, 'Desserts').data.categories, ['Starters', 'Mains']);
  assert.equal(deleteCategory(menu(), 'Nope').status, 404);
});
