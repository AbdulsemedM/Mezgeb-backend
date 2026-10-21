CREATE TYPE "public"."account_status" AS ENUM('pending', 'active', 'paused', 'closed');--> statement-breakpoint
CREATE TYPE "public"."calendar" AS ENUM('ethiopian', 'gregorian');--> statement-breakpoint
CREATE TYPE "public"."detail_mode" AS ENUM('simple', 'detailed');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."entry_flag" AS ENUM('clock_skew', 'over_limit_override', 'over_hard_stop', 'rep_revoked', 'pending_acceptance');--> statement-breakpoint
CREATE TYPE "public"."entry_origin" AS ENUM('device', 'server');--> statement-breakpoint
CREATE TYPE "public"."entry_type" AS ENUM('purchase', 'payment', 'correction');--> statement-breakpoint
CREATE TYPE "public"."language" AS ENUM('am', 'om', 'en');--> statement-breakpoint
CREATE TYPE "public"."limit_mode" AS ENUM('alert', 'hard_stop');--> statement-breakpoint
CREATE TYPE "public"."limit_side" AS ENUM('merchant', 'customer');--> statement-breakpoint
CREATE TYPE "public"."line_source" AS ENUM('manual', 'photo', 'order');--> statement-breakpoint
CREATE TYPE "public"."merchant_plan" AS ENUM('free', 'shop', 'shop_plus');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('push', 'sms');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('pending', 'sent', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('sent', 'accepted', 'priced', 'out_for_delivery', 'delivered', 'declined');--> statement-breakpoint
CREATE TYPE "public"."payme_status" AS ENUM('sent', 'seen', 'partially_paid', 'paid', 'expired');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'telebirr', 'cbe_birr', 'mpesa', 'bank_transfer', 'other');--> statement-breakpoint
CREATE TYPE "public"."payment_report_status" AS ENUM('reported', 'confirmed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."period_type" AS ENUM('weekly', 'biweekly', 'monthly', 'custom_days');--> statement-breakpoint
CREATE TYPE "public"."rep_relationship" AS ENUM('household', 'maid', 'guard', 'driver', 'other');--> statement-breakpoint
CREATE TYPE "public"."rep_status" AS ENUM('active', 'paused', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('owner', 'staff');--> statement-breakpoint
CREATE TYPE "public"."taken_by_type" AS ENUM('customer', 'representative', 'delivery');--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"customer_user_id" uuid NOT NULL,
	"nickname" text,
	"location_note" text,
	"status" "account_status" DEFAULT 'pending' NOT NULL,
	"terms_accepted_at" timestamp (3) with time zone,
	"detail_mode" "detail_mode",
	"customer_detail_view" "detail_mode",
	"last_seq" integer DEFAULT 0 NOT NULL,
	"last_hash" char(64) DEFAULT '0000000000000000000000000000000000000000000000000000000000000000' NOT NULL,
	"balance_santim" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"device_id" uuid,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_merchant_customer_uq" UNIQUE("merchant_id","customer_user_id"),
	CONSTRAINT "account_last_seq_nonneg" CHECK ("account"."last_seq" >= 0),
	CONSTRAINT "account_last_hash_hex" CHECK ("account"."last_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "account_accepted_before_active" CHECK ("account"."status" NOT IN ('active', 'paused') OR "account"."terms_accepted_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "account_limit" (
	"account_id" uuid NOT NULL,
	"set_by" "limit_side" NOT NULL,
	"value" bigint,
	"period_type" "period_type",
	"period_days" integer,
	"calendar" "calendar",
	"mode" "limit_mode" DEFAULT 'alert' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"device_id" uuid,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_limit_account_id_set_by_pk" PRIMARY KEY("account_id","set_by"),
	CONSTRAINT "account_limit_value_pos" CHECK ("account_limit"."value" > 0),
	CONSTRAINT "account_limit_something_set" CHECK ("account_limit"."value" IS NOT NULL OR "account_limit"."period_type" IS NOT NULL),
	CONSTRAINT "account_limit_custom_days" CHECK (("account_limit"."period_type" IS NOT DISTINCT FROM 'custom_days') = ("account_limit"."period_days" IS NOT NULL) AND ("account_limit"."period_days" IS NULL OR "account_limit"."period_days" > 0)),
	CONSTRAINT "account_limit_monthly_calendar" CHECK (("account_limit"."period_type" IS NOT DISTINCT FROM 'monthly') = ("account_limit"."calendar" IS NOT NULL)),
	CONSTRAINT "account_limit_hard_stop_customer_only" CHECK ("account_limit"."mode" = 'alert' OR "account_limit"."set_by" = 'customer')
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"name" text,
	"language" "language" DEFAULT 'am' NOT NULL,
	"calendar_pref" "calendar",
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_phone_unique" UNIQUE("phone"),
	CONSTRAINT "app_user_phone_e164" CHECK ("app_user"."phone" ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text,
	"before" jsonb,
	"after" jsonb,
	"request_id" uuid,
	"at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalogue_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"unit" text,
	"last_price" bigint,
	"photo_label" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"device_id" uuid,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_item_last_price_nonneg" CHECK ("catalogue_item"."last_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "delivery_order" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"lines" jsonb NOT NULL,
	"address_note" text,
	"preferred_time" text,
	"status" "order_status" DEFAULT 'sent' NOT NULL,
	"decline_reason" text,
	"delivery_person" text,
	"delivered_entry_id" uuid,
	"receipt_confirmed_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"device_id" uuid,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_order_delivered_entry_id_unique" UNIQUE("delivered_entry_id")
);
--> statement-breakpoint
CREATE TABLE "device" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"public_key" text NOT NULL,
	"label" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "dispute" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entry_id" uuid NOT NULL,
	"raised_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" "dispute_status" DEFAULT 'open' NOT NULL,
	"resolution_entry_id" uuid,
	"resolution_note" text,
	"resolved_by" uuid,
	"resolved_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"device_id" uuid,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispute_resolution" CHECK ("dispute"."status" = 'open' OR "dispute"."resolution_entry_id" IS NOT NULL OR "dispute"."resolution_note" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"type" "entry_type" NOT NULL,
	"amount" bigint NOT NULL,
	"taken_by_type" "taken_by_type",
	"representative_id" uuid,
	"order_id" uuid,
	"ref_entry_id" uuid,
	"reason" text,
	"photo_url" text,
	"seq" integer NOT NULL,
	"prev_hash" char(64) NOT NULL,
	"hash" char(64) NOT NULL,
	"received_at" timestamp (3) with time zone NOT NULL,
	"origin" "entry_origin" NOT NULL,
	"device_id" uuid,
	"device_seq" integer,
	"device_sig" text,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	"request_id" uuid,
	"flags" "entry_flag"[] DEFAULT '{}'::entry_flag[] NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "entry_account_seq_uq" UNIQUE("account_id","seq"),
	CONSTRAINT "entry_device_seq_uq" UNIQUE("device_id","device_seq"),
	CONSTRAINT "entry_seq_pos" CHECK ("entry"."seq" >= 1),
	CONSTRAINT "entry_device_seq_pos" CHECK ("entry"."device_seq" >= 1),
	CONSTRAINT "entry_prev_hash_hex" CHECK ("entry"."prev_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "entry_hash_hex" CHECK ("entry"."hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "entry_origin_fields" CHECK (("entry"."origin" = 'device' AND "entry"."device_id" IS NOT NULL AND "entry"."device_seq" IS NOT NULL AND "entry"."device_sig" IS NOT NULL)
       OR ("entry"."origin" = 'server' AND "entry"."device_id" IS NULL AND "entry"."device_seq" IS NULL AND "entry"."device_sig" IS NULL AND "entry"."request_id" IS NOT NULL)),
	CONSTRAINT "entry_amount_by_type" CHECK (("entry"."type" IN ('purchase', 'payment') AND "entry"."amount" > 0)
       OR ("entry"."type" = 'correction' AND "entry"."amount" <> 0)),
	CONSTRAINT "entry_taken_by_purchase_only" CHECK (("entry"."type" = 'purchase') = ("entry"."taken_by_type" IS NOT NULL)),
	CONSTRAINT "entry_representative_iff" CHECK (("entry"."taken_by_type" IS NOT DISTINCT FROM 'representative') = ("entry"."representative_id" IS NOT NULL)),
	CONSTRAINT "entry_correction_fields" CHECK ("entry"."type" <> 'correction' OR ("entry"."ref_entry_id" IS NOT NULL AND "entry"."reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "entry_line" (
	"entry_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid,
	"name" text NOT NULL,
	"qty" text,
	"unit" text,
	"unit_price" bigint,
	"amount" bigint NOT NULL,
	"source" "line_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_line_entry_id_line_no_pk" PRIMARY KEY("entry_id","line_no"),
	CONSTRAINT "entry_line_no_pos" CHECK ("entry_line"."line_no" >= 1),
	CONSTRAINT "entry_line_qty_canonical" CHECK ("entry_line"."qty" ~ '^(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$'),
	CONSTRAINT "entry_line_unit_price_nonneg" CHECK ("entry_line"."unit_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "merchant" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"shop_name" text NOT NULL,
	"sub_city" text,
	"woreda" text,
	"landmark" text,
	"default_detail_mode" "detail_mode" DEFAULT 'simple' NOT NULL,
	"plan" "merchant_plan" DEFAULT 'free' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"device_id" uuid,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_staff" (
	"merchant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "staff_role" NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"device_id" uuid,
	CONSTRAINT "merchant_staff_merchant_id_user_id_pk" PRIMARY KEY("merchant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"phone" text,
	"event" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"scheduled_for" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp (3) with time zone,
	"read_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_recipient" CHECK ("notification"."user_id" IS NOT NULL OR "notification"."phone" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "payme_request" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"message" text,
	"due_date" date,
	"payment_details" jsonb,
	"status" "payme_status" DEFAULT 'sent' NOT NULL,
	"seen_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"device_id" uuid,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payme_request_amount_pos" CHECK ("payme_request"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_report" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text,
	"screenshot_url" text,
	"status" "payment_report_status" DEFAULT 'reported' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp (3) with time zone,
	"reject_reason" text,
	"entry_id" uuid,
	"resubmitted_from_id" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"device_id" uuid,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_report_entry_id_unique" UNIQUE("entry_id"),
	CONSTRAINT "payment_report_amount_pos" CHECK ("payment_report"."amount" > 0),
	CONSTRAINT "payment_report_confirmed_entry" CHECK (("payment_report"."status" = 'confirmed') = ("payment_report"."entry_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "representative" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"relationship" "rep_relationship" NOT NULL,
	"phone" text,
	"pin_hash" text,
	"status" "rep_status" DEFAULT 'active' NOT NULL,
	"may_order" boolean DEFAULT false NOT NULL,
	"limit_value" bigint,
	"limit_period_type" "period_type",
	"limit_period_days" integer,
	"limit_calendar" "calendar",
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"device_id" uuid,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "representative_limit_value_pos" CHECK ("representative"."limit_value" > 0),
	CONSTRAINT "representative_custom_days" CHECK (("representative"."limit_period_type" IS NOT DISTINCT FROM 'custom_days') = ("representative"."limit_period_days" IS NOT NULL) AND ("representative"."limit_period_days" IS NULL OR "representative"."limit_period_days" > 0)),
	CONSTRAINT "representative_monthly_calendar" CHECK (("representative"."limit_period_type" IS NOT DISTINCT FROM 'monthly') = ("representative"."limit_calendar" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_merchant_id_merchant_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_customer_user_id_app_user_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_limit" ADD CONSTRAINT "account_limit_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_limit" ADD CONSTRAINT "account_limit_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_limit" ADD CONSTRAINT "account_limit_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_app_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogue_item" ADD CONSTRAINT "catalogue_item_merchant_id_merchant_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogue_item" ADD CONSTRAINT "catalogue_item_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogue_item" ADD CONSTRAINT "catalogue_item_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_order" ADD CONSTRAINT "delivery_order_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_order" ADD CONSTRAINT "delivery_order_delivered_entry_id_entry_id_fk" FOREIGN KEY ("delivered_entry_id") REFERENCES "public"."entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_order" ADD CONSTRAINT "delivery_order_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_order" ADD CONSTRAINT "delivery_order_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_entry_id_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_raised_by_app_user_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_resolution_entry_id_entry_id_fk" FOREIGN KEY ("resolution_entry_id") REFERENCES "public"."entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_resolved_by_app_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry" ADD CONSTRAINT "entry_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry" ADD CONSTRAINT "entry_representative_id_representative_id_fk" FOREIGN KEY ("representative_id") REFERENCES "public"."representative"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry" ADD CONSTRAINT "entry_order_id_delivery_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."delivery_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry" ADD CONSTRAINT "entry_ref_entry_id_entry_id_fk" FOREIGN KEY ("ref_entry_id") REFERENCES "public"."entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry" ADD CONSTRAINT "entry_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry" ADD CONSTRAINT "entry_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_line" ADD CONSTRAINT "entry_line_entry_id_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_line" ADD CONSTRAINT "entry_line_item_id_catalogue_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."catalogue_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant" ADD CONSTRAINT "merchant_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant" ADD CONSTRAINT "merchant_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant" ADD CONSTRAINT "merchant_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_staff" ADD CONSTRAINT "merchant_staff_merchant_id_merchant_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_staff" ADD CONSTRAINT "merchant_staff_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_staff" ADD CONSTRAINT "merchant_staff_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_staff" ADD CONSTRAINT "merchant_staff_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payme_request" ADD CONSTRAINT "payme_request_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payme_request" ADD CONSTRAINT "payme_request_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payme_request" ADD CONSTRAINT "payme_request_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_report" ADD CONSTRAINT "payment_report_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_report" ADD CONSTRAINT "payment_report_reviewed_by_app_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_report" ADD CONSTRAINT "payment_report_entry_id_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_report" ADD CONSTRAINT "payment_report_resubmitted_from_id_payment_report_id_fk" FOREIGN KEY ("resubmitted_from_id") REFERENCES "public"."payment_report"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_report" ADD CONSTRAINT "payment_report_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_report" ADD CONSTRAINT "payment_report_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "representative" ADD CONSTRAINT "representative_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "representative" ADD CONSTRAINT "representative_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "representative" ADD CONSTRAINT "representative_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_customer_idx" ON "account" USING btree ("customer_user_id");--> statement-breakpoint
CREATE INDEX "audit_log_object_idx" ON "audit_log" USING btree ("object_type","object_id");--> statement-breakpoint
CREATE INDEX "audit_log_request_idx" ON "audit_log" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "catalogue_item_merchant_idx" ON "catalogue_item" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "delivery_order_account_idx" ON "delivery_order" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "device_user_idx" ON "device" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "dispute_entry_idx" ON "dispute" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "entry_account_recorded_idx" ON "entry" USING btree ("account_id","recorded_at","seq");--> statement-breakpoint
CREATE INDEX "entry_ref_idx" ON "entry" USING btree ("ref_entry_id");--> statement-breakpoint
CREATE INDEX "merchant_owner_idx" ON "merchant" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_staff_one_owner" ON "merchant_staff" USING btree ("merchant_id") WHERE "merchant_staff"."role" = 'owner';--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_staff_one_staff" ON "merchant_staff" USING btree ("merchant_id") WHERE "merchant_staff"."role" = 'staff';--> statement-breakpoint
CREATE INDEX "merchant_staff_user_idx" ON "merchant_staff" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notification_due_idx" ON "notification" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "notification" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payme_request_account_idx" ON "payme_request" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "payment_report_account_idx" ON "payment_report" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "representative_account_idx" ON "representative" USING btree ("account_id");