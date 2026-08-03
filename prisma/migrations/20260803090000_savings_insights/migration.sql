-- CreateTable
CREATE TABLE "SavingsEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "periodType" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "income" DECIMAL NOT NULL DEFAULT 0,
    "spending" DECIMAL NOT NULL DEFAULT 0,
    "savedAmount" DECIMAL NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SavingsEntry_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- AlterTable
ALTER TABLE "Insight" ADD COLUMN "acknowledgedAt" DATETIME;

-- CreateIndex
CREATE INDEX "SavingsEntry_familyId_periodStart_idx" ON "SavingsEntry"("familyId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "SavingsEntry_familyId_periodType_periodStart_key" ON "SavingsEntry"("familyId", "periodType", "periodStart");
