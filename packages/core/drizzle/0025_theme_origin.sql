ALTER TABLE "themes" ADD COLUMN "origin_theme" text;--> statement-breakpoint
ALTER TABLE "themes" ADD COLUMN "origin_version" text;--> statement-breakpoint
ALTER TABLE "themes" ADD COLUMN "origin_checksums" jsonb;--> statement-breakpoint
UPDATE "themes" AS t SET "origin_theme" = 'aurora', "origin_version" = COALESCE(substring(f."body" from '"theme_version"\s*:\s*"([0-9][0-9A-Za-z.+-]*)"'), '1.0.0')
FROM "theme_files" AS f
WHERE t."origin_theme" IS NULL AND f."theme_id" = t."id" AND f."path" = 'config/settings_schema.json'
  AND f."body" ~ '"theme_name"\s*:\s*"Aurora"' AND f."body" ~ '"theme_author"\s*:\s*"ShopMe contributors"'
  AND EXISTS (SELECT 1 FROM "theme_files" AS a WHERE a."theme_id" = t."id" AND a."path" = 'assets/aurora.css');
