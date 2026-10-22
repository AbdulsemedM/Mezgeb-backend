CREATE TYPE "public"."correction_request_status" AS ENUM('open', 'corrected', 'declined');--> statement-breakpoint
CREATE TABLE "correction_request" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entry_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"reason" text NOT NULL,
	"status" "correction_request_status" DEFAULT 'open' NOT NULL,
	"resolution_entry_id" uuid,
	"resolution_note" text,
	"resolved_by" uuid,
	"resolved_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"device_id" uuid,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "correction_request_amount" CHECK ("correction_request"."amount" <> 0),
	CONSTRAINT "correction_request_resolution" CHECK (("correction_request"."status" = 'open') OR ("correction_request"."status" = 'corrected' AND "correction_request"."resolution_entry_id" IS NOT NULL) OR ("correction_request"."status" = 'declined' AND "correction_request"."resolution_note" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "correction_request" ADD CONSTRAINT "correction_request_entry_id_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_request" ADD CONSTRAINT "correction_request_requested_by_app_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_request" ADD CONSTRAINT "correction_request_resolution_entry_id_entry_id_fk" FOREIGN KEY ("resolution_entry_id") REFERENCES "public"."entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_request" ADD CONSTRAINT "correction_request_resolved_by_app_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_request" ADD CONSTRAINT "correction_request_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "correction_request_entry_idx" ON "correction_request" USING btree ("entry_id");