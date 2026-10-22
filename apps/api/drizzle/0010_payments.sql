ALTER TABLE "entry" ADD COLUMN "payment_method" "payment_method";--> statement-breakpoint
ALTER TABLE "merchant" ADD COLUMN "payment_details" text;--> statement-breakpoint
ALTER TABLE "entry" ADD CONSTRAINT "entry_payment_method" CHECK (("entry"."type" = 'payment') = ("entry"."payment_method" IS NOT NULL));