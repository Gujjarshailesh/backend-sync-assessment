-- CreateEnum
CREATE TYPE "TriggerType" AS ENUM ('manual', 'scheduled', 'webhook');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('running', 'success', 'partial_failure', 'failed');

-- CreateEnum
CREATE TYPE "SyncRunSourceStatus" AS ENUM ('success', 'failed');

-- CreateEnum
CREATE TYPE "SyncMode" AS ENUM ('incremental', 'full');

-- CreateEnum
CREATE TYPE "CursorType" AS ENUM ('timestamp', 'token');

-- CreateEnum
CREATE TYPE "CanonicalStatus" AS ENUM ('collected', 'not_collected', 'unknown');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('created', 'updated', 'skipped_duplicate', 'soft_deleted');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('received', 'processed', 'ignored_duplicate', 'failed');

-- CreateTable
CREATE TABLE "sync_state" (
    "source" TEXT NOT NULL,
    "cursor" TEXT,
    "cursor_type" "CursorType",
    "last_full_sync_at" TIMESTAMP(3),
    "last_incremental_sync_at" TIMESTAMP(3),
    "last_status" "SyncRunSourceStatus",
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_state_pkey" PRIMARY KEY ("source")
);

-- CreateTable
CREATE TABLE "sync_run" (
    "id" TEXT NOT NULL,
    "trigger_type" "TriggerType" NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "status" "SyncRunStatus" NOT NULL DEFAULT 'running',

    CONSTRAINT "sync_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_run_source" (
    "id" TEXT NOT NULL,
    "sync_run_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "mode" "SyncMode" NOT NULL,
    "status" "SyncRunSourceStatus" NOT NULL,
    "records_fetched" INTEGER NOT NULL DEFAULT 0,
    "records_upserted" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "sync_run_source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "email" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "phone" TEXT,
    "lifecycle_stage" TEXT,
    "source_created_at" TIMESTAMP(3),
    "source_updated_at" TIMESTAMP(3) NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "calendar_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "attendees" JSONB,
    "source_updated_at" TIMESTAMP(3) NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "customer_ref" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "raw_status" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "source_updated_at" TIMESTAMP(3) NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_mapping" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "raw_status" TEXT NOT NULL,
    "canonical_status" "CanonicalStatus" NOT NULL,

    CONSTRAINT "status_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "sync_run_id" TEXT,
    "diff" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_event" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'received',

    CONSTRAINT "webhook_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sync_run_source_sync_run_id_idx" ON "sync_run_source"("sync_run_id");

-- CreateIndex
CREATE INDEX "sync_run_source_source_started_at_idx" ON "sync_run_source"("source", "started_at" DESC);

-- CreateIndex
CREATE INDEX "contacts_source_updated_at_idx" ON "contacts"("source_updated_at");

-- CreateIndex
CREATE INDEX "contacts_email_idx" ON "contacts"("email");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_source_external_id_key" ON "contacts"("source", "external_id");

-- CreateIndex
CREATE INDEX "calendar_events_source_updated_at_idx" ON "calendar_events"("source_updated_at");

-- CreateIndex
CREATE INDEX "calendar_events_start_time_idx" ON "calendar_events"("start_time");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_events_source_external_id_key" ON "calendar_events"("source", "external_id");

-- CreateIndex
CREATE INDEX "transactions_occurred_at_idx" ON "transactions"("occurred_at");

-- CreateIndex
CREATE INDEX "transactions_source_raw_status_occurred_at_idx" ON "transactions"("source", "raw_status", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_source_external_id_key" ON "transactions"("source", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "status_mapping_source_raw_status_key" ON "status_mapping"("source", "raw_status");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_external_id_idx" ON "audit_log"("entity_type", "external_id");

-- CreateIndex
CREATE INDEX "audit_log_sync_run_id_idx" ON "audit_log"("sync_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_event_source_event_id_key" ON "webhook_event"("source", "event_id");

-- AddForeignKey
ALTER TABLE "sync_run_source" ADD CONSTRAINT "sync_run_source_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "sync_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "sync_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;
