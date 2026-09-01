-- CreateTable
CREATE TABLE "FundTradePolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "purchaseFeeRate" REAL NOT NULL DEFAULT 0,
    "redemptionFeeRules" TEXT NOT NULL DEFAULT '[]',
    "purchaseSuspendedFrom" DATETIME,
    "purchaseSuspendedUntil" DATETIME,
    "sourceName" TEXT NOT NULL,
    "sourceReference" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FundTradePolicy_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FundTradePolicy_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "FundTradePolicy_assetId_key" ON "FundTradePolicy"("assetId");

-- CreateIndex
CREATE INDEX "FundTradePolicy_familyId_idx" ON "FundTradePolicy"("familyId");
