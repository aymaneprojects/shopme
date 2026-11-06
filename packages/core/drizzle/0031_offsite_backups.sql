CREATE TABLE "backup_destinations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint,
	"enabled" boolean DEFAULT true NOT NULL,
	"provider" text DEFAULT 's3' NOT NULL,
	"preset" text,
	"endpoint" text DEFAULT '' NOT NULL,
	"region" text DEFAULT '' NOT NULL,
	"force_path_style" boolean DEFAULT false NOT NULL,
	"bucket" text DEFAULT '' NOT NULL,
	"prefix" text DEFAULT '' NOT NULL,
	"access_key_id" text DEFAULT '' NOT NULL,
	"secret_key_enc" text,
	"passphrase_enc" text,
	"keep_daily" integer DEFAULT 7 NOT NULL,
	"keep_weekly" integer DEFAULT 4 NOT NULL,
	"keep_monthly" integer DEFAULT 6 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint,
	"subject_shop_id" bigint,
	"kind" text DEFAULT 'store' NOT NULL,
	"trigger" text DEFAULT 'scheduled' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"source_name" text,
	"object_key" text,
	"bytes" bigint,
	"encrypted" boolean DEFAULT false NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "backup_runs_kind_chk" CHECK ("backup_runs"."kind" in ('store', 'database')),
	CONSTRAINT "backup_runs_status_chk" CHECK ("backup_runs"."status" in ('running', 'ok', 'retry', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "backup_destinations" ADD CONSTRAINT "backup_destinations_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "backup_destinations_shop_uq" ON "backup_destinations" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "backup_runs_scope_idx" ON "backup_runs" USING btree ("shop_id","started_at");--> statement-breakpoint
CREATE INDEX "backup_runs_due_idx" ON "backup_runs" USING btree ("status","next_attempt_at");