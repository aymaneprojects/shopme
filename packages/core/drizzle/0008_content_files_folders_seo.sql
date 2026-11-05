CREATE TABLE "file_folders" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "folder_id" bigint;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "seo_title" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "seo_description" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "seo_title" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "seo_description" text;--> statement-breakpoint
ALTER TABLE "file_folders" ADD CONSTRAINT "file_folders_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "file_folders_shop_name_uq" ON "file_folders" USING btree ("shop_id","name");--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_folder_id_file_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."file_folders"("id") ON DELETE set null ON UPDATE no action;