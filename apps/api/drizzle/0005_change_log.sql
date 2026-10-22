CREATE TABLE "change_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "change_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"xid" bigint NOT NULL,
	"merchant_id" uuid NOT NULL,
	"account_id" uuid,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"op" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_log_op" CHECK ("change_log"."op" IN ('upsert', 'delete'))
);
--> statement-breakpoint
CREATE INDEX "change_log_xid_idx" ON "change_log" USING btree ("xid","id");--> statement-breakpoint
CREATE INDEX "change_log_merchant_idx" ON "change_log" USING btree ("merchant_id","xid");--> statement-breakpoint
CREATE INDEX "change_log_account_idx" ON "change_log" USING btree ("account_id","xid");