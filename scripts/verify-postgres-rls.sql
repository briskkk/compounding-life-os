\set ON_ERROR_STOP on

DROP ROLE IF EXISTS fwos_rls_test;
CREATE ROLE fwos_rls_test;
GRANT USAGE ON SCHEMA public TO fwos_rls_test;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fwos_rls_test;

INSERT INTO "FamilySpace" ("id", "name", "baseCurrency", "createdAt") VALUES
  ('rls-family-a', 'RLS A', 'CNY', NOW()),
  ('rls-family-b', 'RLS B', 'CNY', NOW());
INSERT INTO "Account" ("id", "familyId", "name", "type", "currency", "createdAt") VALUES
  ('rls-account-a', 'rls-family-a', 'A account', 'BANK', 'CNY', NOW()),
  ('rls-account-b', 'rls-family-b', 'B account', 'BANK', 'CNY', NOW());

SET ROLE fwos_rls_test;
SET app.family_id = 'rls-family-a';

DO $$
DECLARE visible_count integer;
DECLARE changed_count integer;
BEGIN
  SELECT count(*) INTO visible_count FROM "Account";
  IF visible_count <> 1 THEN
    RAISE EXCEPTION 'RLS read isolation failed: expected 1, got %', visible_count;
  END IF;

  UPDATE "Account" SET "note" = 'forbidden' WHERE "id" = 'rls-account-b';
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 0 THEN
    RAISE EXCEPTION 'RLS update isolation failed: changed % rows', changed_count;
  END IF;

  BEGIN
    INSERT INTO "Account" ("id", "familyId", "name", "type", "currency", "createdAt")
      VALUES ('rls-cross-write', 'rls-family-b', 'forbidden', 'BANK', 'CNY', NOW());
    RAISE EXCEPTION 'RLS cross-family insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;

RESET ROLE;
DELETE FROM "FamilySpace" WHERE "id" IN ('rls-family-a', 'rls-family-b');
DROP OWNED BY fwos_rls_test;
DROP ROLE fwos_rls_test;
