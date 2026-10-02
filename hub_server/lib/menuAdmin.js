import crypto from 'crypto';
import { normalizeVariants, normalizeModifierGroups, normalizeDayParts } from './menuNormalize.js';

// Pure menu editing. Nothing here touches disk: every operation takes the current
// menu object and returns { ok:true, data, meta? } or { ok:false, status, code,
// error, errors? }, the shape restaurantCache.updateCatalog expects from a mutator.

export const STATIONS = ['hot', 'cold', 'bar'];
export const LIMITS = { name: 120, category: 60, variantLabel: 40, importRows: 2000 };

export const norm = s => String(s ?? '').trim().toLowerCase();
export const newItemId = () => 'm_' + crypto.randomBytes(4).toString('hex');
export const isMoney = n => typeof n === 'number' && Number.isFinite(n) && n > 0 && Math.round(n * 100) / 100 === n;

export const sameKey = (a, b) => norm(a.name) === norm(b.name) && norm(a.category) === norm(b.category);

/** The spelling a category already has in the menu, else the trimmed input. */
export function canonicalCategory(categories, name) {
  return categories.find(c => norm(c) === norm(name)) ?? String(name).trim();
}

const withCategory = (categories, name) =>
  categories.some(c => norm(c) === norm(name)) ? categories : [...categories, name];

const invalid = (errors, code = 'INVALID_ITEM') => ({ ok: false, status: 400, code, error: errors[0].message, errors });
const notFound = (code, error) => ({ ok: false, status: 404, code, error });
const conflict = (code, error) => ({ ok: false, status: 409, code, error });

/**
 * Strict validation of editor input. Unlike the lenient cloud normaliser (which
 * silently drops bad nested rows), anything malformed is rejected so the user
 * hears about it. With `partial`, only the keys present are checked.
 */
export function validateItemInput(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return invalid([{ field: 'item', message: 'item must be an object' }]);
  }
  const errors = [];
  const out = {};
  const has = k => input[k] !== undefined;

  if (has('name') || !partial) {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > LIMITS.name) errors.push({ field: 'name', message: `name is required (1–${LIMITS.name} characters)` });
    else out.name = name;
  }
  if (has('category') || !partial) {
    const category = typeof input.category === 'string' ? input.category.trim() : '';
    if (!category || category.length > LIMITS.category) errors.push({ field: 'category', message: `category is required (1–${LIMITS.category} characters)` });
    else out.category = category;
  }
  if (has('isVeg') || !partial) {
    if (typeof input.isVeg !== 'boolean') errors.push({ field: 'isVeg', message: 'isVeg must be true or false' });
    else out.isVeg = input.isVeg;
  }
  if (has('available')) {
    if (typeof input.available !== 'boolean') errors.push({ field: 'available', message: 'available must be true or false' });
    else out.available = input.available;
  }
  if (has('station')) {
    const s = String(input.station).toLowerCase();
    if (!STATIONS.includes(s)) errors.push({ field: 'station', message: `station must be one of ${STATIONS.join(', ')}` });
    else out.station = s;
  }
  if (has('price')) {
    const price = typeof input.price === 'string' ? Number(input.price) : input.price;
    if (!isMoney(price)) errors.push({ field: 'price', message: 'price must be a number above 0 with at most 2 decimals' });
    else out.price = price;
  }
  if (has('variants')) {
    const raw = input.variants;
    const clean = Array.isArray(raw) ? normalizeVariants(raw) : null;
    const ok = clean
      && clean.length === raw.length
      && new Set(clean.map(v => v.id)).size === clean.length
      && clean.every(v => isMoney(v.price));
    if (!ok) errors.push({ field: 'variants', message: 'every variant needs a unique id, a label and a price above 0' });
    else out.variants = clean;
  }
  if (has('modifier_groups')) {
    const raw = input.modifier_groups;
    const clean = Array.isArray(raw) ? normalizeModifierGroups(raw) : null;
    const ok = clean
      && clean.length === raw.length
      && new Set(clean.map(g => g.id)).size === clean.length
      && clean.every((g, i) =>
        g.options.length === raw[i].options.length
        && new Set(g.options.map(o => o.id)).size === g.options.length
        && g.min <= g.options.length);
    if (!ok) {
      errors.push({
        field: 'modifier_groups',
        message: 'every group needs a unique id, a label, at least as many options as its minimum, and every option a unique id, a label and a numeric price_delta'
      });
    } else out.modifier_groups = clean;
  }
  if (has('day_parts')) {
    const raw = input.day_parts;
    const clean = Array.isArray(raw) ? normalizeDayParts(raw) : null;
    if (!clean || clean.length !== raw.length || new Set(clean.map(d => d.id)).size !== clean.length) {
      errors.push({ field: 'day_parts', message: 'every day-part needs a unique id, a label, HH:MM start/end times and a price or variant_prices' });
    } else out.day_parts = clean;
  }

  return errors.length ? invalid(errors) : { ok: true, item: out };
}

