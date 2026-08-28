-- CreateTable
CREATE TABLE "AllocationTarget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "cls" TEXT NOT NULL,
    "targetWeight" REAL NOT NULL,
    "tolerance" REAL NOT NULL DEFAULT 0.03,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AllocationTarget_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CashPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "accountId" TEXT,
    "title" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amountCny" DECIMAL NOT NULL DEFAULT 0,
    "dueDate" DATETIME NOT NULL,
    "recurrence" TEXT NOT NULL DEFAULT 'NONE',
    "endDate" DATETIME,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CashPlan_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CashPlan_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AllocationTarget_familyId_cls_key" ON "AllocationTarget"("familyId", "cls");
CREATE INDEX "AllocationTarget_familyId_idx" ON "AllocationTarget"("familyId");
CREATE INDEX "CashPlan_familyId_dueDate_idx" ON "CashPlan"("familyId", "dueDate");
CREATE INDEX "CashPlan_accountId_idx" ON "CashPlan"("accountId");
