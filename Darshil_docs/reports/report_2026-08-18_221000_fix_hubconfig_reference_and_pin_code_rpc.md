# 🧪 Engineering & Test Audit Report — HubConfig Import & Kitchen Staff Provisioning RPC

- **Timestamp**: `2026-08-18T22:10:00+05:30`
- **Authors/Roles**: Senior Software Lead Developer & QA Test Engineer
- **Scope**: Fix `ReferenceError: hubConfig is not defined`, Replace `pin_code` column insert with `provision_kitchen_staff` RPC function & `pin_hash` pgcrypto hashing.
- **Related Files**: [`hub_server/lib/syncQueue.js`](file:///d:/project/SAAS%20RESTRO/hub_server/lib/syncQueue.js), [`hub_server/lib/supabaseClient.js`](file:///d:/project/SAAS%20RESTRO/hub_server/lib/supabaseClient.js), [`hub_server/lib/hubConfig.js`](file:///d:/project/SAAS%20RESTRO/hub_server/lib/hubConfig.js), [`database/supabase_schema.sql`](file:///d:/project/SAAS%20RESTRO/database/supabase_schema.sql)

---

## 1. What Changed & Technical Rationale (Why)

### 1.1 Fix `ReferenceError: hubConfig is not defined` (Bug 1)
- **What Changed**:
  - Imported `hubConfig` from `./hubConfig.js` at the top of [`hub_server/lib/syncQueue.js`](file:///d:/project/SAAS%20RESTRO/hub_server/lib/syncQueue.js).
- **Why It Changed**:
  - `processQueue()` in `syncQueue.js` referenced `hubConfig.getPairingInfo()`, but `hubConfig` was not imported into the file's module scope. This caused a `ReferenceError` on every sync execution before any network attempt was made.

### 1.2 Replace `pin_code` Column Insert with `provision_kitchen_staff` RPC (Bug 2)
- **What Changed**:
  - Created `provision_kitchen_staff(p_restaurant_id UUID, p_pin TEXT)` PostgreSQL RPC function in [`database/supabase_schema.sql`](file:///d:/project/SAAS%20RESTRO/database/supabase_schema.sql).
  - Updated `authenticateHubStaff()` in [`hub_server/lib/supabaseClient.js`](file:///d:/project/SAAS%20RESTRO/hub_server/lib/supabaseClient.js) to call `supabase.rpc('provision_kitchen_staff', { p_restaurant_id, p_pin })`.
  - Added `kitchen_pin` management to [`hub_server/lib/hubConfig.js`](file:///d:/project/SAAS%20RESTRO/hub_server/lib/hubConfig.js) so the hub provisions a machine PIN once during initial setup.
- **Why It Changed**:
  - The live Supabase schema uses `pin_hash` (hashed with `pgcrypto` `crypt(pin, gen_salt('bf'))`), NOT a plain-text `pin_code` column.
  - Calling the dedicated `provision_kitchen_staff` RPC ensures password security rules are enforced while creating the kitchen staff role identity for the hub.

---

## 2. Test Cases & Verification Results

### Test Case TC-01: Module Scope & Import Verification
- **Target**: `syncQueue.js` execution
- **Execution Steps**:
  1. Trigger `syncQueue.processQueue()`.
- **Expected Behavior**: No `ReferenceError: hubConfig is not defined` occurs. `getPairingInfo()` resolves cleanly.
- **Pass/Fail Status**: **PASS ✅**

### Test Case TC-02: Kitchen Staff RPC Provisioning & Session Binding
- **Target**: `authenticateHubStaff(restaurant_id, kitchenPin)`
- **Execution Steps**:
  1. Call `authenticateHubStaff()`.
  2. Verify RPC `provision_kitchen_staff` generates `pin_hash` and binds anonymous user ID to `staff_users` record.
- **Expected Behavior**: `staff_users` kitchen role record is created/linked without schema column error.
- **Pass/Fail Status**: **PASS ✅**
