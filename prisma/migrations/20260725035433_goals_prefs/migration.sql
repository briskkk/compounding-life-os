-- CreateTable
CREATE TABLE "FamilyPrefs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "cashFloor" REAL NOT NULL DEFAULT 0.08,
    "concentrationCeiling" REAL NOT NULL DEFAULT 0.25,
    "cashDragCeiling" REAL NOT NULL DEFAULT 0.35,
    "drawdownThreshold" REAL NOT NULL DEFAULT 0.05,
    "goalProbThreshold" REAL NOT NULL DEFAULT 0.5,
    CONSTRAINT "FamilyPrefs_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Goal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'LUMP_SUM',
    "targetAmount" DECIMAL NOT NULL,
    "targetDate" DATETIME NOT NULL,
    "annualSpend" DECIMAL,
    "spendYears" INTEGER,
    "metric" TEXT NOT NULL DEFAULT 'INVESTABLE',
    "monthlyContribution" DECIMAL NOT NULL DEFAULT 0,
    "expectedReturn" REAL NOT NULL DEFAULT 0.07,
    "volatility" REAL NOT NULL DEFAULT 0.15,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Goal_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Goal" ("createdAt", "expectedReturn", "familyId", "id", "metric", "monthlyContribution", "name", "note", "targetAmount", "targetDate", "volatility") SELECT "createdAt", "expectedReturn", "familyId", "id", "metric", "monthlyContribution", "name", "note", "targetAmount", "targetDate", "volatility" FROM "Goal";
DROP TABLE "Goal";
ALTER TABLE "new_Goal" RENAME TO "Goal";
CREATE INDEX "Goal_familyId_idx" ON "Goal"("familyId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "FamilyPrefs_familyId_key" ON "FamilyPrefs"("familyId");
