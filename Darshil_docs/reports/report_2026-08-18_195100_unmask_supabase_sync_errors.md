# 🧪 Engineering & Test Audit Report — Unmasking Supabase Sync & RLS Errors

- **Timestamp**: `2026-08-18T19:51:00+05:30`
- **Authors/Roles**: Senior Software Lead Developer & QA Test Engineer
- **Scope**: Network vs RLS/Auth Error Separation, Pre-Sync Auth Session Audit Logging, Unmasked Supabase Payload Error Output.
- **Related Files**: [`hub_server/lib/supabaseClient.js`](file:///d:/project/SAAS%20RESTRO/hub_server/lib/supabaseClient.js), [`hub_server/lib/syncQueue.js`](file:///d:/project/SAAS%20RESTRO/hub_server/lib/syncQueue.js)

---

## 1. What Changed & Technical Rationale (Why)

### 1.1 Separation of True Network Errors from Supabase API/RLS Errors
- **What Changed**:
  - Refactored `checkSupabaseConnection()` in `supabaseClient.js` to issue a `fetch` request to `${SUPABASE_URL}/rest/v1/`.
  - Any HTTP response (200, 400, 401, 403, 404, etc.) confirms the network IS ONLINE. Only network-level failures (`ENOTFOUND`, `ECONNREFUSED`, `fetch failed`) report `online = false`.
- **Why It Changed**:
  - Previously, `checkSupabaseConnection()` ran `supabase.from('restaurants').select('id').limit(1)`. When Row Level Security (RLS) rejected the query, it returned an error, causing `checkSupabaseConnection()` to return `false`.
  - This falsely logged `"Cloud connection unavailable"` on every sync attempt, hiding real RLS, auth session expiry, or database constraint failures under the guise of an offline network.

### 1.2 Pre-Sync Auth Session & Tenant Audit Logging
- **What Changed**:
  - In `processQueue()` in `syncQueue.js`, added pre-sync audit logging:
    `[sync] 🔐 Pre-sync Auth Check: Auth UID=..., Restaurant ID=..., Paired=...`
  - Added automatic re-authentication via `authenticateHubStaff(pairing.restaurant_id)` if the session is missing while the hub is paired.
- **Why It Changed**:
  - Ensures the hub's anonymous auth session mapped to `role = 'kitchen'` in `staff_users` is validated prior to every sync attempt.

### 1.3 Unmasked Supabase Error Payload Output
- **What Changed**:
  - Refactored `syncOrderToSupabase()` and `syncStatusToSupabase()` in `syncQueue.js`.
  - If `supabase.from('orders').insert(...)` fails, it logs full structured error details:
    ```javascript
    console.error('[sync] ❌ Supabase Order Insert Failed:', {
      message: orderErr.message,
      code: orderErr.code || 'unknown',
      status: orderErr.status || 'unknown',
      details: orderErr.details || orderErr.hint || null,
      ticket_number: ticket.ticket_number,
      restaurant_id: restId
    });
    ```
- **Why It Changed**:
  - Exposes exact Postgres / Supabase error codes (e.g. `42501` RLS violation, `PGRST301` auth rejection, foreign key errors) directly in the terminal log.

---

## 2. Test Cases & Verification Results

### Test Case TC-01: Network Reachability vs RLS Error Separation
- **Target**: `checkSupabaseConnection()`
- **Execution Steps**:
  1. Ping Supabase REST API endpoint with working internet.
- **Expected Behavior**: Returns `online = true` regardless of RLS query restrictions.
- **Pass/Fail Status**: **PASS ✅**

### Test Case TC-02: Pre-Sync Auth & Error Detail Terminal Inspection
- **Target**: `processQueue()` & `syncOrderToSupabase()`
- **Execution Steps**:
  1. Restart hub server with pending sync queue.
  2. Observe terminal log output during the next scheduled retry loop (12s).
- **Expected Behavior**: Logs pre-sync Auth UID & Tenant ID, followed by specific Supabase order insert error payload if RLS / auth fails.
- **Pass/Fail Status**: **PASS ✅**
