CREATE TABLE "bulk_operations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'CREATED' NOT NULL,
	"query" text NOT NULL,
	"error_code" text,
	"object_count" bigint DEFAULT 0 NOT NULL,
	"root_object_count" bigint DEFAULT 0 NOT NULL,
	"result_key" text,
	"result_size" bigint,
	"partial_key" text,
	"input_key" text,
	"group_objects" boolean DEFAULT false NOT NULL,
	"client_identifier" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "bulk_operations_type_chk" CHECK ("bulk_operations"."type" in ('QUERY', 'MUTATION'))
);
--> statement-breakpoint
CREATE TABLE "discount_code_bulk_creations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"discount_id" bigint NOT NULL,
	"codes_count" integer DEFAULT 0 NOT NULL,
	"imported_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD COLUMN "include_fields" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD COLUMN "metafield_namespaces" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD COLUMN "filter" text;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "bulk_operations" ADD CONSTRAINT "bulk_operations_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_code_bulk_creations" ADD CONSTRAINT "discount_code_bulk_creations_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_code_bulk_creations" ADD CONSTRAINT "discount_code_bulk_creations_discount_id_discounts_id_fk" FOREIGN KEY ("discount_id") REFERENCES "public"."discounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bulk_operations_shop_idx" ON "bulk_operations" USING btree ("shop_id","type","created_at");--> statement-breakpoint
CREATE INDEX "discount_code_bulk_creations_idx" ON "discount_code_bulk_creations" USING btree ("shop_id","discount_id");