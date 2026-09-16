-- 用户核对计划日未买入的计划层证据；不创建交易流水。
CREATE TABLE "InvestmentPlanDayReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "scheduledDate" DATETIME NOT NULL,
    "reviewedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    CONSTRAINT "InvestmentPlanDayReview_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InvestmentPlanDayReview_planId_fkey" FOREIGN KEY ("planId") REFERENCES "InvestmentPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "InvestmentPlanDayReview_planId_scheduledDate_key" ON "InvestmentPlanDayReview"("planId", "scheduledDate");
CREATE INDEX "InvestmentPlanDayReview_familyId_scheduledDate_idx" ON "InvestmentPlanDayReview"("familyId", "scheduledDate");
