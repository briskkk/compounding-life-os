-- CreateTable
CREATE TABLE "InvestmentPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "accountId" TEXT,
    "name" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "currency" TEXT NOT NULL,
    "cadence" TEXT NOT NULL,
    "scheduleDay" INTEGER,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "endedAt" DATETIME,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InvestmentPlan_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InvestmentPlan_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InvestmentPlanAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvestmentPlanAsset_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InvestmentPlanAsset_planId_fkey" FOREIGN KEY ("planId") REFERENCES "InvestmentPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InvestmentPlanAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "InvestmentPlan_familyId_status_idx" ON "InvestmentPlan"("familyId", "status");
CREATE INDEX "InvestmentPlan_accountId_idx" ON "InvestmentPlan"("accountId");
CREATE UNIQUE INDEX "InvestmentPlanAsset_planId_assetId_key" ON "InvestmentPlanAsset"("planId", "assetId");
CREATE INDEX "InvestmentPlanAsset_familyId_idx" ON "InvestmentPlanAsset"("familyId");
CREATE INDEX "InvestmentPlanAsset_assetId_idx" ON "InvestmentPlanAsset"("assetId");
