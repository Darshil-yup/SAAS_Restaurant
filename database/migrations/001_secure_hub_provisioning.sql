-- =====================================================================
-- 001 — Secure hub provisioning (fixes cross-tenant takeover)
-- =====================================================================
--
-- PROBLEM
-- The original public.provision_kitchen_staff() was SECURITY DEFINER with no
-- authorisation check and was callable by `anon`. Because the Supabase anon key
-- ships inside the client bundle, anyone could call:
--
--   rpc('provision_kitchen_staff', {
--     p_restaurant_id: '<any tenant uuid>', p_pin: 'x', p_user_id: '<their uid>'
--   })
--
-- ...which rebound that tenant's `kitchen` staff row to the caller's auth.uid().
-- current_restaurant_id() then resolved to the victim's tenant and every RLS
-- policy handed over their orders, menu, staff, revenue and waitlist PII. It also
-- unbound the victim's own hub, silently killing their cloud sync.
--
-- FIX
--   1. The hub must present a per-restaurant provisioning secret it cannot guess.
--   2. The function binds auth.uid() only -- callers can no longer name an
--      arbitrary user id to bind.
--   3. EXECUTE is revoked from anon/public.
--   4. Both SECURITY DEFINER functions pin search_path (privilege-escalation
--      hardening; without it a caller-controlled search_path can shadow the
--      objects these functions reference).
--
-- Safe to run more than once.
-- =====================================================================

BEGIN;

-- crypt()/gen_salt() were already used by the old function but pgcrypto was never
-- installed, so that code path always threw.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Per-restaurant hub provisioning secret
-- ---------------------------------------------------------------------
ALTER TABLE public.restaurants
    ADD COLUMN IF NOT EXISTS hub_provisioning_secret_hash TEXT;

COMMENT ON COLUMN public.restaurants.hub_provisioning_secret_hash IS
    'bcrypt hash of the secret a reception hub must present to bind itself to this tenant. Set via set_hub_provisioning_secret().';

-- ---------------------------------------------------------------------
-- 2. Harden the tenant resolver
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_restaurant_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT restaurant_id
    FROM public.staff_users
    WHERE user_id = auth.uid()
    LIMIT 1;
$$;

-- ---------------------------------------------------------------------
-- 3. Replace the vulnerable provisioning function
-- ---------------------------------------------------------------------
-- The old 3-argument signature must be dropped explicitly: CREATE OR REPLACE
-- cannot change a function's argument list, so leaving it in place would keep the
-- vulnerable version callable alongside the new one.
DROP FUNCTION IF EXISTS public.provision_kitchen_staff(UUID, TEXT, UUID);
DROP FUNCTION IF EXISTS public.provision_kitchen_staff(UUID, TEXT);

CREATE FUNCTION public.provision_kitchen_staff(
    p_restaurant_id UUID,
    p_provisioning_secret TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid          UUID := auth.uid();
    v_secret_hash  TEXT;
    v_existing_id  UUID;
    v_new_id       UUID;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required to provision a hub'
            USING ERRCODE = '28000';
    END IF;

    -- Reading through SECURITY DEFINER intentionally bypasses RLS here. Only the
    -- hash is read, and it is never returned to the caller.
    SELECT hub_provisioning_secret_hash
      INTO v_secret_hash
      FROM public.restaurants
     WHERE id = p_restaurant_id;

    -- Identical error for "no such restaurant", "not configured" and "wrong
    -- secret" so this cannot be used to enumerate tenant ids.
    IF v_secret_hash IS NULL
       OR p_provisioning_secret IS NULL
       OR v_secret_hash <> crypt(p_provisioning_secret, v_secret_hash) THEN
        RAISE EXCEPTION 'Invalid hub provisioning credentials'
            USING ERRCODE = '28000';
    END IF;

    SELECT id INTO v_existing_id
      FROM public.staff_users
     WHERE restaurant_id = p_restaurant_id AND role = 'kitchen'
     LIMIT 1;

    -- Rebinding is legitimate (hub reinstall, new laptop) and is now gated behind
    -- the provisioning secret.
    IF v_existing_id IS NOT NULL THEN
        UPDATE public.staff_users
           SET user_id = v_uid
         WHERE id = v_existing_id;
        RETURN v_existing_id;
    END IF;

    INSERT INTO public.staff_users (restaurant_id, user_id, full_name, role)
    VALUES (p_restaurant_id, v_uid, 'Kitchen Hub', 'kitchen')
    RETURNING id INTO v_new_id;

    RETURN v_new_id;
END;
$$;

-- Callable only by a signed-in session (the hub's anonymous session qualifies),
-- and even then only with the secret.
REVOKE ALL ON FUNCTION public.provision_kitchen_staff(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provision_kitchen_staff(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.current_restaurant_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_restaurant_id() TO authenticated;

-- ---------------------------------------------------------------------
-- 4. Operator helper for setting a restaurant's secret
-- ---------------------------------------------------------------------
-- Not exposed to the API: run it from the Supabase SQL editor during onboarding,
-- then put the plaintext secret in that hub's .env as HUB_PROVISIONING_SECRET.
CREATE OR REPLACE FUNCTION public.set_hub_provisioning_secret(
    p_restaurant_id UUID,
    p_secret TEXT
)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    UPDATE public.restaurants
       SET hub_provisioning_secret_hash = crypt(p_secret, gen_salt('bf'))
     WHERE id = p_restaurant_id;
$$;

REVOKE ALL ON FUNCTION public.set_hub_provisioning_secret(UUID, TEXT) FROM PUBLIC, anon, authenticated;

COMMIT;

-- =====================================================================
-- ONBOARDING (run once per restaurant, from the Supabase SQL editor)
-- =====================================================================
--   SELECT public.set_hub_provisioning_secret(
--       '11111111-1111-1111-1111-111111111111',
--       'a-long-random-secret-for-this-restaurant'
--   );
--
-- Then on that restaurant's reception laptop, in hub_server/.env:
--   HUB_PROVISIONING_SECRET=a-long-random-secret-for-this-restaurant
--
-- VERIFY THE FIX (should raise "Invalid hub provisioning credentials"):
--   SELECT public.provision_kitchen_staff(
--       '22222222-2222-2222-2222-222222222222', 'guess'
--   );
-- =====================================================================
