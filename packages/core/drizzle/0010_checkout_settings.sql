ALTER TABLE "staff_users" ADD COLUMN "activity_read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "total_tip" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "checkout_meta" ADD COLUMN "tip_percent" integer;--> statement-breakpoint
ALTER TABLE "checkout_meta" ADD COLUMN "tip_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "discount_extensions" ADD COLUMN "eligibility" text DEFAULT 'ALL' NOT NULL;--> statement-breakpoint
ALTER TABLE "discount_extensions" ADD COLUMN "segment_ids" integer[] DEFAULT '{}'::integer[] NOT NULL;--> statement-breakpoint
ALTER TABLE "discount_extensions" ADD COLUMN "customer_ids" integer[] DEFAULT '{}'::integer[] NOT NULL;--> statement-breakpoint
ALTER TABLE "discount_extensions" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "returns" ADD COLUMN "return_shipping_fee" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "returns" ADD COLUMN "restocking_fee_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "discount_extensions" ADD CONSTRAINT "discount_ext_eligibility_chk" CHECK ("discount_extensions"."eligibility" in ('ALL', 'SEGMENTS', 'CUSTOMERS'));