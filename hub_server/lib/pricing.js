import { restaurantCache } from './restaurantCache.js';

/**
 * Server-side order pricing.
 *
 * Handsets are untrusted: anything on the LAN can POST /orders with arbitrary
 * `price` values. The hub therefore ignores client-supplied prices entirely and
 * re-prices every line against its own menu cache, which is the same menu the
 * handsets are served from GET /menu.
 *
 * Returns either { ok: true, items, total_amount } with authoritative prices, or
 * { ok: false, error, details } describing exactly which lines were rejected.
 */

const MAX_QTY_PER_LINE = 99;
const MAX_LINES_PER_ORDER = 60;

export function priceOrder(rawItems, restaurantId) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { ok: false, error: 'Order must contain at least 1 item.' };
  }

  if (rawItems.length > MAX_LINES_PER_ORDER) {
    return {
      ok: false,
      error: `Order exceeds the maximum of ${MAX_LINES_PER_ORDER} line items.`
    };
  }

  const menu = restaurantCache.getMenuCache(restaurantId);

  // A hub with no menu cannot price an order. Handsets already show the
  // "no menu data" banner in this state, so this should be unreachable in
  // normal use -- but billing must fail closed, never fall back to client prices.
  if (menu.uninitialized || !Array.isArray(menu.items) || menu.items.length === 0) {
    return {
      ok: false,
      error: 'Hub has no menu loaded, so orders cannot be priced. Connect this hub to the internet once to complete setup.',
      code: 'NO_MENU_CACHE'
    };
  }

  const byId = new Map(menu.items.map(item => [String(item.id), item]));

  const priced = [];
  const rejected = [];

  for (const raw of rawItems) {
    const id = String(raw?.id ?? '');
    const menuItem = byId.get(id);

    if (!menuItem) {
      rejected.push({ id, reason: 'UNKNOWN_ITEM' });
      continue;
    }

    if (menuItem.available === false) {
      rejected.push({ id, name: menuItem.name, reason: 'ITEM_UNAVAILABLE' });
      continue;
    }

    const qty = Math.floor(Number(raw?.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) {
      rejected.push({ id, name: menuItem.name, reason: 'INVALID_QTY' });
      continue;
    }

    const price = Number(menuItem.price);
    if (!Number.isFinite(price) || price < 0) {
      rejected.push({ id, name: menuItem.name, reason: 'ITEM_NOT_PRICED' });
      continue;
    }

    priced.push({
      id: menuItem.id,
      // Name and price both come from the hub, never from the request body.
      name: menuItem.name,
      qty,
      price
    });
  }

  if (rejected.length > 0) {
    return {
      ok: false,
      error: 'Order rejected: one or more items are not on the current menu.',
      code: 'INVALID_ITEMS',
      details: rejected
    };
  }

  const total_amount = Math.round(
    priced.reduce((sum, i) => sum + i.price * i.qty, 0) * 100
  ) / 100;

  return { ok: true, items: priced, total_amount };
}
