-- CreateTable
CREATE TABLE "RateBar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pair" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "rate" DECIMAL NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'SINA'
);

-- CreateIndex
CREATE UNIQUE INDEX "RateBar_pair_date_key" ON "RateBar"("pair", "date");

-- CreateIndex
CREATE INDEX "RateBar_pair_idx" ON "RateBar"("pair");