export function addItem(menu, input) {
  const v = validateItemInput(input);
  if (!v.ok) return v;

  const item = { id: newItemId(), available: true, ...v.item };
  item.category = canonicalCategory(menu.categories, item.category);
  if (item.price === undefined) {
    if (!item.variants?.length) return invalid([{ field: 'price', message: 'price is required when the item has no variants' }]);
    item.price = item.variants[0].price;
  }
  if (menu.items.some(i => sameKey(i, item))) {
    return conflict('DUPLICATE_ITEM', `"${item.name}" already exists in ${item.category}.`);
  }
  return {
    ok: true,
    data: { ...menu, categories: withCategory(menu.categories, item.category), items: [...menu.items, item] },
    meta: { item }
  };
}

const EMPTYABLE = ['variants', 'modifier_groups', 'day_parts'];

/** Merge semantics: keys you omit are preserved; send `[]` to clear variants/groups/day-parts. */
export function updateItem(menu, id, input) {
  const idx = menu.items.findIndex(i => i.id === id);
  if (idx === -1) return notFound('ITEM_NOT_FOUND', `No menu item with id ${id}.`);

  const v = validateItemInput(input, { partial: true });
  if (!v.ok) return v;

  const item = { ...menu.items[idx], ...v.item };
  if (v.item.category) item.category = canonicalCategory(menu.categories, v.item.category);
  for (const k of EMPTYABLE) {
    if (Array.isArray(item[k]) && item[k].length === 0) delete item[k];
  }
  if (menu.items.some((i, n) => n !== idx && sameKey(i, item))) {
    return conflict('DUPLICATE_ITEM', `"${item.name}" already exists in ${item.category}.`);
  }
  return {
    ok: true,
    data: {
      ...menu,
      categories: withCategory(menu.categories, item.category),
      items: menu.items.map((i, n) => (n === idx ? item : i))
    },
    meta: { item }
  };
}

export function deleteItem(menu, id) {
  if (!menu.items.some(i => i.id === id)) return notFound('ITEM_NOT_FOUND', `No menu item with id ${id}.`);
  return { ok: true, data: { ...menu, items: menu.items.filter(i => i.id !== id) }, meta: { deleted: id } };
}

const cleanCategoryName = name => {
  const clean = typeof name === 'string' ? name.trim() : '';
  return clean && clean.length <= LIMITS.category ? clean : null;
};
const badCategoryName = () =>
  invalid([{ field: 'name', message: `category name is required (1–${LIMITS.category} characters)` }], 'INVALID_CATEGORY');

export function addCategory(menu, name) {
  const clean = cleanCategoryName(name);
  if (!clean) return badCategoryName();
  if (menu.categories.some(c => norm(c) === norm(clean))) return conflict('CATEGORY_EXISTS', `Category "${clean}" already exists.`);
  return { ok: true, data: { ...menu, categories: [...menu.categories, clean] }, meta: { name: clean } };
}

export function renameCategory(menu, from, to) {
  const current = menu.categories.find(c => c === from) ?? menu.categories.find(c => norm(c) === norm(from));
  if (!current) return notFound('CATEGORY_NOT_FOUND', `No category named "${from}".`);
  const clean = cleanCategoryName(to);
  if (!clean) return badCategoryName();
  if (menu.categories.some(c => c !== current && norm(c) === norm(clean))) {
    return conflict('CATEGORY_EXISTS', `Category "${clean}" already exists.`);
  }
  return {
    ok: true,
    data: {
      ...menu,
      categories: menu.categories.map(c => (c === current ? clean : c)),
      items: menu.items.map(i => (i.category === current ? { ...i, category: clean } : i))
    },
    meta: { name: clean }
  };
}

export function reorderCategories(menu, names) {
  const ok = Array.isArray(names)
    && names.length === menu.categories.length
    && new Set(names).size === names.length
    && names.every(n => menu.categories.includes(n));
  if (!ok) return invalid([{ field: 'names', message: 'names must list every existing category exactly once' }], 'INVALID_ORDER');
  return { ok: true, data: { ...menu, categories: [...names] } };
}

export function deleteCategory(menu, name) {
  if (!menu.categories.includes(name)) return notFound('CATEGORY_NOT_FOUND', `No category named "${name}".`);
  const count = menu.items.filter(i => i.category === name).length;
  if (count > 0) return conflict('CATEGORY_NOT_EMPTY', `"${name}" still has ${count} item(s). Move or delete them first.`);
  return { ok: true, data: { ...menu, categories: menu.categories.filter(c => c !== name) } };
}
