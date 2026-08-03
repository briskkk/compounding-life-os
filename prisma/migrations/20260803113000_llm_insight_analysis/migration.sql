-- Store auditable, provider-neutral LLM analysis separately from deterministic rule facts.
CREATE TABLE "InsightAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "risks" TEXT NOT NULL,
    "opportunities" TEXT NOT NULL,
    "sourceSnapshotAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InsightAnalysis_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "Insight" ADD COLUMN "analysisRunId" TEXT REFERENCES "InsightAnalysis"("id") ON DELETE SET NULL;
ALTER TABLE "Insight" ADD COLUMN "analysis" TEXT;
ALTER TABLE "Insight" ADD COLUMN "evidence" TEXT;
ALTER TABLE "Insight" ADD COLUMN "confidence" REAL;

CREATE INDEX "InsightAnalysis_familyId_createdAt_idx" ON "InsightAnalysis"("familyId", "createdAt");
CREATE INDEX "Insight_analysisRunId_idx" ON "Insight"("analysisRunId");
