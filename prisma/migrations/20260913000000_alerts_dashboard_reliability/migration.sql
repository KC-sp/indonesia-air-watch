ALTER TABLE "UserSettings"
ADD COLUMN "alertCooldownMinutes" INTEGER NOT NULL DEFAULT 180,
ADD COLUMN "alertHysteresis" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN "alertRapidRise" INTEGER NOT NULL DEFAULT 25;

ALTER TABLE "HourlyDispatch"
ADD COLUMN "correlationId" TEXT,
ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "DailyDispatch"
ADD COLUMN "correlationId" TEXT,
ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "AlertState" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT '',
    "threshold" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NORMAL',
    "lastValue" INTEGER,
    "lastCategory" TEXT,
    "lastObservedAt" TIMESTAMP(3),
    "consecutiveBelow" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AlertState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AlertState_provider_city_region_key" ON "AlertState"("provider", "city", "region");

CREATE TABLE "AlertEvent" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT '',
    "eventType" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "previousValue" INTEGER,
    "threshold" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "deliveryError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AlertEvent_dedupeKey_key" ON "AlertEvent"("dedupeKey");
CREATE INDEX "AlertEvent_sentAt_createdAt_idx" ON "AlertEvent"("sentAt", "createdAt");
CREATE INDEX "AlertEvent_provider_city_region_eventType_createdAt_idx" ON "AlertEvent"("provider", "city", "region", "eventType", "createdAt");

CREATE TABLE "DashboardMessage" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "chatId" TEXT NOT NULL,
    "messageId" INTEGER NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'HOURLY',
    "lastRenderedHash" TEXT,
    "lastUpdatedAt" TIMESTAMP(3),
    "pinnedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DashboardMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryAttempt" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "messageId" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeliveryAttempt_correlationId_idx" ON "DeliveryAttempt"("correlationId");
CREATE INDEX "DeliveryAttempt_kind_createdAt_idx" ON "DeliveryAttempt"("kind", "createdAt");

CREATE TABLE "ServiceIncident" (
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "summary" TEXT NOT NULL,
    "correlationId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "recoveredAt" TIMESTAMP(3),
    "recoveryNotifiedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ServiceIncident_pkey" PRIMARY KEY ("key")
);
