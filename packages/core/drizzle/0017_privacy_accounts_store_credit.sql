CREATE TABLE "consent_policies" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"country_code" text,
	"region_code" text,
	"consent_required" boolean DEFAULT false NOT NULL,
	"data_sale_opt_out_required" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_login_codes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pixels" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"kind" text DEFAULT 'CUSTOM' NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"connected" boolean DEFAULT false NOT NULL,
	"required_consent" text[] DEFAULT '{}' NOT NULL,
	"respect_sale_opt_out" boolean DEFAULT true NOT NULL,
	"dom_events" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storefront_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"event_id" text,
	"name" text NOT NULL,
	"client_id" text,
	"customer_id" bigint,
	"data" jsonb,
	"context" jsonb,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_credit_accounts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"customer_id" bigint NOT NULL,
	"currency" text NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sc_balance_chk" CHECK ("store_credit_accounts"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "store_credit_allocations" (
	"shop_id" bigint NOT NULL,
	"debit_transaction_id" bigint NOT NULL,
	"credit_transaction_id" bigint NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "store_credit_allocations_debit_transaction_id_credit_transaction_id_pk" PRIMARY KEY("debit_transaction_id","credit_transaction_id")
);
--> statement-breakpoint
CREATE TABLE "store_credit_transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"account_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"event" text DEFAULT 'ADJUSTMENT' NOT NULL,
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"expires_at" timestamp with time zone,
	"remaining" bigint,
	"credit_transaction_id" bigint,
	"debit_transaction_id" bigint,
	"order_id" bigint,
	"staff_user_id" bigint,
	"note" text,
	"notified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sc_tx_kind_chk" CHECK ("store_credit_transactions"."kind" in ('CREDIT', 'DEBIT', 'DEBIT_REVERT', 'EXPIRATION')),
	CONSTRAINT "sc_tx_event_chk" CHECK ("store_credit_transactions"."event" in ('ADJUSTMENT', 'ORDER_PAYMENT', 'ORDER_REFUND', 'PAYMENT_FAILURE', 'PAYMENT_RETURNED', 'ORDER_CANCELLATION', 'TAX_FINALIZATION', 'RECURRING_PAYMENT'))
);
--> statement-breakpoint
ALTER TABLE "customer_tokens" DROP CONSTRAINT "customer_tokens_kind_chk";--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "data_sale_opt_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "consent" jsonb;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "email_marketing_state" text DEFAULT 'NOT_SUBSCRIBED' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "email_marketing_opt_in_level" text DEFAULT 'UNKNOWN' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "email_marketing_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "sms_marketing_state" text DEFAULT 'NOT_SUBSCRIBED' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "sms_marketing_opt_in_level" text DEFAULT 'UNKNOWN' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "sms_marketing_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "sms_marketing_collected_from" text;--> statement-breakpoint
ALTER TABLE "checkout_meta" ADD COLUMN "use_store_credit" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "consent_policies" ADD CONSTRAINT "consent_policies_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_login_codes" ADD CONSTRAINT "customer_login_codes_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pixels" ADD CONSTRAINT "pixels_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storefront_events" ADD CONSTRAINT "storefront_events_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storefront_events" ADD CONSTRAINT "storefront_events_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_credit_accounts" ADD CONSTRAINT "store_credit_accounts_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_credit_accounts" ADD CONSTRAINT "store_credit_accounts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_credit_allocations" ADD CONSTRAINT "store_credit_allocations_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_credit_allocations" ADD CONSTRAINT "store_credit_allocations_debit_transaction_id_store_credit_transactions_id_fk" FOREIGN KEY ("debit_transaction_id") REFERENCES "public"."store_credit_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_credit_allocations" ADD CONSTRAINT "store_credit_allocations_credit_transaction_id_store_credit_transactions_id_fk" FOREIGN KEY ("credit_transaction_id") REFERENCES "public"."store_credit_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_credit_transactions" ADD CONSTRAINT "store_credit_transactions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_credit_transactions" ADD CONSTRAINT "store_credit_transactions_account_id_store_credit_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."store_credit_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consent_policies_uq" ON "consent_policies" USING btree ("shop_id","country_code","region_code");--> statement-breakpoint
CREATE INDEX "customer_login_codes_email_idx" ON "customer_login_codes" USING btree ("shop_id","email");--> statement-breakpoint
CREATE INDEX "storefront_events_idx" ON "storefront_events" USING btree ("shop_id","name","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "storefront_events_event_uq" ON "storefront_events" USING btree ("shop_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_credit_accounts_uq" ON "store_credit_accounts" USING btree ("shop_id","customer_id","currency");--> statement-breakpoint
CREATE INDEX "sc_tx_account_idx" ON "store_credit_transactions" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "sc_tx_expiry_idx" ON "store_credit_transactions" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "customer_tokens" ADD CONSTRAINT "customer_tokens_kind_chk" CHECK ("customer_tokens"."kind" in ('reset', 'activate', 'subscribe'));
--> statement-breakpoint
UPDATE "customers" SET "email_marketing_state" = 'SUBSCRIBED', "email_marketing_updated_at" = "updated_at" WHERE "accepts_marketing" = true;
