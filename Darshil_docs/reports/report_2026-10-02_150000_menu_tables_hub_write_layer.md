# Menu & Tables · Phase 1 — Hub write layer

**Date:** 2026-10-02T15:00:00+05:30
**Verified:** 2026-10-03, on `404cfa2` with no uncommitted code changes
**Branch:** `feat/menu-tables-admin`
**Code commits:** `b58f884` to `404cfa2` (13 commits, listed under WHAT)
**Author:** Darshil-yup (commits co-authored with Claude Sonnet 5.5)
**Spec:** `docs/superpowers/specs/2026-10-02-menu-tables-module-design.md`
**Plan:** `docs/superpowers/plans/2026-10-02-menu-tables-hub-write-layer.md`
**Scope:** Validated, revision-guarded, reception-only write routes for the menu and table layout. No UI (Phase 2) and no cloud push (Phase 3).

---

## WHY

Menu and tables were read-only on the hub: they were pulled from Supabase into `menu_cache.json` / `tables_cache.json`, and every online boot, reconnect and realtime event overwrote the cache. The old `SelfServeAdminView` editor was not in any built entry point and only edited React state, so no restaurant could actually change its menu or floor. A hub-side edit would also have been silently wiped by the next cloud pull. This phase adds the safe write path first, before any editing UI exists.

## WHAT

### Files changed

Measured with `git diff --stat 82941b5..HEAD -- hub_server src .gitignore` (`82941b5` is the plan commit, the parent of the first code commit): 18 files, 3324 insertions, 118 deletions (source 1059 / 118, tests 2265 / 0).

| File | Change |
|---|---|
| `hub_server/lib/menuNormalize.js` | **New** (106 lines). Shared defensive normaliser extracted from `restaurantCache`: `normalizeVariants`, `normalizeModifierGroups`, `normalizeDayParts`, `normalizeStation`, `normalizeCloudMenuItem`. Same logic as the inline mapper it replaces. The cloud pull, the editor validation and the importer all go through it. |
| `hub_server/lib/restaurantCache.js` (+139 / −113) | `updateCatalog(kind, baseRevision, mutator)`: one promise chain serialises every catalog write; the mutator gets a deep copy; the file is written to a temp name then renamed; the in-memory copy is swapped only after the rename; rolling 10 backups per catalog. `isHubAuthoritative(kind)` (`revision > 0`) stops boot sync, reconnect and realtime pulls. `applyPulledCatalog` is the only way cloud data enters the cache. `revision` on both getters (0 for legacy files) and `sections` on the tables getter (stored list, else distinct sections in first-seen order). The inline mapper moved out (93 of the 113 deleted lines). |
| `hub_server/lib/menuAdmin.js` | **New** (240 lines). Pure item CRUD (strict validation, merge-style update) and category add / rename / reorder / delete. New items get `m_<8 hex>` ids. |
| `hub_server/lib/menuImport.js` | **New** (308 lines). `previewImport` / `applyImport` on already-parsed string rows: merge and replace, field diffs, blank-cell and absent-column preservation, variant id and 86'd-state retention, `veg` required for new items, 2000-row cap. |
| `hub_server/lib/tablesAdmin.js` | **New** (99 lines). `applyLayout`: whole-layout save with unique names (case-insensitive, max 50 characters), an ordered section list (max 60), seats 1 to 50, a persisted never-reused `next_id`, and the open-bill lock. |
| `hub_server/lib/deviceAuth.js` (+14) | `requireReception` guard (403 `RECEPTION_ONLY`). It uses the existing loopback / own-LAN-address rule, so an enrolled handset token is deliberately not enough. |
| `hub_server/server.js` (+135 / −2) | The 10 `/admin/*` routes below; a 2 MB import parser mounted ahead of the 256 KB global one, with `requireReception` in front of it; an `/admin`-scoped JSON error handler; `sections` on `GET /tables`; the `MASTER_TABLES` fallback applies only to an uninitialised hub; `menu_updated` / `tables_updated` broadcast after each commit. |
| `src/waiter_mobile/FloorGrid.jsx` (+12 / −2), `src/waiter_mobile/WaiterApp.jsx` (+3 / −1) | Section chips follow the hub's `sections` (fallback: the distinct sections of the tables); the selection resets to All when the selected section disappears. |
| `.gitignore` (+3) | Ignore `hub_server/data/backups/`. |
| `hub_server/test/*` (8 files, +2265) | New: `menuNormalize`, `catalogStore`, `menuAdmin`, `menuImport`, `tablesAdmin`, `catalogRoutes`, `spawnHub` test files (115 tests) and `helpers/spawnHub.mjs`. |
| `docs/superpowers/specs/2026-10-02-menu-tables-module-design.md`, `Darshil_docs/README.md` | Spec aligned with the final routes and error codes; index row for this report. |

