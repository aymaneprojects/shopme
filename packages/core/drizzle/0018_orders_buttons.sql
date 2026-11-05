CREATE TABLE "marketing_campaigns" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"name" text NOT NULL,
	"channel" text DEFAULT 'other' NOT NULL,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"budget" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_campaigns_status_chk" CHECK ("marketing_campaigns"."status" in ('DRAFT', 'ACTIVE', 'ENDED'))
);
--> statement-breakpoint
CREATE TABLE "order_batches" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipping_labels" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"order_id" bigint NOT NULL,
	"fulfillment_id" bigint,
	"carrier" text NOT NULL,
	"service" text,
	"tracking_number" text,
	"tracking_url" text,
	"cost" bigint DEFAULT 0 NOT NULL,
	"weight_grams" integer,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_labels_status_chk" CHECK ("shipping_labels"."status" in ('ACTIVE', 'VOIDED'))
);
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_fulfillment_chk";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "visit_session_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fulfill_by" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "batch_id" bigint;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "po_number" text;--> statement-breakpoint
ALTER TABLE "draft_orders" ADD COLUMN "po_number" text;--> statement-breakpoint
ALTER TABLE "draft_orders" ADD COLUMN "market_id" bigint;--> statement-breakpoint
ALTER TABLE "draft_orders" ADD COLUMN "presentment_currency" text;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "utm_source" text;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "utm_medium" text;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "utm_campaign" text;--> statement-breakpoint
ALTER TABLE "order_edits" ADD COLUMN "custom_items" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "order_edits" ADD COLUMN "order_discount" jsonb;--> statement-breakpoint
ALTER TABLE "order_edits" ADD COLUMN "shipping_fee" jsonb;--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_batches" ADD CONSTRAINT "order_batches_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_labels" ADD CONSTRAINT "shipping_labels_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_labels" ADD CONSTRAINT "shipping_labels_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "marketing_campaigns_shop_idx" ON "marketing_campaigns" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "order_batches_shop_idx" ON "order_batches" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "shipping_labels_order_idx" ON "shipping_labels" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "shipping_labels_shop_idx" ON "shipping_labels" USING btree ("shop_id","created_at");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_fulfillment_chk" CHECK ("orders"."fulfillment_status" in ('UNFULFILLED', 'PARTIALLY_FULFILLED', 'FULFILLED', 'RESTOCKED', 'ON_HOLD', 'IN_PROGRESS'));