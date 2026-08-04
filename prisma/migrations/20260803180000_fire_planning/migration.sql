-- FIRE planning assumptions. Existing goals remain valid and receive conservative defaults.
ALTER TABLE "Goal" ADD COLUMN "retirementIncome" DECIMAL NOT NULL DEFAULT 0;
ALTER TABLE "Goal" ADD COLUMN "withdrawalRate" REAL NOT NULL DEFAULT 0.04;
ALTER TABLE "Goal" ADD COLUMN "inflationRate" REAL NOT NULL DEFAULT 0.025;

-- The old 50% goal threshold is not suitable for retirement-plan survival.
UPDATE "FamilyPrefs" SET "goalProbThreshold" = 0.9 WHERE "goalProbThreshold" = 0.5;
