CREATE TABLE "import_mappings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"source" text NOT NULL,
	"resource_type" text NOT NULL,
	"source_id" text NOT NULL,
	"local_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_mappings" ADD CONSTRAINT "import_mappings_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_mappings_uq" ON "import_mappings" USING btree ("shop_id","source","resource_type","source_id");