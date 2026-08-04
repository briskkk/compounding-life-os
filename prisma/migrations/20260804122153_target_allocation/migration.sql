-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FamilyPrefs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "cashFloor" REAL NOT NULL DEFAULT 0.08,
    "concentrationCeiling" REAL NOT NULL DEFAULT 0.25,
    "cashDragCeiling" REAL NOT NULL DEFAULT 0.35,
    "drawdownThreshold" REAL NOT NULL DEFAULT 0.05,
    "goalProbThreshold" REAL NOT NULL DEFAULT 0.9,
    "targetAllocation" TEXT,
    CONSTRAINT "FamilyPrefs_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_FamilyPrefs" ("cashDragCeiling", "cashFloor", "concentrationCeiling", "drawdownThreshold", "familyId", "goalProbThreshold", "id") SELECT "cashDragCeiling", "cashFloor", "concentrationCeiling", "drawdownThreshold", "familyId", "goalProbThreshold", "id" FROM "FamilyPrefs";
DROP TABLE "FamilyPrefs";
ALTER TABLE "new_FamilyPrefs" RENAME TO "FamilyPrefs";
CREATE UNIQUE INDEX "FamilyPrefs_familyId_key" ON "FamilyPrefs"("familyId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