Code commits, oldest first:

| Commit | Subject |
|---|---|
| `b58f884` | refactor(hub): extract menu normaliser into lib/menuNormalize.js |
| `d58bd9d` | feat(hub): revision-guarded atomic catalog writes with backups |
| `d430187` | fix(hub): keep hub edits safe from in-flight cloud pulls and emptied catalogs |
| `323baac` | feat(hub): pure menu item and category operations |
| `ec9ab35` | fix(hub): strict validation for day-parts, labels, modifier max, and conditional duplicate check |
| `c0482db` | fix(hub): reorderCategories duplicate check and hasOwnProperty safe validation |
| `819cf0a` | feat(hub): menu import preview and apply with id uniqueness and key-collision guard |
| `39fcde6` | fix(hub): menu import defects - NO_VALID_ROWS, name-claiming, station round-trip |
| `473d3c8` | feat(hub): pure table layout validation with open-bill lock |
| `d8b6fe7` | fix(hub): tablesAdmin security and correctness fixes (round 1) |
| `241d02c` | feat(hub): reception-only admin routes for menu and table editing |
| `ae9817d` | fix(hub): JSON body errors, guard before parse, strict base_revision, no-op import refusal |
| `404cfa2` | feat(waiter): section chips follow the hub's sections |

### Routes

All routes are reception-only. Every write carries `base_revision`: a JSON number in the body, or a digits-only query string for DELETE.

| Route | Success | Route-specific failures |
|---|---|---|
| `POST /admin/menu/items` `{base_revision, item}` | 201, `{success, revision, item}` | 400 `INVALID_ITEM` (with `errors[]`), 409 `DUPLICATE_ITEM` |
| `PUT /admin/menu/items/:id` | 200, merges the keys sent | 404 `ITEM_NOT_FOUND`, 400 `INVALID_ITEM`, 409 `DUPLICATE_ITEM` |
| `DELETE /admin/menu/items/:id?base_revision=N` | 200 | 404 `ITEM_NOT_FOUND` |
| `POST /admin/menu/categories` `{name}` | 201 | 400 `INVALID_CATEGORY`, 409 `CATEGORY_EXISTS` |
| `PUT /admin/menu/categories` `{from, to}` | 200, re-labels items | 404 `CATEGORY_NOT_FOUND`, 400 `INVALID_CATEGORY`, 409 `CATEGORY_EXISTS` |
| `PUT /admin/menu/categories/order` `{names}` | 200 | 400 `INVALID_ORDER` |
| `DELETE /admin/menu/categories?name=X&base_revision=N` | 200 | 404 `CATEGORY_NOT_FOUND`, 409 `CATEGORY_NOT_EMPTY` |
| `POST /admin/menu/import/preview` `{rows, mode?}` | 200, `{revision, counts, rows[]}`; no write and no `base_revision` | 400 `NO_ROWS`, 400 `TOO_MANY_ROWS`, 409 `HUB_UNINITIALIZED` |
| `POST /admin/menu/import/commit` `{base_revision, rows, mode?, skip_invalid?, confirm_replace?}` | 200, `{revision, counts, skipped}` | 400 `CONFIRM_REQUIRED` (replace without `confirm_replace: true`), `NO_ROWS`, `TOO_MANY_ROWS`, `INVALID_ROWS` (with `details[]`), `NO_VALID_ROWS` |
| `PUT /admin/tables/layout` `{base_revision, sections, tables}` | 200, `{revision, tables, sections}` | 400 `INVALID_LAYOUT` (with `errors[]`), 409 `TABLE_HAS_OPEN_BILL` (with `details[]`) |

