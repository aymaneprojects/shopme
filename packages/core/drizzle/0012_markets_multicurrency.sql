CREATE TABLE "catalog_markets" (
	"shop_id" bigint NOT NULL,
	"catalog_id" bigint NOT NULL,
	"market_id" bigint NOT NULL,
	CONSTRAINT "catalog_markets_catalog_id_market_id_pk" PRIMARY KEY("catalog_id","market_id")
);
--> statement-breakpoint
CREATE TABLE "catalogs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"price_list_id" bigint,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogs_status_chk" CHECK ("catalogs"."status" in ('ACTIVE', 'DRAFT', 'ARCHIVED'))
);
--> statement-breakpoint
CREATE TABLE "currency_settings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"currency_code" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"manual_rate" numeric(18, 8),
	"rate_updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "market_regions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"market_id" bigint NOT NULL,
	"country_code" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"name" text NOT NULL,
	"handle" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"condition_type" text DEFAULT 'REGION' NOT NULL,
	"currency_code" text,
	"local_currencies" boolean DEFAULT false NOT NULL,
	"rounding_enabled" boolean DEFAULT true NOT NULL,
	"tax_pricing_strategy" text,
	"duties_pricing_strategy" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "markets_status_chk" CHECK ("markets"."status" in ('ACTIVE', 'DRAFT'))
);
--> statement-breakpoint
CREATE TABLE "price_list_prices" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"price_list_id" bigint NOT NULL,
	"variant_id" bigint NOT NULL,
	"price" bigint NOT NULL,
	"compare_at_price" bigint
);
--> statement-breakpoint
CREATE TABLE "price_lists" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"adjustment_type" text DEFAULT 'PERCENTAGE_DECREASE' NOT NULL,
	"adjustment_value" numeric(9, 4) DEFAULT 0 NOT NULL,
	"compare_at_mode" text DEFAULT 'ADJUSTED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_lists_adjustment_chk" CHECK ("price_lists"."adjustment_type" in ('PERCENTAGE_DECREASE', 'PERCENTAGE_INCREASE')),
	CONSTRAINT "price_lists_compare_chk" CHECK ("price_lists"."compare_at_mode" in ('ADJUSTED', 'NULLIFY'))
);
--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "market_id" bigint;--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "country_code" text;--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN "presentment_unit_price" bigint;--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN "presentment_discounted_total" bigint;--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN "presentment_total_tax" bigint;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "presentment_money" jsonb;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "presentment_amount" bigint;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "presentment_currency" text;--> statement-breakpoint
ALTER TABLE "catalog_markets" ADD CONSTRAINT "catalog_markets_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_markets" ADD CONSTRAINT "catalog_markets_catalog_id_catalogs_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."catalogs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_markets" ADD CONSTRAINT "catalog_markets_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogs" ADD CONSTRAINT "catalogs_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogs" ADD CONSTRAINT "catalogs_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "currency_settings" ADD CONSTRAINT "currency_settings_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_regions" ADD CONSTRAINT "market_regions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_regions" ADD CONSTRAINT "market_regions_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_prices" ADD CONSTRAINT "price_list_prices_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_prices" ADD CONSTRAINT "price_list_prices_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_prices" ADD CONSTRAINT "price_list_prices_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_markets_market_uq" ON "catalog_markets" USING btree ("market_id");--> statement-breakpoint
CREATE UNIQUE INDEX "currency_settings_uq" ON "currency_settings" USING btree ("shop_id","currency_code");--> statement-breakpoint
CREATE UNIQUE INDEX "market_regions_country_uq" ON "market_regions" USING btree ("shop_id","country_code");--> statement-breakpoint
CREATE INDEX "market_regions_market_idx" ON "market_regions" USING btree ("market_id");--> statement-breakpoint
CREATE UNIQUE INDEX "markets_handle_uq" ON "markets" USING btree ("shop_id","handle");--> statement-breakpoint
CREATE UNIQUE INDEX "markets_primary_uq" ON "markets" USING btree ("shop_id") WHERE "markets"."is_primary";--> statement-breakpoint
CREATE UNIQUE INDEX "price_list_prices_uq" ON "price_list_prices" USING btree ("price_list_id","variant_id");
--> statement-breakpoint
INSERT INTO "markets" ("shop_id", "name", "handle", "status", "is_primary") SELECT "id", '', 'primary', 'ACTIVE', true FROM "shops" WHERE NOT EXISTS (SELECT 1 FROM "markets" m WHERE m."shop_id" = "shops"."id" AND m."is_primary");
--> statement-breakpoint
INSERT INTO "currency_settings" ("shop_id", "currency_code", "enabled", "manual_rate") SELECT "id", "currency", true, 1 FROM "shops" WHERE NOT EXISTS (SELECT 1 FROM "currency_settings" c WHERE c."shop_id" = "shops"."id" AND c."currency_code" = "shops"."currency");
