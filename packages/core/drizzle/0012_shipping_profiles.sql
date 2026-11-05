CREATE TABLE "delivery_conditions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"method_id" bigint NOT NULL,
	"field" text NOT NULL,
	"operator" text NOT NULL,
	"value" bigint NOT NULL,
	CONSTRAINT "delivery_conditions_field_chk" CHECK ("delivery_conditions"."field" in ('TOTAL_WEIGHT', 'TOTAL_PRICE')),
	CONSTRAINT "delivery_conditions_operator_chk" CHECK ("delivery_conditions"."operator" in ('GREATER_THAN_OR_EQUAL_TO', 'LESS_THAN_OR_EQUAL_TO'))
);
--> statement-breakpoint
CREATE TABLE "delivery_location_group_locations" (
	"group_id" bigint NOT NULL,
	"location_id" bigint NOT NULL,
	"shop_id" bigint NOT NULL,
	CONSTRAINT "delivery_location_group_locations_group_id_location_id_pk" PRIMARY KEY("group_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "delivery_location_groups" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"profile_id" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_method_definitions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"zone_id" bigint NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"price" bigint DEFAULT 0 NOT NULL,
	"free_over_amount" bigint
);
--> statement-breakpoint
CREATE TABLE "delivery_profile_variants" (
	"profile_id" bigint NOT NULL,
	"variant_id" bigint NOT NULL,
	"shop_id" bigint NOT NULL,
	CONSTRAINT "delivery_profile_variants_variant_id_pk" PRIMARY KEY("variant_id")
);
--> statement-breakpoint
CREATE TABLE "delivery_profiles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_zone_countries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"zone_id" bigint NOT NULL,
	"country_code" text,
	"rest_of_world" boolean DEFAULT false NOT NULL,
	"province_codes" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_zones" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"group_id" bigint NOT NULL,
	"name" text NOT NULL,
	"market_id" bigint
);
--> statement-breakpoint
CREATE TABLE "location_local_delivery" (
	"location_id" bigint PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"area_type" text DEFAULT 'POSTAL_CODES' NOT NULL,
	"radius_km" numeric(8, 2),
	"postal_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"price" bigint DEFAULT 0 NOT NULL,
	"minimum_order" bigint,
	"free_over_amount" bigint,
	"info" text,
	"phone" text,
	CONSTRAINT "location_local_delivery_area_chk" CHECK ("location_local_delivery"."area_type" in ('RADIUS', 'POSTAL_CODES'))
);
--> statement-breakpoint
CREATE TABLE "location_pickup_settings" (
	"location_id" bigint PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"pickup_time" text DEFAULT 'TWO_TO_FOUR_DAYS' NOT NULL,
	"custom_pickup_time" text,
	"instructions" text DEFAULT '' NOT NULL,
	CONSTRAINT "location_pickup_time_chk" CHECK ("location_pickup_settings"."pickup_time" in ('ONE_HOUR', 'TWO_HOURS', 'FOUR_HOURS', 'TWENTY_FOUR_HOURS', 'TWO_TO_FOUR_DAYS', 'FIVE_OR_MORE_DAYS', 'CUSTOM'))
);
--> statement-breakpoint
CREATE TABLE "order_deliveries" (
	"order_id" bigint PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"method_type" text DEFAULT 'SHIPPING' NOT NULL,
	"location_id" bigint,
	"pickup_ready_at" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	CONSTRAINT "order_deliveries_type_chk" CHECK ("order_deliveries"."method_type" in ('SHIPPING', 'PICK_UP', 'LOCAL', 'NONE'))
);
--> statement-breakpoint
CREATE TABLE "shipping_packages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'BOX' NOT NULL,
	"length" numeric(10, 3),
	"width" numeric(10, 3),
	"height" numeric(10, 3),
	"dimension_unit" text DEFAULT 'CENTIMETERS' NOT NULL,
	"weight" numeric(10, 3),
	"weight_unit" text DEFAULT 'KILOGRAMS' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_packages_type_chk" CHECK ("shipping_packages"."type" in ('BOX', 'ENVELOPE', 'SOFT_PACK', 'FLAT_RATE'))
);
--> statement-breakpoint
ALTER TABLE "delivery_conditions" ADD CONSTRAINT "delivery_conditions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_conditions" ADD CONSTRAINT "delivery_conditions_method_id_delivery_method_definitions_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."delivery_method_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_location_group_locations" ADD CONSTRAINT "delivery_location_group_locations_group_id_delivery_location_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."delivery_location_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_location_group_locations" ADD CONSTRAINT "delivery_location_group_locations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_location_group_locations" ADD CONSTRAINT "delivery_location_group_locations_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_location_groups" ADD CONSTRAINT "delivery_location_groups_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_location_groups" ADD CONSTRAINT "delivery_location_groups_profile_id_delivery_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."delivery_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_method_definitions" ADD CONSTRAINT "delivery_method_definitions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_method_definitions" ADD CONSTRAINT "delivery_method_definitions_zone_id_delivery_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."delivery_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_profile_variants" ADD CONSTRAINT "delivery_profile_variants_profile_id_delivery_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."delivery_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_profile_variants" ADD CONSTRAINT "delivery_profile_variants_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_profile_variants" ADD CONSTRAINT "delivery_profile_variants_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_profiles" ADD CONSTRAINT "delivery_profiles_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_zone_countries" ADD CONSTRAINT "delivery_zone_countries_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_zone_countries" ADD CONSTRAINT "delivery_zone_countries_zone_id_delivery_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."delivery_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_group_id_delivery_location_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."delivery_location_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_local_delivery" ADD CONSTRAINT "location_local_delivery_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_local_delivery" ADD CONSTRAINT "location_local_delivery_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_pickup_settings" ADD CONSTRAINT "location_pickup_settings_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_pickup_settings" ADD CONSTRAINT "location_pickup_settings_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_deliveries" ADD CONSTRAINT "order_deliveries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_deliveries" ADD CONSTRAINT "order_deliveries_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_deliveries" ADD CONSTRAINT "order_deliveries_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_packages" ADD CONSTRAINT "shipping_packages_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delivery_conditions_method_idx" ON "delivery_conditions" USING btree ("method_id");--> statement-breakpoint
CREATE INDEX "delivery_method_definitions_zone_idx" ON "delivery_method_definitions" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX "delivery_profile_variants_profile_idx" ON "delivery_profile_variants" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_profiles_default_uq" ON "delivery_profiles" USING btree ("shop_id") WHERE "delivery_profiles"."is_default";--> statement-breakpoint
CREATE INDEX "delivery_zone_countries_zone_idx" ON "delivery_zone_countries" USING btree ("zone_id");
--> statement-breakpoint
-- Data migration: every shop gets a general profile; existing zones and rates move into it with the same ids, so carts and orders that point at a rate keep working.
INSERT INTO "delivery_profiles" ("shop_id", "name", "is_default") SELECT "id", 'General profile', true FROM "shops";
--> statement-breakpoint
INSERT INTO "delivery_location_groups" ("shop_id", "profile_id") SELECT "shop_id", "id" FROM "delivery_profiles" WHERE "is_default";
--> statement-breakpoint
INSERT INTO "delivery_location_group_locations" ("shop_id", "group_id", "location_id")
  SELECT g."shop_id", g."id", l."id" FROM "delivery_location_groups" g JOIN "locations" l ON l."shop_id" = g."shop_id" WHERE l."fulfills_online_orders" AND l."is_active";
