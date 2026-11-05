CREATE TABLE "checkout_meta" (
	"cart_id" bigint PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"gift_card_codes" text[] DEFAULT '{}' NOT NULL,
	"recovery_email_count" integer DEFAULT 0 NOT NULL,
	"recovery_sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "discount_extensions" (
	"discount_id" bigint PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"subtype" text DEFAULT 'BASIC' NOT NULL,
	"combines_with" jsonb DEFAULT '{"product":false,"order":false,"shipping":false}'::jsonb NOT NULL,
	"bxgy" jsonb,
	CONSTRAINT "discount_ext_subtype_chk" CHECK ("discount_extensions"."subtype" in ('BASIC', 'FREE_SHIPPING', 'BXGY'))
);
--> statement-breakpoint
CREATE TABLE "gift_card_transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"gift_card_id" bigint NOT NULL,
	"amount" bigint NOT NULL,
	"note" text,
	"order_id" bigint,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gift_cards" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"code" text NOT NULL,
	"token" text NOT NULL,
	"currency" text NOT NULL,
	"initial_value" bigint NOT NULL,
	"balance" bigint NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"expires_on" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	"note" text,
	"customer_id" bigint,
	"order_id" bigint,
	"order_line_id" bigint,
	"recipient_customer_id" bigint,
	"recipient_name" text,
	"message" text,
	"send_notification_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"template_suffix" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_cards_balance_chk" CHECK ("gift_cards"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "order_edits" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"order_id" bigint NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"staff_id" bigint,
	"additions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quantities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"no_restock" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"discounts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"committed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_edits_status_chk" CHECK ("order_edits"."status" in ('OPEN', 'COMMITTED', 'DISCARDED'))
);
--> statement-breakpoint
CREATE TABLE "return_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"return_id" bigint NOT NULL,
	"order_line_id" bigint NOT NULL,
	"quantity" integer NOT NULL,
	"reason" text DEFAULT 'UNKNOWN' NOT NULL,
	"note" text,
	"restock_type" text DEFAULT 'NO_RESTOCK' NOT NULL,
	"location_id" bigint,
	"restocked" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "returns" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"order_id" bigint NOT NULL,
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"note" text,
	"request_approved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "returns_status_chk" CHECK ("returns"."status" in ('REQUESTED', 'OPEN', 'CLOSED', 'DECLINED', 'CANCELED'))
);
--> statement-breakpoint
ALTER TABLE "checkout_meta" ADD CONSTRAINT "checkout_meta_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_meta" ADD CONSTRAINT "checkout_meta_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_extensions" ADD CONSTRAINT "discount_extensions_discount_id_discounts_id_fk" FOREIGN KEY ("discount_id") REFERENCES "public"."discounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_extensions" ADD CONSTRAINT "discount_extensions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card_transactions" ADD CONSTRAINT "gift_card_transactions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card_transactions" ADD CONSTRAINT "gift_card_transactions_gift_card_id_gift_cards_id_fk" FOREIGN KEY ("gift_card_id") REFERENCES "public"."gift_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card_transactions" ADD CONSTRAINT "gift_card_transactions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_recipient_customer_id_customers_id_fk" FOREIGN KEY ("recipient_customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_edits" ADD CONSTRAINT "order_edits_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_edits" ADD CONSTRAINT "order_edits_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_return_id_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gift_card_tx_card_idx" ON "gift_card_transactions" USING btree ("gift_card_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_cards_shop_code_uq" ON "gift_cards" USING btree ("shop_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_cards_token_uq" ON "gift_cards" USING btree ("token");--> statement-breakpoint
CREATE INDEX "gift_cards_order_idx" ON "gift_cards" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_edits_order_idx" ON "order_edits" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "return_lines_return_idx" ON "return_lines" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX "returns_order_idx" ON "returns" USING btree ("order_id");