-- Legacy rows remain version 1 and retain link-only verification.
-- New rows use version 2 and can be verified against their persisted contents.
ALTER TABLE "AuditLog" ADD COLUMN "hashVersion" INTEGER NOT NULL DEFAULT 1;
