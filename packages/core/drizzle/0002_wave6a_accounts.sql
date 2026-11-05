CREATE TABLE "customer_tokens" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"customer_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "customer_tokens_kind_chk" CHECK ("customer_tokens"."kind" in ('reset', 'activate'))
);
--> statement-breakpoint
ALTER TABLE "blogs" ADD COLUMN "comment_policy" text DEFAULT 'CLOSED' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_tokens" ADD CONSTRAINT "customer_tokens_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_tokens" ADD CONSTRAINT "customer_tokens_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_tokens_customer_idx" ON "customer_tokens" USING btree ("customer_id","kind");