CREATE TABLE "account_two_factor" (
	"account_id" bigint PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"recovery_codes" text[] DEFAULT '{}' NOT NULL,
	"enabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_accounts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"platform_owner" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_domains" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"host" text NOT NULL,
	"verification_token" text NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_secrets" (
	"shop_id" bigint PRIMARY KEY NOT NULL,
	"stripe_publishable_key" text,
	"stripe_secret_key" text,
	"stripe_webhook_secret" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_shop_id_shops_id_fk";
--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "shop_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "account_id" bigint;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "handle" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "status" text DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "storage_prefix" text;--> statement-breakpoint
ALTER TABLE "staff_users" ADD COLUMN "account_id" bigint;--> statement-breakpoint
ALTER TABLE "account_two_factor" ADD CONSTRAINT "account_two_factor_account_id_platform_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."platform_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_domains" ADD CONSTRAINT "shop_domains_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_secrets" ADD CONSTRAINT "shop_secrets_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_accounts_email_idx" ON "platform_accounts" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_domains_host_uq" ON "shop_domains" USING btree ("host");--> statement-breakpoint
CREATE INDEX "shop_domains_shop_idx" ON "shop_domains" USING btree ("shop_id");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_platform_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."platform_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_users" ADD CONSTRAINT "staff_users_account_id_platform_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."platform_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shops_handle_uq" ON "shops" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "staff_users_account_idx" ON "staff_users" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_status_chk" CHECK ("shops"."status" in ('ACTIVE', 'SUSPENDED'));--> statement-breakpoint
-- Store handles: slug of the name, made unique with the id when two stores share a name.
UPDATE "shops" AS s SET "handle" = x."h" FROM (
  SELECT "id", CASE WHEN row_number() OVER (PARTITION BY "base" ORDER BY "id") = 1 THEN "base" ELSE "base" || '-' || "id" END AS "h"
  FROM (SELECT "id", left(coalesce(nullif(trim(both '-' from regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g')), ''), 'store'), 40) AS "base" FROM "shops") AS b
) AS x WHERE s."id" = x."id" AND s."handle" IS NULL;--> statement-breakpoint
-- One account per existing staff member with a password (same id), so every member keeps signing in as before.
-- Members of different stores are never merged here, even with the same e-mail.
INSERT INTO "platform_accounts" ("id", "email", "password_hash", "first_name", "last_name", "last_login_at", "created_at", "updated_at")
SELECT "id", "email", "password_hash", "first_name", "last_name", "last_login_at", "created_at", "updated_at" FROM "staff_users"
WHERE "password_hash" IS NOT NULL AND "password_hash" LIKE '$argon2%' AND "invite_token_hash" IS NULL;--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('"platform_accounts"', 'id'), greatest((SELECT coalesce(max("id"), 0) FROM "platform_accounts"), 1), (SELECT count(*) > 0 FROM "platform_accounts"));--> statement-breakpoint
UPDATE "staff_users" SET "account_id" = "id" WHERE "id" IN (SELECT "id" FROM "platform_accounts");--> statement-breakpoint
UPDATE "platform_accounts" SET "platform_owner" = true WHERE "id" = (SELECT "account_id" FROM "staff_users" WHERE "role" = 'owner' AND "account_id" IS NOT NULL ORDER BY "shop_id", "id" LIMIT 1);--> statement-breakpoint
INSERT INTO "account_two_factor" ("account_id", "secret", "enabled", "recovery_codes", "enabled_at", "created_at")
SELECT su."account_id", tf."secret", tf."enabled", tf."recovery_codes", tf."enabled_at", tf."created_at" FROM "staff_two_factor" AS tf
JOIN "staff_users" AS su ON su."id" = tf."staff_user_id" WHERE su."account_id" IS NOT NULL;--> statement-breakpoint
UPDATE "sessions" AS se SET "account_id" = su."account_id" FROM "staff_users" AS su WHERE se."kind" = 'staff' AND se."staff_user_id" = su."id";
