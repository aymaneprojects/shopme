CREATE TABLE "email_dkim_keys" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint,
	"domain" text NOT NULL,
	"selector" text NOT NULL,
	"public_key" text NOT NULL,
	"private_key_enc" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	CONSTRAINT "email_dkim_keys_status_chk" CHECK ("email_dkim_keys"."status" in ('active', 'pending', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint,
	"message_id" text NOT NULL,
	"to_address" text NOT NULL,
	"from_address" text NOT NULL,
	"subject" text NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"last_response" text,
	"mx_host" text,
	"next_attempt_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_outbox_status_chk" CHECK ("email_outbox"."status" in ('queued', 'sending', 'retry', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "email_settings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint,
	"mode" text,
	"relay_preset" text,
	"relay_host" text,
	"relay_port" integer,
	"relay_security" text,
	"relay_username" text,
	"relay_password_enc" text,
	"manual_public_ip" text,
	"dmarc_report_email" text,
	"auth_domain" text,
	"auth_ok" boolean DEFAULT false NOT NULL,
	"auth_checked_at" timestamp with time zone,
	"last_check" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_dkim_keys" ADD CONSTRAINT "email_dkim_keys_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_settings" ADD CONSTRAINT "email_settings_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_dkim_keys_scope_idx" ON "email_dkim_keys" USING btree ("shop_id","domain");--> statement-breakpoint
CREATE INDEX "email_outbox_shop_idx" ON "email_outbox" USING btree ("shop_id","id");--> statement-breakpoint
CREATE INDEX "email_outbox_due_idx" ON "email_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_settings_shop_uq" ON "email_settings" USING btree ("shop_id");