--> statement-breakpoint
INSERT INTO "delivery_zones" ("id", "shop_id", "group_id", "name")
  SELECT z."id", z."shop_id", g."id", z."name" FROM "shipping_zones" z
  JOIN "delivery_profiles" p ON p."shop_id" = z."shop_id" AND p."is_default" JOIN "delivery_location_groups" g ON g."profile_id" = p."id";
--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('delivery_zones', 'id'), COALESCE(MAX("id"), 1), COUNT(*) > 0) FROM "delivery_zones";
--> statement-breakpoint
INSERT INTO "delivery_zone_countries" ("shop_id", "zone_id", "country_code", "rest_of_world", "province_codes")
  SELECT "shop_id", "zone_id", CASE WHEN "country_code" = '*' THEN NULL ELSE "country_code" END, "country_code" = '*', "province_codes" FROM "shipping_zone_countries" ORDER BY "id";
--> statement-breakpoint
INSERT INTO "delivery_method_definitions" ("id", "shop_id", "zone_id", "name", "active", "position", "price")
  SELECT "id", "shop_id", "zone_id", "name", "active", "position", CASE WHEN "type" = 'FREE' THEN 0 ELSE "price" END FROM "shipping_rates";
--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('delivery_method_definitions', 'id'), COALESCE(MAX("id"), 1), COUNT(*) > 0) FROM "delivery_method_definitions";
--> statement-breakpoint
INSERT INTO "delivery_conditions" ("shop_id", "method_id", "field", "operator", "value")
  SELECT "shop_id", "id", CASE WHEN "type" = 'WEIGHT_BASED' THEN 'TOTAL_WEIGHT' ELSE 'TOTAL_PRICE' END, 'GREATER_THAN_OR_EQUAL_TO', "min_value" FROM "shipping_rates" WHERE "type" IN ('WEIGHT_BASED', 'PRICE_BASED') AND "min_value" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "delivery_conditions" ("shop_id", "method_id", "field", "operator", "value")
  SELECT "shop_id", "id", CASE WHEN "type" = 'WEIGHT_BASED' THEN 'TOTAL_WEIGHT' ELSE 'TOTAL_PRICE' END, 'LESS_THAN_OR_EQUAL_TO', "max_value" FROM "shipping_rates" WHERE "type" IN ('WEIGHT_BASED', 'PRICE_BASED') AND "max_value" IS NOT NULL;
