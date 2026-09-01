ALTER TABLE "ImportBatch" ADD COLUMN "duplicateCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ImportBatch" ADD COLUMN "issuesJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "ImportBatch" ADD COLUMN "mappingJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "Transaction" ADD COLUMN "importRowHash" TEXT;

CREATE UNIQUE INDEX "Transaction_familyId_importRowHash_key" ON "Transaction"("familyId", "importRowHash");
