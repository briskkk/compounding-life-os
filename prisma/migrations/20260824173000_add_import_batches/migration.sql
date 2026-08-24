-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "sourceName" TEXT,
    "rowCount" INTEGER NOT NULL,
    "importedCount" INTEGER NOT NULL,
    "failedCount" INTEGER NOT NULL,
    "settleCash" BOOLEAN NOT NULL DEFAULT false,
    "totalAmount" DECIMAL NOT NULL DEFAULT 0,
    "totalFees" DECIMAL NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImportBatch_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "navDate" DATETIME,
    "navSource" TEXT,
    "settlementDate" DATETIME,
    "note" TEXT,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "voidedAt" DATETIME,
    "reversalOfId" TEXT,
    "settleOfId" TEXT,
    "importBatchId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Transaction_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("accountId", "amount", "assetId", "createdAt", "familyId", "fee", "id", "internal", "navDate", "navSource", "note", "occurredAt", "price", "quantity", "reversalOfId", "settlementDate", "settleOfId", "type", "voidedAt") SELECT "accountId", "amount", "assetId", "createdAt", "familyId", "fee", "id", "internal", "navDate", "navSource", "note", "occurredAt", "price", "quantity", "reversalOfId", "settlementDate", "settleOfId", "type", "voidedAt" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE INDEX "Transaction_familyId_occurredAt_idx" ON "Transaction"("familyId", "occurredAt");
CREATE INDEX "Transaction_familyId_assetId_idx" ON "Transaction"("familyId", "assetId");
CREATE INDEX "Transaction_importBatchId_idx" ON "Transaction"("importBatchId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_familyId_contentHash_key" ON "ImportBatch"("familyId", "contentHash");
CREATE INDEX "ImportBatch_familyId_createdAt_idx" ON "ImportBatch"("familyId", "createdAt");
