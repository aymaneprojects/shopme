CREATE TABLE "shop_locales" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"locale" text NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_two_factor" (
	"staff_user_id" bigint PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"secret" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"recovery_codes" text[] DEFAULT '{}' NOT NULL,
	"enabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "translations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"key" text NOT NULL,
	"locale" text NOT NULL,
	"value" text NOT NULL,
	"digest" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"session_id" text NOT NULL,
	"path" text NOT NULL,
	"referrer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shop_locales" ADD CONSTRAINT "shop_locales_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_two_factor" ADD CONSTRAINT "staff_two_factor_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_two_factor" ADD CONSTRAINT "staff_two_factor_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translations" ADD CONSTRAINT "translations_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shop_locales_uq" ON "shop_locales" USING btree ("shop_id","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "translations_uq" ON "translations" USING btree ("shop_id","resource_type","resource_id","key","locale");--> statement-breakpoint
CREATE INDEX "translations_lookup_idx" ON "translations" USING btree ("shop_id","locale","resource_type");--> statement-breakpoint
CREATE INDEX "visits_shop_created_idx" ON "visits" USING btree ("shop_id","created_at");