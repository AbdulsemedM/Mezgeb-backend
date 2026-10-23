ALTER TABLE "device" ADD COLUMN "push_token" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "merchant_id" uuid;--> statement-breakpoint
CREATE INDEX "notification_merchant_idx" ON "notification" USING btree ("merchant_id","channel","created_at");