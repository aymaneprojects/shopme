CREATE TABLE "metaobject_definitions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"field_definitions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"display_name_key" text,
	"access_admin" text DEFAULT 'PUBLIC_READ_WRITE' NOT NULL,
	"access_storefront" text DEFAULT 'PUBLIC_READ' NOT NULL,
	"access_customer_account" text DEFAULT 'NONE' NOT NULL,
	"cap_publishable" boolean DEFAULT true NOT NULL,
	"cap_translatable" boolean DEFAULT true NOT NULL,
	"cap_renderable" boolean DEFAULT false NOT NULL,
	"renderable_meta_title_key" text,
	"renderable_meta_desc_key" text,
	"cap_online_store" boolean DEFAULT false NOT NULL,
	"online_store_url_handle" text,
	"online_store_create_redirects" boolean DEFAULT false NOT NULL,
	"owner_app" text,
	"entry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metaobject_references" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"target_id" bigint NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" bigint NOT NULL,
	"field_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metaobjects" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"definition_id" bigint NOT NULL,
	"type" text NOT NULL,
	"handle" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"template_suffix" text,
	"created_by_staff_id" bigint,
	"created_by_app" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "metaobject_definitions" ADD CONSTRAINT "metaobject_definitions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metaobject_references" ADD CONSTRAINT "metaobject_references_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metaobject_references" ADD CONSTRAINT "metaobject_references_target_id_metaobjects_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."metaobjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metaobjects" ADD CONSTRAINT "metaobjects_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metaobjects" ADD CONSTRAINT "metaobjects_definition_id_metaobject_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."metaobject_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "metaobject_defs_type_uq" ON "metaobject_definitions" USING btree ("shop_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "metaobject_defs_urlhandle_uq" ON "metaobject_definitions" USING btree ("shop_id","online_store_url_handle");--> statement-breakpoint
CREATE INDEX "metaobject_refs_target_idx" ON "metaobject_references" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "metaobject_refs_source_idx" ON "metaobject_references" USING btree ("source_kind","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "metaobjects_handle_uq" ON "metaobjects" USING btree ("shop_id","type","handle");--> statement-breakpoint
CREATE INDEX "metaobjects_def_idx" ON "metaobjects" USING btree ("definition_id","updated_at");