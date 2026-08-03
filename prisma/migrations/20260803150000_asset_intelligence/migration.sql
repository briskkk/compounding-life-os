-- CreateTable
CREATE TABLE "AssetAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "stance" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "observations" TEXT NOT NULL,
    "risks" TEXT NOT NULL,
    "watchItems" TEXT NOT NULL,
    "actions" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "context" TEXT NOT NULL,
    "sourceSnapshotAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssetAnalysis_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssetAnalysis_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssetChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssetChatMessage_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssetChatMessage_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssetChatMessage_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AssetAnalysis_familyId_assetId_createdAt_idx" ON "AssetAnalysis"("familyId", "assetId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssetAnalysis_familyId_assetId_periodKey_key" ON "AssetAnalysis"("familyId", "assetId", "periodKey");

-- CreateIndex
CREATE INDEX "AssetChatMessage_familyId_assetId_memberId_createdAt_idx" ON "AssetChatMessage"("familyId", "assetId", "memberId", "createdAt");
