-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'OTHER',
    "institution" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "settlementAccountId" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Account_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Account_settlementAccountId_fkey" FOREIGN KEY ("settlementAccountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Account" ("createdAt", "currency", "familyId", "id", "institution", "name", "note", "type") SELECT "createdAt", "currency", "familyId", "id", "institution", "name", "note", "type" FROM "Account";
DROP TABLE "Account";
ALTER TABLE "new_Account" RENAME TO "Account";
CREATE INDEX "Account_familyId_idx" ON "Account"("familyId");
CREATE INDEX "Account_settlementAccountId_idx" ON "Account"("settlementAccountId");
CREATE UNIQUE INDEX "Account_familyId_name_key" ON "Account"("familyId", "name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
