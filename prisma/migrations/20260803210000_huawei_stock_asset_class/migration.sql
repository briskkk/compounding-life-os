-- Replace the incorrectly modeled RSU asset class with Huawei employee shares.
-- SQLite stores Prisma enums as TEXT, so existing rows can be migrated in place.
UPDATE "Asset"
SET "cls" = 'HUAWEI_STOCK', "manual" = 1
WHERE "cls" = 'RSU';

-- Historical VEST rows are intentionally retained for audit continuity.
-- The application treats them as legacy no-op entries and no longer allows new ones.