Failures common to every route: 403 `RECEPTION_ONLY`, 413 `PAYLOAD_TOO_LARGE`, 400 `INVALID_JSON`. Common to the writes: 409 `HUB_UNINITIALIZED`, 400 `BASE_REVISION_REQUIRED`, 409 `STALE_REVISION` (with `current_revision`), 500 `MUTATION_FAILED`, 500 `WRITE_FAILED`. Every failure uses `{ success:false, error, code }`.

### Additions from the review rounds (beyond the plan)

These are in the final code and are covered by tests (MT1-13 to MT1-22 below).

**`restaurantCache.js`**
- `applyPulledCatalog(kind, fresh)`: cloud data (boot sync, reconnect, the three realtime handlers) enters the cache only through this method. It runs in the same promise chain as `updateCatalog` and re-checks authority at the moment of writing, so a pull that was already in flight when the first edit committed loses instead of overwriting the edit and resetting `revision` to 0. Callers broadcast `menu_updated` / `tables_updated` only when it resolves `true`.
- `loadFromDisk` counts a catalog with `revision > 0` as present even when it is empty, so a deliberately emptied, hub-edited catalog survives an offline boot instead of leaving the hub "uninitialised" and bringing the demo tables back. Legacy caches with no `revision` keep the old rule (empty means missing).
- A fifth built-in failure, `MUTATION_FAILED` (500), for a mutator that throws. The others are `HUB_UNINITIALIZED`, `BASE_REVISION_REQUIRED`, `STALE_REVISION` and `WRITE_FAILED`.

