-- 公司行动是证据包；实际数量、成本和现金变化继续由关联 Transaction 重放。
CREATE TABLE "CorporateAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "targetAccountId" TEXT,
    "assetId" TEXT NOT NULL,
    "targetAssetId" TEXT,
    "type" TEXT NOT NULL,
    "effectiveAt" DATETIME NOT NULL,
    "ratioNumerator" DECIMAL,
    "ratioDenominator" DECIMAL,
    "quantityBefore" DECIMAL,
    "quantityAfter" DECIMAL,
    "cashAmount" DECIMAL NOT NULL DEFAULT 0,
    "fee" DECIMAL NOT NULL DEFAULT 0,
    "costAllocation" REAL,
    "sourceName" TEXT,
    "sourceReference" TEXT,
    "note" TEXT,
    "reversedAt" DATETIME,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CorporateAction_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CorporateAction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CorporateAction_targetAccountId_fkey" FOREIGN KEY ("targetAccountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CorporateAction_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CorporateAction_targetAssetId_fkey" FOREIGN KEY ("targetAssetId") REFERENCES "Asset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "CorporateAction_familyId_effectiveAt_idx" ON "CorporateAction"("familyId", "effectiveAt");
CREATE INDEX "CorporateAction_accountId_assetId_idx" ON "CorporateAction"("accountId", "assetId");
CREATE INDEX "CorporateAction_targetAccountId_idx" ON "CorporateAction"("targetAccountId");
CREATE INDEX "CorporateAction_targetAssetId_idx" ON "CorporateAction"("targetAssetId");

-- SQLite 无法为既有列直接增加外键，重建交易表以保持关系完整性。
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
    "corporateActionId" TEXT,
    "clientRequestId" TEXT,
    "clientRequestHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Transaction_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_corporateActionId_fkey" FOREIGN KEY ("corporateActionId") REFERENCES "CorporateAction" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_Transaction" (
    "accountId", "amount", "assetId", "clientRequestHash", "clientRequestId", "createdAt",
    "familyId", "fee", "id", "importBatchId", "internal", "navDate", "navSource", "note",
    "occurredAt", "price", "quantity", "reversalOfId", "settlementDate", "settleOfId", "type", "voidedAt"
)
SELECT
    "accountId", "amount", "assetId", "clientRequestHash", "clientRequestId", "createdAt",
    "familyId", "fee", "id", "importBatchId", "internal", "navDate", "navSource", "note",
    "occurredAt", "price", "quantity", "reversalOfId", "settlementDate", "settleOfId", "type", "voidedAt"
FROM "Transaction";

DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE INDEX "Transaction_familyId_occurredAt_idx" ON "Transaction"("familyId", "occurredAt");
CREATE INDEX "Transaction_familyId_assetId_idx" ON "Transaction"("familyId", "assetId");
CREATE INDEX "Transaction_importBatchId_idx" ON "Transaction"("importBatchId");
CREATE INDEX "Transaction_corporateActionId_idx" ON "Transaction"("corporateActionId");
CREATE UNIQUE INDEX "Transaction_familyId_clientRequestId_key" ON "Transaction"("familyId", "clientRequestId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
