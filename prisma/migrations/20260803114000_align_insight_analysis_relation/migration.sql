-- SQLite needs a table redefinition to preserve the named foreign key semantics Prisma expects.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Insight" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "analysisRunId" TEXT,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "action" TEXT,
    "analysis" TEXT,
    "evidence" TEXT,
    "confidence" REAL,
    "acknowledgedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Insight_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Insight_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "InsightAnalysis" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_Insight" ("acknowledgedAt", "action", "analysis", "analysisRunId", "body", "confidence", "createdAt", "evidence", "familyId", "id", "kind", "severity", "title")
SELECT "acknowledgedAt", "action", "analysis", "analysisRunId", "body", "confidence", "createdAt", "evidence", "familyId", "id", "kind", "severity", "title" FROM "Insight";

DROP TABLE "Insight";
ALTER TABLE "new_Insight" RENAME TO "Insight";
CREATE INDEX "Insight_familyId_idx" ON "Insight"("familyId");
CREATE INDEX "Insight_analysisRunId_idx" ON "Insight"("analysisRunId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
