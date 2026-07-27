-- CreateTable
CREATE TABLE "FundCalibration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "estReturn" REAL NOT NULL,
    "officialReturn" REAL NOT NULL,
    "error" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "FundCalibration_symbol_date_key" ON "FundCalibration"("symbol", "date");
