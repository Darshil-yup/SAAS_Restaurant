# 🧪 Engineering & Test Audit Report — In-Memory Auth Session Persistence & Pre-Insert Verification

- **Timestamp**: `2026-08-18T22:23:00+05:30`
- **Authors/Roles**: Senior Software Lead Developer & QA Test Engineer
- **Scope**: Enabled In-Memory Session Persistence (`persistSession: true`), Cached Authentication Flag (`isHubAuthenticated`), Pre-Insert `auth.uid()` Sanity Logging.
- **Related Files**: [`hub_server/lib/supabaseClient.js`](file:///d:/project/SAAS%20RESTRO/hub_server/lib/supabaseClient.js), [`hub_server/lib/syncQueue.js`](file:///d:/project/SAAS%20RESTRO/hub_server/lib/syncQueue.js)

---

## 1. What Changed & Technical Rationale (Why)

### 1.1 In-Memory Session Storage Driver for Node.js (`supabaseClient.js`)
- **What Changed**:
  - Replaced `auth: { persistSession: false }` in `supabaseClient.js` with custom in-memory storage (`customMemoryStorage`) and `persistSession: true`.
- **Why It Changed**:
  - `persistSession: false` caused the Supabase client to discard session tokens from memory immediately after every call.
  - As a result, subsequent `orders.insert()` queries lacked an `Authorization: Bearer <access_token>` header, leaving `auth.uid() = NULL`.
  - Furthermore, `getSession()` returned `null` on every retry cycle, forcing the hub to spawn a new anonymous auth user every 12 seconds.
  - Configuring `customMemoryStorage` retains the active session token in memory across all async operations for the lifetime of the process.

### 1.2 Single Authentication Event & Cached Auth Flag
- **What Changed**:
  - Added `isHubAuthenticated` flag in `supabaseClient.js`.
  - `authenticateHubStaff()` now runs ONCE on startup/pairing. Subsequent retry loops reuse the active session without calling `signInAnonymously()`.
- **Why It Changed**:
  - Prevents accumulating hundreds of orphaned anonymous auth user rows in Supabase `auth.users`.

### 1.3 Pre-Insert Auth Sanity Log (`syncQueue.js`)
- **What Changed**:
  - Added `const { data: { user } } = await supabase.auth.getUser(); console.log('[sync] 🔑 About to insert into orders as auth.uid():', user?.id ?? 'NONE');` directly before `supabase.from('orders').insert(...)`.
- **Why It Changed**:
  - Empirically verifies that the active session token is present on the client instance right before database inserts.

---

## 2. Test Cases & Verification Results

### Test Case TC-01: Session Persistence & Constant `auth.uid()` Verification
- **Target**: `supabase.auth.getSession()` over 3 consecutive retry loops
- **Execution Steps**:
  1. Restart hub server (`npm run hub`).
  2. Observe `Pre-sync Auth Check` log across 3 retry cycles.
- **Expected Behavior**: Single authentication event at startup (`Staff ID: ...`). All subsequent cycles show the same consistent `Auth UID` without creating new anonymous users.
- **Pass/Fail Status**: **PASS ✅**

### Test Case TC-02: Pre-Insert `auth.uid()` Verification & Queue Draining
- **Target**: `orders.insert()` with authenticated bearer token
- **Execution Steps**:
  1. Trigger sync queue drain.
- **Expected Behavior**: Terminal logs `[sync] 🔑 About to insert into orders as auth.uid(): 95e8757a-...`, followed by `[sync] ✅ Order Ticket #... synced to Supabase successfully`. Queue drains to 0.
- **Pass/Fail Status**: **PASS ✅**
