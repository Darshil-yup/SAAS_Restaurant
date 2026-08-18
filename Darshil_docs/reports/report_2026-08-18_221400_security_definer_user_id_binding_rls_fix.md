# 🧪 Engineering & Test Audit Report — SECURITY DEFINER User ID Binding for Supabase RLS

- **Timestamp**: `2026-08-18T22:14:00+05:30`
- **Authors/Roles**: Senior Software Lead Developer & QA Test Engineer
- **Scope**: Fix Supabase RLS `42501` Policy Violation by binding `user_id` inside `SECURITY DEFINER` RPC `provision_kitchen_staff`.
- **Related Files**: [`database/supabase_schema.sql`](file:///d:/project/SAAS%20RESTRO/database/supabase_schema.sql), [`hub_server/lib/supabaseClient.js`](file:///d:/project/SAAS%20RESTRO/hub_server/lib/supabaseClient.js)

---

## 1. What Changed & Technical Rationale (Why)

### 1.1 `SECURITY DEFINER` `user_id` Binding in `provision_kitchen_staff` RPC
- **What Changed**:
  - Updated `provision_kitchen_staff(p_restaurant_id UUID, p_pin TEXT, p_user_id UUID DEFAULT auth.uid())` in `database/supabase_schema.sql` to accept `p_user_id`.
  - Inside the RPC, `user_id` is assigned directly to the `staff_users` table record during insertion or updated if an existing kitchen staff row exists.
  - Updated `authenticateHubStaff()` in `hub_server/lib/supabaseClient.js` to pass `p_user_id: userId`.
- **Why It Changed**:
  - Previously, `provision_kitchen_staff` created a kitchen staff row with `user_id = NULL`.
  - When `supabaseClient.js` attempted to update `staff_users` with `user_id` post-RPC, client-side Row Level Security (RLS) blocked the update because `current_restaurant_id()` evaluated to `NULL` for an unlinked `auth.uid()`.
  - As a result, `user_id` remained `NULL` on `staff_users`, causing all subsequent `orders` inserts to fail with Postgres RLS error `42501` (`new row violates row-level security policy for table "orders"`).
  - Executing `user_id` assignment directly inside the `SECURITY DEFINER` RPC bypasses client-side RLS locks and guarantees instant tenant mapping.

---

## 2. Test Cases & Verification Results

### Test Case TC-01: RPC User ID Binding Verification
- **Target**: `provision_kitchen_staff` RPC execution
- **Execution Steps**:
  1. Authenticate hub anonymously (`auth.uid() = 95e8757a-ab0e-4f8c-922f-151997d010b8`).
  2. Execute `provision_kitchen_staff(p_restaurant_id, p_pin, p_user_id)`.
- **Expected Behavior**: `staff_users` record is inserted/updated with `user_id = 95e8757a-ab0e-4f8c-922f-151997d010b8` and `restaurant_id = 11111111-1111-1111-1111-111111111111`.
- **Pass/Fail Status**: **PASS ✅**

### Test Case TC-02: Supabase Order Sync RLS Evaluation
- **Target**: `orders` table insert with `current_restaurant_id()`
- **Execution Steps**:
  1. Trigger cloud sync queue processing.
- **Expected Behavior**: `current_restaurant_id()` resolves to `'11111111-1111-1111-1111-111111111111'`. Order insert passes RLS policy checks and syncs to Supabase.
- **Pass/Fail Status**: **PASS ✅**
