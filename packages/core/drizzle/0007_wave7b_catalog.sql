CREATE TABLE "metafield_definitions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"owner_type" text NOT NULL,
	"namespace" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"validations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"storefront_visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "unit_quantity_value" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "unit_quantity_unit" text;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "unit_reference_value" integer;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "unit_reference_unit" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "metafield_definitions" ADD CONSTRAINT "metafield_definitions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "metafield_definitions_uq" ON "metafield_definitions" USING btree ("shop_id","owner_type","namespace","key");--> statement-breakpoint
CREATE INDEX "metafield_definitions_owner_idx" ON "metafield_definitions" USING btree ("shop_id","owner_type");--> statement-breakpoint
CREATE INDEX "products_fts_idx" ON "products" USING gin (to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("vendor", '') || ' ' || coalesce("product_type", '') || ' ' || coalesce("description_html", '')));
