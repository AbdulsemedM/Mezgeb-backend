DROP INDEX "merchant_owner_idx";--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "terms_version" text;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "phone_verified_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "merchant" ADD COLUMN "terms_accepted_at" timestamp (3) with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "merchant" ADD COLUMN "terms_version" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_owner_uq" ON "merchant" USING btree ("owner_user_id");