CREATE TABLE "inventory_shipment_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"shipment_id" bigint NOT NULL,
	"transfer_line_id" bigint NOT NULL,
	"inventory_item_id" bigint NOT NULL,
	"quantity" integer NOT NULL,
	"accepted_quantity" integer DEFAULT 0 NOT NULL,
	"rejected_quantity" integer DEFAULT 0 NOT NULL,
	"canceled_quantity" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_shipments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"transfer_id" bigint NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"barcode" text,
	"tracking_company" text,
	"tracking_number" text,
	"tracking_url" text,
	"arrives_at" timestamp with time zone,
	"date_created" timestamp with time zone DEFAULT now() NOT NULL,
	"date_shipped" timestamp with time zone,
	"date_received" timestamp with time zone,
	CONSTRAINT "inventory_shipments_status_chk" CHECK ("inventory_shipments"."status" in ('DRAFT', 'IN_TRANSIT', 'PARTIALLY_RECEIVED', 'RECEIVED'))
);
--> statement-breakpoint
CREATE TABLE "inventory_transfer_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"transfer_id" bigint NOT NULL,
	"inventory_item_id" bigint NOT NULL,
	"purchase_order_line_id" bigint,
	"title" text,
	"total_quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_transfers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"origin_location_id" bigint,
	"destination_location_id" bigint,
	"origin_snapshot" jsonb,
	"destination_snapshot" jsonb,
	"purchase_order_id" bigint,
	"reference_name" text,
	"note" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"date_created" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_transfers_status_chk" CHECK ("inventory_transfers"."status" in ('DRAFT', 'READY_TO_SHIP', 'IN_PROGRESS', 'TRANSFERRED', 'CANCELED'))
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"purchase_order_id" bigint NOT NULL,
	"inventory_item_id" bigint NOT NULL,
	"title" text,
	"variant_title" text,
	"sku" text,
	"supplier_sku" text,
	"quantity" integer NOT NULL,
	"received_quantity" integer DEFAULT 0 NOT NULL,
	"rejected_quantity" integer DEFAULT 0 NOT NULL,
	"unit_cost" bigint DEFAULT 0 NOT NULL,
	"tax_percent" numeric(6, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"closed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"supplier_id" bigint,
	"supplier_name" text,
	"destination_location_id" bigint,
	"destination_snapshot" jsonb,
	"currency" text NOT NULL,
	"exchange_rate" numeric(18, 8),
	"taxes_included" boolean DEFAULT true NOT NULL,
	"reference_number" text,
	"supplier_note" text,
	"payment_terms" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"shipping_cost" bigint DEFAULT 0 NOT NULL,
	"other_cost" bigint DEFAULT 0 NOT NULL,
	"expected_arrival" timestamp with time zone,
	"carrier" text,
	"ordered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_status_chk" CHECK ("purchase_orders"."status" in ('DRAFT', 'ORDERED'))
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone" text,
	"address" jsonb,
	"currency" text,
	"payment_terms" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_shipment_lines" ADD CONSTRAINT "inventory_shipment_lines_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_shipment_lines" ADD CONSTRAINT "inventory_shipment_lines_shipment_id_inventory_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."inventory_shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_shipment_lines" ADD CONSTRAINT "inventory_shipment_lines_transfer_line_id_inventory_transfer_lines_id_fk" FOREIGN KEY ("transfer_line_id") REFERENCES "public"."inventory_transfer_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_shipments" ADD CONSTRAINT "inventory_shipments_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_shipments" ADD CONSTRAINT "inventory_shipments_transfer_id_inventory_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."inventory_transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfer_lines" ADD CONSTRAINT "inventory_transfer_lines_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfer_lines" ADD CONSTRAINT "inventory_transfer_lines_transfer_id_inventory_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."inventory_transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfer_lines" ADD CONSTRAINT "inventory_transfer_lines_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_origin_location_id_locations_id_fk" FOREIGN KEY ("origin_location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_destination_location_id_locations_id_fk" FOREIGN KEY ("destination_location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_destination_location_id_locations_id_fk" FOREIGN KEY ("destination_location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_shipment_lines_shipment_idx" ON "inventory_shipment_lines" USING btree ("shipment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_shipments_barcode_uq" ON "inventory_shipments" USING btree ("shop_id","barcode");--> statement-breakpoint
CREATE INDEX "inventory_shipments_transfer_idx" ON "inventory_shipments" USING btree ("transfer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_transfer_lines_uq" ON "inventory_transfer_lines" USING btree ("transfer_id","inventory_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_transfers_name_uq" ON "inventory_transfers" USING btree ("shop_id","name");--> statement-breakpoint
CREATE INDEX "inventory_transfers_status_idx" ON "inventory_transfers" USING btree ("shop_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_lines_uq" ON "purchase_order_lines" USING btree ("purchase_order_id","inventory_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_name_uq" ON "purchase_orders" USING btree ("shop_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_name_uq" ON "suppliers" USING btree ("shop_id","name");