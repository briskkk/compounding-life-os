-- CreateTable
CREATE TABLE "FundEstimate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "estimateReturn" REAL NOT NULL,
    "estimatedNav" DECIMAL NOT NULL,
    "confidence" REAL NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "FundEstimate_symbol_createdAt_idx" ON "FundEstimate"("symbol", "createdAt");
