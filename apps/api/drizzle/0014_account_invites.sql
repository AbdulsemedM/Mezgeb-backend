CREATE TABLE "account_invite" (
	"code" text PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "account_invite_code_format" CHECK ("account_invite"."code" ~ '^[2-9A-HJKMNP-TV-Z]{8}$')
);
--> statement-breakpoint
ALTER TABLE "account_invite" ADD CONSTRAINT "account_invite_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_invite_account_idx" ON "account_invite" USING btree ("account_id");