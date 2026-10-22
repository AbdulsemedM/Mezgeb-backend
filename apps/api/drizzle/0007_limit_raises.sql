CREATE TYPE "public"."raise_approval" AS ENUM('code', 'app');--> statement-breakpoint
CREATE TYPE "public"."raise_status" AS ENUM('pending', 'approved', 'used', 'expired');--> statement-breakpoint
CREATE TABLE "limit_raise" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"status" "raise_status" DEFAULT 'pending' NOT NULL,
	"code_hash" text NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"approved_at" timestamp (3) with time zone,
	"approved_via" "raise_approval",
	"valid_until" timestamp (3) with time zone,
	"used_by_entry_id" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "limit_raise_amount_pos" CHECK ("limit_raise"."amount" > 0),
	CONSTRAINT "limit_raise_approved" CHECK (("limit_raise"."status" IN ('approved', 'used')) = ("limit_raise"."approved_at" IS NOT NULL AND "limit_raise"."valid_until" IS NOT NULL)),
	CONSTRAINT "limit_raise_used" CHECK (("limit_raise"."status" = 'used') = ("limit_raise"."used_by_entry_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "limit_raise" ADD CONSTRAINT "limit_raise_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "limit_raise" ADD CONSTRAINT "limit_raise_used_by_entry_id_entry_id_fk" FOREIGN KEY ("used_by_entry_id") REFERENCES "public"."entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "limit_raise" ADD CONSTRAINT "limit_raise_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "limit_raise_account_idx" ON "limit_raise" USING btree ("account_id","status");