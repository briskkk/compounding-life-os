-- CreateTable
CREATE TABLE "Liability" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'MORTGAGE',
    "rate" REAL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Liability_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LiabilityEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "liabilityId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LiabilityEntry_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LiabilityEntry_liabilityId_fkey" FOREIGN KEY ("liabilityId") REFERENCES "Liability" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PriceBar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "close" DECIMAL NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'SIMULATED'
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Snapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "assets" DECIMAL NOT NULL DEFAULT 0,
    "liabilities" DECIMAL NOT NULL DEFAULT 0,
    "netWorth" DECIMAL NOT NULL,
    "investable" DECIMAL NOT NULL,
    "contributions" DECIMAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Snapshot_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Snapshot" ("createdAt", "date", "familyId", "id", "investable", "netWorth") SELECT "createdAt", "date", "familyId", "id", "investable", "netWorth" FROM "Snapshot";
DROP TABLE "Snapshot";
ALTER TABLE "new_Snapshot" RENAME TO "Snapshot";
CREATE UNIQUE INDEX "Snapshot_familyId_date_key" ON "Snapshot"("familyId", "date");
CREATE TABLE "new_Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" DECIMAL,
    "price" DECIMAL,
    "amount" DECIMAL NOT NULL DEFAULT 0,
    "fee" DECIMAL NOT NULL DEFAULT 0,
    "occurredAt" DATETIME NOT NULL,
    "note" TEXT,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "voidedAt" DATETIME,
    "reversalOfId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Transaction_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("accountId", "amount", "assetId", "createdAt", "familyId", "fee", "id", "note", "occurredAt", "price", "quantity", "type") SELECT "accountId", "amount", "assetId", "createdAt", "familyId", "fee", "id", "note", "occurredAt", "price", "quantity", "type" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE INDEX "Transaction_familyId_occurredAt_idx" ON "Transaction"("familyId", "occurredAt");
CREATE INDEX "Transaction_familyId_assetId_idx" ON "Transaction"("familyId", "assetId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Liability_familyId_idx" ON "Liability"("familyId");

-- CreateIndex
CREATE INDEX "LiabilityEntry_familyId_occurredAt_idx" ON "LiabilityEntry"("familyId", "occurredAt");

-- CreateIndex
CREATE INDEX "PriceBar_symbol_idx" ON "PriceBar"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "PriceBar_symbol_date_key" ON "PriceBar"("symbol", "date");
