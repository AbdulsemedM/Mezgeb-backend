CREATE TABLE "otp_challenge" (
	"id" uuid PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"code_hash" char(64) NOT NULL,
	"ip" text NOT NULL,
	"language" "language",
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"consumed_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_token" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" char(64) NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"used_at" timestamp (3) with time zone,
	"revoked_at" timestamp (3) with time zone,
	"replaced_by_id" uuid,
	CONSTRAINT "refresh_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_replaced_by_id_refresh_token_id_fk" FOREIGN KEY ("replaced_by_id") REFERENCES "public"."refresh_token"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "otp_challenge_phone_idx" ON "otp_challenge" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "otp_challenge_ip_idx" ON "otp_challenge" USING btree ("ip","created_at");--> statement-breakpoint
CREATE INDEX "refresh_token_family_idx" ON "refresh_token" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "refresh_token_device_idx" ON "refresh_token" USING btree ("device_id");