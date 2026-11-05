CREATE TABLE "staff_roles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_users" ADD COLUMN "role_id" bigint;--> statement-breakpoint
ALTER TABLE "shop_locales" ADD COLUMN "domain" text;--> statement-breakpoint
ALTER TABLE "delivery_method_definitions" ADD COLUMN "transit_min_days" integer;--> statement-breakpoint
ALTER TABLE "delivery_method_definitions" ADD COLUMN "transit_max_days" integer;--> statement-breakpoint
ALTER TABLE "delivery_method_definitions" ADD COLUMN "collection_ids" bigint[] DEFAULT '{}'::bigint[] NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_method_definitions" ADD COLUMN "origin_location_ids" bigint[] DEFAULT '{}'::bigint[] NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_method_definitions" ADD COLUMN "rate_type" text DEFAULT 'FIXED' NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_method_definitions" ADD COLUMN "carrier_provider" text;--> statement-breakpoint
ALTER TABLE "delivery_method_definitions" ADD COLUMN "carrier_params" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_roles" ADD CONSTRAINT "staff_roles_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_roles_shop_name_uq" ON "staff_roles" USING btree ("shop_id","name");--> statement-breakpoint
ALTER TABLE "staff_users" ADD CONSTRAINT "staff_users_role_id_staff_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."staff_roles"("id") ON DELETE set null ON UPDATE no action;