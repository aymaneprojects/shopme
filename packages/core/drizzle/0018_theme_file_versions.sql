CREATE TABLE "theme_file_versions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"theme_id" bigint NOT NULL,
	"path" text NOT NULL,
	"body" text NOT NULL,
	"checksum" text NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"staff_user_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "theme_file_versions" ADD CONSTRAINT "theme_file_versions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_file_versions" ADD CONSTRAINT "theme_file_versions_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "theme_file_versions_file_idx" ON "theme_file_versions" USING btree ("theme_id","path","created_at");