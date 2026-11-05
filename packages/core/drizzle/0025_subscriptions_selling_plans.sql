CREATE TABLE "selling_plan_group_products" (
	"shop_id" bigint NOT NULL,
	"group_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	CONSTRAINT "selling_plan_group_products_group_id_product_id_pk" PRIMARY KEY("group_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "selling_plan_group_variants" (
	"shop_id" bigint NOT NULL,
	"group_id" bigint NOT NULL,
	"variant_id" bigint NOT NULL,
	CONSTRAINT "selling_plan_group_variants_group_id_variant_id_pk" PRIMARY KEY("group_id","variant_id")
);
--> statement-breakpoint
CREATE TABLE "selling_plan_groups" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"name" text NOT NULL,
	"merchant_code" text NOT NULL,
	"description" text,
	"options" text[] DEFAULT '{}'::text[] NOT NULL,
	"position" integer,
	"app_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "selling_plans" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"group_id" bigint NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"options" text[] DEFAULT '{}'::text[] NOT NULL,
	"position" integer,
	"category" text DEFAULT 'SUBSCRIPTION' NOT NULL,
	"billing_policy" jsonb NOT NULL,
	"delivery_policy" jsonb NOT NULL,
	"pricing_policies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "selling_plans_category_chk" CHECK ("selling_plans"."category" in ('SUBSCRIPTION', 'PRE_ORDER', 'TRY_BEFORE_YOU_BUY', 'OTHER'))
);
--> statement-breakpoint
CREATE TABLE "subscription_billing_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"contract_id" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"cycle_index" integer NOT NULL,
	"billing_date" timestamp with time zone NOT NULL,
	"order_id" bigint,
	"payment_id" text,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "subscription_billing_attempts_status_chk" CHECK ("subscription_billing_attempts"."status" in ('PENDING', 'SUCCEEDED', 'FAILED'))
);
--> statement-breakpoint
CREATE TABLE "subscription_contract_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"contract_id" bigint NOT NULL,
	"product_id" bigint,
	"variant_id" bigint,
	"title" text NOT NULL,
	"variant_title" text,
	"sku" text,
	"image_url" text,
	"quantity" integer NOT NULL,
	"selling_plan_id" bigint,
	"selling_plan_name" text,
	"base_price" bigint NOT NULL,
	"pricing_policies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deliveries_per_billing" integer DEFAULT 1 NOT NULL,
	"current_price" bigint NOT NULL,
	"requires_shipping" boolean DEFAULT true NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"grams" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_contracts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"customer_id" bigint,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"currency" text NOT NULL,
	"billing_policy" jsonb NOT NULL,
	"delivery_policy" jsonb NOT NULL,
	"next_billing_date" timestamp with time zone NOT NULL,
	"origin_order_id" bigint,
	"payment_gateway" text NOT NULL,
	"stripe_customer_id" text,
	"stripe_payment_method_id" text,
	"delivery_address" jsonb,
	"delivery_method" jsonb,
	"delivery_price" bigint DEFAULT 0 NOT NULL,
	"discounts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cycles_completed" integer DEFAULT 1 NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone,
	"last_payment_status" text,
	"last_billing_error_type" text,
	"upcoming_notified_for" timestamp with time zone,
	"note" text,
	"paused_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_contracts_status_chk" CHECK ("subscription_contracts"."status" in ('ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED', 'FAILED'))
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "requires_selling_plan" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cart_lines" ADD COLUMN "selling_plan_id" bigint;--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN "selling_plan_id" bigint;--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN "selling_plan_name" text;--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN "subscription_contract_id" bigint;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "subscription_contract_id" bigint;--> statement-breakpoint
ALTER TABLE "discount_extensions" ADD COLUMN "applies_on_one_time_purchase" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "discount_extensions" ADD COLUMN "applies_on_subscription" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "discount_extensions" ADD COLUMN "recurring_cycle_limit" integer;--> statement-breakpoint
ALTER TABLE "selling_plan_group_products" ADD CONSTRAINT "selling_plan_group_products_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selling_plan_group_products" ADD CONSTRAINT "selling_plan_group_products_group_id_selling_plan_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."selling_plan_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selling_plan_group_products" ADD CONSTRAINT "selling_plan_group_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selling_plan_group_variants" ADD CONSTRAINT "selling_plan_group_variants_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selling_plan_group_variants" ADD CONSTRAINT "selling_plan_group_variants_group_id_selling_plan_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."selling_plan_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selling_plan_group_variants" ADD CONSTRAINT "selling_plan_group_variants_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selling_plan_groups" ADD CONSTRAINT "selling_plan_groups_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selling_plans" ADD CONSTRAINT "selling_plans_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selling_plans" ADD CONSTRAINT "selling_plans_group_id_selling_plan_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."selling_plan_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_billing_attempts" ADD CONSTRAINT "subscription_billing_attempts_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_billing_attempts" ADD CONSTRAINT "subscription_billing_attempts_contract_id_subscription_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."subscription_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_contract_lines" ADD CONSTRAINT "subscription_contract_lines_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_contract_lines" ADD CONSTRAINT "subscription_contract_lines_contract_id_subscription_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."subscription_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_contracts" ADD CONSTRAINT "subscription_contracts_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_contracts" ADD CONSTRAINT "subscription_contracts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_contracts" ADD CONSTRAINT "subscription_contracts_origin_order_id_orders_id_fk" FOREIGN KEY ("origin_order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "spg_products_product_idx" ON "selling_plan_group_products" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "spg_variants_variant_idx" ON "selling_plan_group_variants" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "selling_plan_groups_shop_idx" ON "selling_plan_groups" USING btree ("shop_id","id");--> statement-breakpoint
CREATE INDEX "selling_plans_group_idx" ON "selling_plans" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_billing_attempts_key_uq" ON "subscription_billing_attempts" USING btree ("contract_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "subscription_billing_attempts_contract_idx" ON "subscription_billing_attempts" USING btree ("contract_id","created_at");--> statement-breakpoint
CREATE INDEX "subscription_contract_lines_contract_idx" ON "subscription_contract_lines" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "subscription_contracts_shop_idx" ON "subscription_contracts" USING btree ("shop_id","status","next_billing_date");--> statement-breakpoint
CREATE INDEX "subscription_contracts_customer_idx" ON "subscription_contracts" USING btree ("shop_id","customer_id");--> statement-breakpoint
CREATE INDEX "subscription_contracts_origin_idx" ON "subscription_contracts" USING btree ("origin_order_id");