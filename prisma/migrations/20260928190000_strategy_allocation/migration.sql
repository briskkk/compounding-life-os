ALTER TABLE "Asset" ADD COLUMN "strategyGroup" TEXT NOT NULL DEFAULT '';

CREATE TABLE "StrategyTarget" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "familyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "targetWeight" REAL NOT NULL,
  "tolerance" REAL NOT NULL DEFAULT 0.03,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "StrategyTarget_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "StrategyTarget_familyId_name_key" ON "StrategyTarget"("familyId", "name");
CREATE INDEX "StrategyTarget_familyId_idx" ON "StrategyTarget"("familyId");
