ALTER TYPE "public"."entry_flag" ADD VALUE 'rep_paused';--> statement-breakpoint
ALTER TABLE "representative" ADD COLUMN "limit_set_at" date;--> statement-breakpoint
ALTER TABLE "representative" ADD COLUMN "sms_receipt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "representative" ADD COLUMN "pin_failed_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "representative" ADD CONSTRAINT "representative_limit_anchor" CHECK (("representative"."limit_value" IS NULL) = ("representative"."limit_set_at" IS NULL));--> statement-breakpoint
ALTER TABLE "representative" ADD CONSTRAINT "representative_receipt_phone" CHECK (NOT "representative"."sms_receipt" OR "representative"."phone" IS NOT NULL);