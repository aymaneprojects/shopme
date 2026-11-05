CREATE TABLE "companies" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"name" text NOT NULL,
	"external_id" text,
	"note" text,
	"main_contact_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_contacts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"company_id" bigint NOT NULL,
	"customer_id" bigint NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_locations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"company_id" bigint NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"external_id" text,
	"note" text,
	"tax_registration_id" text,
	"tax_exempt" boolean DEFAULT false NOT NULL,
	"payment_terms_days" integer,
	"address1" text,
	"address2" text,
	"city" text,
	"zip" text,
	"province" text,
	"country_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_annotations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"report_key" text,
	"day" text NOT NULL,
	"text" text NOT NULL,
	"created_by_staff_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_explorations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"name" text NOT NULL,
	"definition" jsonb NOT NULL,
	"created_by_staff_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_goals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"metric" text NOT NULL,
	"period" text NOT NULL,
	"target" bigint NOT NULL,
	"created_by_staff_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_report_states" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"staff_user_id" bigint NOT NULL,
	"report_key" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"last_viewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "saved_searches" DROP CONSTRAINT "saved_searches_type_chk";--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "erasure_scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "erased_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "company_id" bigint;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "company_contact_id" bigint;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "company_location_id" bigint;--> statement-breakpoint
ALTER TABLE "draft_orders" ADD COLUMN "company_id" bigint;--> statement-breakpoint
ALTER TABLE "draft_orders" ADD COLUMN "company_contact_id" bigint;--> statement-breakpoint
ALTER TABLE "draft_orders" ADD COLUMN "company_location_id" bigint;--> statement-breakpoint
ALTER TABLE "metaobjects" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_contacts" ADD CONSTRAINT "company_contacts_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_contacts" ADD CONSTRAINT "company_contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_contacts" ADD CONSTRAINT "company_contacts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_locations" ADD CONSTRAINT "company_locations_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_locations" ADD CONSTRAINT "company_locations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_annotations" ADD CONSTRAINT "analytics_annotations_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_explorations" ADD CONSTRAINT "analytics_explorations_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_goals" ADD CONSTRAINT "analytics_goals_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_report_states" ADD CONSTRAINT "analytics_report_states_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "companies_shop_idx" ON "companies" USING btree ("shop_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_external_uq" ON "companies" USING btree ("shop_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_contacts_uq" ON "company_contacts" USING btree ("company_id","customer_id");--> statement-breakpoint
CREATE INDEX "company_contacts_customer_idx" ON "company_contacts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "company_locations_company_idx" ON "company_locations" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "analytics_annotations_shop_idx" ON "analytics_annotations" USING btree ("shop_id","day");--> statement-breakpoint
CREATE INDEX "analytics_explorations_shop_idx" ON "analytics_explorations" USING btree ("shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_goals_uq" ON "analytics_goals" USING btree ("shop_id","metric","period");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_report_states_uq" ON "analytics_report_states" USING btree ("shop_id","staff_user_id","report_key");--> statement-breakpoint
CREATE UNIQUE INDEX "metaobjects_external_uq" ON "metaobjects" USING btree ("shop_id","type","external_id");--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_type_chk" CHECK ("saved_searches"."resource_type" in ('PRODUCT', 'ORDER', 'CUSTOMER', 'INVENTORY', 'PAGE', 'ARTICLE'));