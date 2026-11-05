CREATE TABLE "saved_searches" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"resource_type" text NOT NULL,
	"name" text NOT NULL,
	"query" text DEFAULT '' NOT NULL,
	"params" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_searches_type_chk" CHECK ("saved_searches"."resource_type" in ('PRODUCT', 'ORDER', 'CUSTOMER', 'INVENTORY'))
);
--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "length_value" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "width_value" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "height_value" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "dimension_unit" text DEFAULT 'CENTIMETERS';--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_searches_shop_type_idx" ON "saved_searches" USING btree ("shop_id","resource_type","position");--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_dimension_chk" CHECK ("inventory_items"."dimension_unit" in ('MILLIMETERS', 'CENTIMETERS', 'METERS', 'INCHES', 'FEET', 'YARDS'));