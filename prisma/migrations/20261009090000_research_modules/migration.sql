-- CreateTable
CREATE TABLE "ExposureDisclosure" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "reportDate" TEXT NOT NULL,
    "availableDate" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExposureDisclosure_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InvestmentExperiment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "methodVersion" TEXT NOT NULL,
    "watermark" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvestmentExperiment_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilySpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ExposureDisclosure_familyId_symbol_reportDate_idx" ON "ExposureDisclosure"("familyId", "symbol", "reportDate");

-- CreateIndex
CREATE INDEX "InvestmentExperiment_familyId_createdAt_idx" ON "InvestmentExperiment"("familyId", "createdAt");

