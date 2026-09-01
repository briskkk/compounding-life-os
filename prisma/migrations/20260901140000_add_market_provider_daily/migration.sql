-- CreateTable
CREATE TABLE "MarketProviderDaily" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "ok" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "totalMs" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastErrorAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketProviderDaily_provider_scope_date_key" ON "MarketProviderDaily"("provider", "scope", "date");

-- CreateIndex
CREATE INDEX "MarketProviderDaily_date_idx" ON "MarketProviderDaily"("date");
