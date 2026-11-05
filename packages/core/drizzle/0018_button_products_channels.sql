CREATE TABLE "catalog_products" (
	"shop_id" bigint NOT NULL,
	"catalog_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_products_catalog_id_product_id_pk" PRIMARY KEY("catalog_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_item_country_hs" (
	"shop_id" bigint NOT NULL,
	"inventory_item_id" bigint NOT NULL,
	"country_code" text NOT NULL,
	"harmonized_system_code" text NOT NULL,
	CONSTRAINT "inventory_item_country_hs_inventory_item_id_country_code_pk" PRIMARY KEY("inventory_item_id","country_code")
);
--> statement-breakpoint
CREATE TABLE "publications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"name" text NOT NULL,
	"handle" text NOT NULL,
	"kind" text DEFAULT 'CUSTOM' NOT NULL,
	"position" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publications_kind_chk" CHECK ("publications"."kind" in ('ONLINE_STORE', 'CUSTOM'))
);
--> statement-breakpoint
CREATE TABLE "resource_publications" (
	"shop_id" bigint NOT NULL,
	"publication_id" bigint NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" bigint NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_publications_publication_id_resource_type_resource_id_pk" PRIMARY KEY("publication_id","resource_type","resource_id"),
	CONSTRAINT "resource_publications_type_chk" CHECK ("resource_publications"."resource_type" in ('PRODUCT', 'COLLECTION'))
);
--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_status_chk";--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "shipping_package_id" bigint;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "online_store_published_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "publication_ids" bigint[] DEFAULT '{}'::bigint[] NOT NULL;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "launch_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_catalog_id_catalogs_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."catalogs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_item_country_hs" ADD CONSTRAINT "inventory_item_country_hs_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_item_country_hs" ADD CONSTRAINT "inventory_item_country_hs_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_publications" ADD CONSTRAINT "resource_publications_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_publications" ADD CONSTRAINT "resource_publications_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_products_product_idx" ON "catalog_products" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "publications_handle_uq" ON "publications" USING btree ("shop_id","handle");--> statement-breakpoint
CREATE INDEX "resource_publications_resource_idx" ON "resource_publications" USING btree ("resource_type","resource_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_status_chk" CHECK ("products"."status" in ('ACTIVE', 'ARCHIVED', 'DRAFT', 'UNLISTED'));--> statement-breakpoint
INSERT INTO "publications" ("shop_id", "name", "handle", "kind", "position") SELECT "id", 'Online Store', 'online-store', 'ONLINE_STORE', 0 FROM "shops" ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "products" SET "online_store_published_at" = COALESCE("published_at", "created_at");