**`menuAdmin.js`**
- Stricter than the plan: day-part `price` and `variant_prices` values must be valid prices; `days` must all be integers 0 to 6; modifier `min` is an integer >= 0 and `max` an integer >= 1 and >= `min`; option `price_delta` is a finite number; variant, group, option and day-part labels over 40 characters are rejected, not truncated.
- `updateItem` runs its duplicate check only when the (name, category) key changes, because cloud data can hold duplicate pairs and those items must stay editable (86'ing).
- New export `findCategory` (exact match, then case-insensitive), used by rename, delete and reorder; `reorderCategories` needs a canonical permutation (no case-variant duplicates).
- Hostile keys are checked with `Object.prototype.hasOwnProperty.call`.

**`menuImport.js`**
- Optional `idGen` (default `newItemId`) and a `usedIds` set: generated ids never collide with existing ids or with ids handed out earlier in the same import.
- `finalKeys` key-collision guard: a new row, or a row whose (name, category) key changes (an id-match rename or move), cannot collide with another existing item or with an earlier row's final key. A row that leaves its key unchanged is never blocked, so legacy duplicate pairs do not block re-imports.
- `claimedIds`: in replace mode every item matched by any row (valid or errored) survives, and so does every item sharing the normalised name of an errored, unmatched row. A bad row never deletes data.
- `NO_VALID_ROWS` (400) for replace and merge when `skip_invalid` leaves no valid row. The request is refused before it can bump the revision, write a backup, broadcast, or make the menu hub-authoritative.
- `station` is compared as `i.station || 'hot'`, so an export-then-import round trip reports "unchanged".

**`tablesAdmin.js`**
- Table ids must be a `number` or a `string` (type-checked before any `String()`); hostile ids return 400 instead of throwing.
- The open-bill set is normalised once (`new Set([...(openTableIds ?? [])].map(String))`), so numeric sets and arrays still lock. `null` and `undefined` mean "no open bills" and do not throw.
- Rename detection compares against the trimmed stored name.

**`server.js`**
- The open-bill set for a layout save is computed inside the `updateCatalog` mutator, so it reflects the open bills at the moment the edit actually runs in the write chain.
- `/admin`-scoped error handler: body-parser failures answer JSON, 413 `PAYLOAD_TOO_LARGE` and 400 `INVALID_JSON`; any other error falls through to Express's default handler. Routes outside `/admin` are unchanged.
- `requireReception` is mounted before the 2 MB import parser, so a non-reception host gets 403 before the hub reads any body.
- Strict `base_revision`: body routes accept only a JSON number, DELETE accepts only a `/^\d+$/` query string, anything else is 400 `BASE_REVISION_REQUIRED`.

**Test infrastructure**
- `helpers/spawnHub.mjs` boots a real hub on a throwaway data directory, requires a unique hub name from `/pairing-info` before it declares the hub ready, and fails fast when the child exits (the hub's crash handler swallows `EADDRINUSE` and exits 0, so an exit code alone cannot reveal a stale listener). `spawnHub.test.mjs` (port 4596) proves it. The route tests use ports 4598 (reception) and 4597 (handset); the existing `hub.test.mjs` uses 4599.

### Known limitations

- An offline first boot with no catalog returns 409 `HUB_UNINITIALIZED` for edits (and for import preview).
- `PUT /admin/menu/items/:id` merges the keys sent; send `[]` to clear variants, modifier groups or day-parts.
- A cloud pull does not bump `revision`. Before the first local edit, a layout save with `base_revision: 0` can therefore overwrite a layout that was just pulled. This is consistent with the single-writer trade-off: hub authority starts at the first edit.
- Express's default error pages (HTML with a stack trace, because `NODE_ENV` is unset) still appear on non-`/admin` routes. This is pre-existing and unchanged.
- `POST /orders` is not serialised with the catalog write chain. An order can land in the short window between a layout save's open-bill check and the end of its disk write (backup, write, rename).
- An import whose rows are all valid but unchanged is still committed (revision bump, backup, broadcast). `NO_VALID_ROWS` covers only an import that has no valid row at all.
- A table section literally named "All" is accepted by the hub and would clash with the waiter's "All" chip. Reserving the name is a follow-up.
- `WRITE_FAILED` and `MUTATION_FAILED` (both 500) are implemented but have no dedicated test.
- Phase 1 has no UI and no cloud push (Phases 2 and 3). The spec's `/admin` page route (plain "Reception only" 403 for non-local callers) belongs to Phase 2 and does not exist yet; Phase 1 adds the `/admin/*` API routes only.

### Security note (open recommendation, not changed in this phase)

`requireReception` trusts the socket address alone (loopback or the hub's own LAN address). CORS in `server.js` allows credentialed requests from any private-range origin, and nothing checks the `Host` or `Origin` header. A page served by another device on the LAN, or a DNS-rebinding page, that is open in a browser on the reception laptop can therefore send requests that arrive from a trusted address and drive `/admin/*`. `POST /tables/:id/clear` (guarded by `requireDevice`, which also trusts loopback) is exposed the same way today, so this is an existing class of exposure that the new routes inherit, not one they introduced.

Recommended follow-up, not implemented here: reject a request whose `Origin` header is present and is not the hub's own origin. That is a cheap partial hardening. A full defence also needs a `Host` allow-list.

## TEST CASES

All rows are automated (`node --test`, hubs spawned on temp data directories) except MT1-12, which was checked by hand. "Pass" means the test passed in the full-suite run recorded under VERIFICATION (232 of 232).

| ID | Title | Pre-conditions | Steps | Expected | Result |
|---|---|---|---|---|---|
| MT1-01 | Normaliser golden | none | `menuNormalize.test.mjs` (4 tests) | A hostile row keeps only its valid nested data (bad variants, groups and day-parts dropped, labels cut to 40, `days` filtered to 0 to 6, station lowercased); a plain row gets the legacy defaults and no optional keys; camelCase rows work; a bad price becomes 0. Equivalence with the old inline mapper was also checked once by hand (see VERIFICATION). | Pass |
| MT1-02 | Authority guard | menu edited once (revision 1), tables untouched (revision 0) | `catalogStore.test.mjs`: `handleReconnection` with stubbed cloud fetchers | The edited menu is not pulled (0 menu fetches) and is kept; the untouched tables still follow the cloud | Pass |
| MT1-03 | Stale or missing revision | menu at revision 1 | `catalogStore.test.mjs` and `catalogRoutes.test.mjs`: POST an item with `base_revision: 0`, then with none | 409 `STALE_REVISION` with `current_revision: 1`; 400 `BASE_REVISION_REQUIRED`; nothing written | Pass |
| MT1-04 | Concurrent edits | two writes on the same base | `catalogStore.test.mjs`: `Promise.all` of two `updateCatalog` calls | Exactly one succeeds, the other gets 409; the file holds one new item | Pass |
| MT1-05 | Backups and atomic write | 13 edits in a row | `catalogStore.test.mjs`: count `backups/menu_cache.*`; inspect after one edit | 10 backups kept; a backup holds the pre-edit menu; no `.tmp` file is left behind | Pass |
| MT1-06 | Reception only | second hub with `HUB_TRUST_LOOPBACK=false`; handset enrolled with a token | `catalogRoutes.test.mjs`: call all 10 admin route and method combinations with the token, plus one anonymous call | 403 `RECEPTION_ONLY` every time; `/menu` is still readable with the token (200); the revision stays 0 | Pass |
| MT1-07 | Big import | 2000 rows, body over 256 KB | `catalogRoutes.test.mjs`: preview and commit; then 2001 rows | 200 with 2000 new rows (the commit bumps the revision by 1); 2001 rows give 400 `TOO_MANY_ROWS` | Pass |
| MT1-08 | Import rules | menu with variants, a modifier group and a station | `menuImport.test.mjs` (30 tests, see also MT1-18 and MT1-19) | Match by id, then name and category (case-insensitive); field diffs; blank cells and absent columns never overwrite; modifiers and day-parts survive; variants keep id and 86'd state on a label match, new labels get slug ids, omitted labels go; `veg` required for new items; strict prices; spreadsheet row numbers (header is row 1); replace drops unmatched items and unused categories; row errors block unless `skip_invalid`; empty and over-2000 files refused | Pass |
| MT1-09 | Open-bill lock | open order on T1 | `tablesAdmin.test.mjs` (unit: rename and delete) and `catalogRoutes.test.mjs` (live hub: rename, then move and reseat T1) | 409 `TABLE_HAS_OPEN_BILL` with `details` naming the table and the action (`rename` or `delete`); moving sections and changing seats gives 200 | Pass |
| MT1-10 | No demo resurrection | layout with zero tables | `catalogRoutes.test.mjs`: PUT an empty layout, GET `/tables` | `count: 0`, `tables: []` | Pass |
| MT1-11 | Live broadcast | WebSocket client on `/live` | `catalogRoutes.test.mjs`: commit a layout, then a category | `tables_updated` and `menu_updated` received | Pass |
| MT1-12 | Waiter chips (manual) | throwaway hub on a copy of the data directory, waiter app in a dev server | Add a "Patio" section with a table via `PUT /admin/tables/layout`, select its chip, remove the section; repeat with the page's `/tables` responses rewritten to `sections: []` to exercise the fallback | The chip appears without a reload; removing the selected section snaps the selection back to All; the fallback derives chips from the tables | Manual only, not re-run (see VERIFICATION) |
| MT1-13 | In-flight cloud pull | a cloud fetch held pending while an edit commits | `catalogStore.test.mjs` (5 tests): `handleReconnection` for each catalog, the three realtime handlers (`menu_items`, `menu_categories`, `tables`), `applyPulledCatalog` queued behind an edit, and a pull with no edit | After the stale answer lands, the revision is still 1 and the edit survives in memory and on disk; no `*_updated` broadcast of stale data; the next reconnect does not even fetch. With no edit, the pull applies, stays at revision 0 and is broadcast, and a later edit on base 0 is accepted | Pass |
| MT1-14 | Emptied catalog survives an offline boot | `tables_cache.json` or `menu_cache.json` with `revision > 0` and zero rows; offline (`SUPABASE_URL` is the example host) | `catalogStore.test.mjs` (4 tests): `loadFromDisk`, `initCache`, then an edit; and the legacy case | The hub is not uninitialised, the empty catalog is served, the next edit is accepted (revision + 1). A legacy empty cache with no `revision` is still treated as missing and edits get `HUB_UNINITIALIZED` | Pass |
| MT1-15 | Body errors as JSON | live hub | `catalogRoutes.test.mjs` (3 tests): import body over 2 MB; admin body over 256 KB; malformed JSON on three admin routes; a bare JSON string; malformed JSON on `/orders` | 413 `PAYLOAD_TOO_LARGE`, 400 `INVALID_JSON`; the body is exactly `{success, error, code}` with no stack trace or path; `/orders` keeps Express's own non-JSON 400; nothing is written | Pass |
| MT1-16 | Guard before parse | handset hub | `catalogRoutes.test.mjs`: POST a body over 2 MB to both import routes, with a token and without | 403 `RECEPTION_ONLY` as JSON, not 413 | Pass |
| MT1-17 | Strict `base_revision` | live hub | `catalogRoutes.test.mjs`: odd values in the body and the query string | Body: only a JSON number passes; numeric strings, arrays, booleans, blanks, `0.5`, `1e400`, `{}` and `null` give 400 `BASE_REVISION_REQUIRED`. DELETE: only digits in the query pass; `abc`, `3.0`, a blank, a minus sign, a trailing space, hex, or the revision only in the body give 400. POST and PUT with the revision only in the query give 400. State is unchanged | Pass |
| MT1-18 | No-valid-row imports | one menu in memory (unit); live hub (route) | `menuImport.test.mjs` (4 `NO_VALID_ROWS` tests) and `catalogRoutes.test.mjs`: merge or replace with `skip_invalid` and only bad rows, including a wrong-case header file | 400 `NO_VALID_ROWS`; menu unchanged. On the route: revision unchanged in memory and on disk, no new backup file, no `menu_updated` broadcast. A valid-but-unchanged row still counts as valid, and one valid row among bad ones still applies | Pass |
| MT1-19 | Import id and key guards | `idGen` stubs; a menu with a legacy duplicate pair | `menuImport.test.mjs` | Generated ids never repeat an existing id or one handed out earlier in the import; an id-match rename or a new row onto an existing key gives `would duplicate "X" in Y`; a clash with an earlier row gives `duplicate of row N` in either order; an unchanged key is never blocked; in replace mode an errored row still keeps the item it matched or shares a name with; `station: hot` on an item with no station reads as unchanged | Pass |
| MT1-20 | Strict item validation | none | `menuAdmin.test.mjs` (24 tests) | Rejected, not truncated or coerced: prices that are null, blank, 0, negative or have 3 decimals; day-part `price`, `variant_prices` and `days` outside 0 to 6; modifier `min`, `max` and `price_delta`; labels over 40. Updating an item in a legacy duplicate pair works unless its key changes. Category matching is case-insensitive (rename re-labels items, reorder rejects case-variant duplicates). Hostile keys such as `hasOwnProperty` do not throw. Inputs are not mutated | Pass |
| MT1-21 | Table layout rules | none | `tablesAdmin.test.mjs` (20 tests) | Names unique case-insensitively (max 50), sections unique (max 60), seats whole numbers 1 to 50, ids never reused (`next_id`), hostile types give 400 without throwing or mutating, ids must be number or string, numeric open-bill sets and arrays still lock while `null` and `undefined` mean no open bills, rename detection uses the trimmed stored name | Pass |
| MT1-22 | Test harness refuses a stale listener | an unrelated HTTP server holds port 4596 | `spawnHub.test.mjs` | `startHub` rejects with an error naming the port, well inside 15 s, instead of reporting the stale server as the hub | Pass |

## VERIFICATION

Environment: Windows 10, Node v25.2.1, npm 11.6.2. `npm test` spawns real hubs on ports 4596 to 4599, each on a temp data directory. Run on `404cfa2` (no uncommitted code changes) on 2026-10-03.

### Full suite

`npm test` (exit code 0, no failing test in the output), summary lines as printed:

```
ℹ tests 232
ℹ suites 0
ℹ pass 232
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 9181.616
```

Per-file counts, each file run on its own with `node --test <file>`:

| Test file | Tests | Pass | Fail |
|---|---|---|---|
| `menuNormalize.test.mjs` | 4 | 4 | 0 |
| `catalogStore.test.mjs` | 17 | 17 | 0 |
| `menuAdmin.test.mjs` | 24 | 24 | 0 |
| `menuImport.test.mjs` | 30 | 30 | 0 |
| `tablesAdmin.test.mjs` | 20 | 20 | 0 |
| `catalogRoutes.test.mjs` | 19 | 19 | 0 |
| `spawnHub.test.mjs` | 1 | 1 | 0 |
| **New in this phase** | **115** | **115** | **0** |
| `hub.test.mjs` (existing, untouched) | 115 | 115 | 0 |
| `syncQueue.test.mjs` (existing, untouched) | 2 | 2 | 0 |
| **Suite total** | **232** | **232** | **0** |

The suite had 117 tests before this phase (the two existing files); this phase added 115.

### Compile check

`npm run build` was not used: it empties and rewrites `dist/`, which a dev hub serves. The production bundle was built into a scratch directory instead:

```
npx vite build --outDir <scratch dir>/dist-check --emptyOutDir
```

Summary lines as printed (colour codes removed), exit code 0:

```
vite v6.4.3 building for production...
✓ 2241 modules transformed.
✓ built in 22.38s
```

The scratch build's `waiter-*.js` bundle no longer contains the hard-coded `["All","Main Hall","AC Room","Family Room"]` chip list (0 occurrences; the untouched, older `dist/` still has it). The repo's `dist/` was not touched (104 files, same newest modification time before and after).

### One-off checks run while writing this report

These used scratch scripts that were not committed, so they are evidence for this report and not part of CI.

- **Normaliser equivalence.** The old inline mapper was extracted straight from `git show 82941b5:hub_server/lib/restaurantCache.js` and compared with `normalizeCloudMenuItem` on 50,009 rows (the 9 demo-seed items plus 50,000 seeded random rows full of malformed variants, modifier groups, day-parts and odd scalars): 0 mismatches.
- **Open-bill lock inputs.** `applyLayout` refuses a rename of an open-bill table (409 `TABLE_HAS_OPEN_BILL`) when the open set is `Set(['1'])`, `Set([1])`, `[1]` or `['1']`, and allows it when the set is `null`, `undefined` or empty.

### Manual check (MT1-12)

The waiter chip change is verified by hand only. There is no UI test runner in this project and none is claimed. The Task 7 implementer ran a throwaway hub (a copy of the data directory, Supabase pointed at a dummy URL so nothing synced) and a Vite dev server on non-default ports, then drove `PUT /admin/tables/layout` four times (add a section and table, select the chip, remove the section; then the same with the page's `/tables` responses rewritten to `sections: []` for the fallback) while reading the waiter page's DOM in the Browser pane (page text and a MutationObserver). The page was never reloaded during the check (an in-page marker and `performance.timeOrigin` stayed the same). It used DOM reads and no screenshots as evidence. The browser console was not empty: it held service-worker registration and port-4000 polling errors that are unrelated to this change. The check is not part of `npm test` or any CI, and it was not re-run for this report; for the waiter files, this report's own evidence is the compile check above.

### Side effects of the verification run

`hub.test.mjs` (existing M1 crash test) appends fixture entries to the git-ignored `hub_server/data/crash_log.json`. No other file under `hub_server/data` changed (SHA-256 compared before and after), and no `backups/` directory was created there.

## OUT OF SCOPE (later phases)

- **Phase 2:** `admin.html` and `src/admin/*` (menu tab, import dialog, tables tab), the `/admin` page route with its plain "Reception only" 403, and a "Menu & Tables" link on the KDS header.
- **Phase 3:** cloud write-through (migration `003_menu_tables_hub_authority.sql`, `SYNC_MENU` / `SYNC_TABLES` queue operations, `hub_ref`, per-catalog `synced_revision` on `/sync-status`).
- Retiring the legacy `SelfServeAdminView` / `PosContext` admin actions (separate cleanup, per the spec's non-goals).
- The `Origin` / `Host` hardening described in the security note.

---

## STATUS: VERIFIED & COMMITTED

- 232 of 232 hub tests pass (115 new); the production bundle compiles.
- The waiter chip change (MT1-12) is a manual check only.
- One open recommendation (the `Origin` / `Host` hardening); nothing in this phase changed it.
