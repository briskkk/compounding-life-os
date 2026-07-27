-- CreateTable
CREATE TABLE "FamilySpace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'CNY',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Member_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'OTHER',
    "institution" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Account_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cls" TEXT NOT NULL,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Asset_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Transaction" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Transaction_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetAmount" DECIMAL NOT NULL,
    "targetDate" DATETIME NOT NULL,
    "metric" TEXT NOT NULL DEFAULT 'INVESTABLE',
    "monthlyContribution" DECIMAL NOT NULL DEFAULT 0,
    "expectedReturn" REAL NOT NULL DEFAULT 0.07,
    "volatility" REAL NOT NULL DEFAULT 0.15,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Goal_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Snapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "netWorth" DECIMAL NOT NULL,
    "investable" DECIMAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Snapshot_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Insight" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "action" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Insight_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "detail" TEXT,
    "hash" TEXT NOT NULL,
    "prevHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Member_familyId_idx" ON "Member"("familyId");

-- CreateIndex
CREATE INDEX "Account_familyId_idx" ON "Account"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_familyId_name_key" ON "Account"("familyId", "name");

-- CreateIndex
CREATE INDEX "Asset_familyId_idx" ON "Asset"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_familyId_symbol_key" ON "Asset"("familyId", "symbol");

-- CreateIndex
CREATE INDEX "Transaction_familyId_occurredAt_idx" ON "Transaction"("familyId", "occurredAt");

-- CreateIndex
CREATE INDEX "Transaction_familyId_assetId_idx" ON "Transaction"("familyId", "assetId");

-- CreateIndex
CREATE INDEX "Goal_familyId_idx" ON "Goal"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "Snapshot_familyId_date_key" ON "Snapshot"("familyId", "date");

-- CreateIndex
CREATE INDEX "Insight_familyId_idx" ON "Insight"("familyId");

-- CreateIndex
CREATE INDEX "AuditLog_familyId_createdAt_idx" ON "AuditLog"("familyId", "createdAt");
