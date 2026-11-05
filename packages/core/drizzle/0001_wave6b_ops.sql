CREATE TABLE "draft_orders" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"name" text NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"customer_id" bigint,
	"email" text,
	"phone" text,
	"note" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"currency" text NOT NULL,
	"tax_exempt" boolean DEFAULT false NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"applied_discount" jsonb,
	"shipping_line" jsonb,
	"shipping_address" jsonb,
	"billing_address" jsonb,
	"subtotal" bigint DEFAULT 0 NOT NULL,
	"total_discounts" bigint DEFAULT 0 NOT NULL,
	"total_shipping" bigint DEFAULT 0 NOT NULL,
	"total_tax" bigint DEFAULT 0 NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"calc" jsonb,
	"invoice_sent_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"order_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_orders_token_unique" UNIQUE("token"),
	CONSTRAINT "draft_orders_status_chk" CHECK ("draft_orders"."status" in ('OPEN', 'INVOICE_SENT', 'COMPLETED'))
);
--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"key" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_users" ADD COLUMN "permissions" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_users" ADD COLUMN "invite_token_hash" text;--> statement-breakpoint
ALTER TABLE "staff_users" ADD COLUMN "invite_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "draft_orders" ADD CONSTRAINT "draft_orders_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_orders" ADD CONSTRAINT "draft_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_orders" ADD CONSTRAINT "draft_orders_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "draft_orders_shop_idx" ON "draft_orders" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_templates_key_uq" ON "notification_templates" USING btree ("shop_id","key");