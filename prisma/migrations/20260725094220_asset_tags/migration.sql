-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cls" TEXT NOT NULL,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "tags" TEXT NOT NULL DEFAULT '',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Asset_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Asset" ("cls", "createdAt", "currency", "familyId", "id", "manual", "name", "note", "symbol") SELECT "cls", "createdAt", "currency", "familyId", "id", "manual", "name", "note", "symbol" FROM "Asset";
DROP TABLE "Asset";
ALTER TABLE "new_Asset" RENAME TO "Asset";
CREATE INDEX "Asset_familyId_idx" ON "Asset"("familyId");
CREATE UNIQUE INDEX "Asset_familyId_symbol_key" ON "Asset"("familyId", "symbol");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
