-- Ongoing week/month/quarter reviews keep the same identity as their as-of end date advances.
DROP INDEX "PortfolioReview_familyId_startDate_endDate_key";

CREATE UNIQUE INDEX "PortfolioReview_familyId_period_startDate_key"
ON "PortfolioReview"("familyId", "period", "startDate");
