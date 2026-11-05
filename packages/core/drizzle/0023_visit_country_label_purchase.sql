CREATE TABLE "shipping_label_documents" (
	"label_id" bigint PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"content_type" text NOT NULL,
	"data" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "country_code" text;--> statement-breakpoint
ALTER TABLE "shipping_labels" ADD COLUMN "source" text DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "shipping_labels" ADD COLUMN "carrier_account_id" text;--> statement-breakpoint
ALTER TABLE "shipping_labels" ADD COLUMN "provider_ref" text;--> statement-breakpoint
ALTER TABLE "shipping_labels" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "shipping_labels" ADD COLUMN "label_format" text;--> statement-breakpoint
ALTER TABLE "shipping_labels" ADD COLUMN "label_url" text;--> statement-breakpoint
ALTER TABLE "shipping_labels" ADD COLUMN "refund_status" text;--> statement-breakpoint
ALTER TABLE "shipping_label_documents" ADD CONSTRAINT "shipping_label_documents_label_id_shipping_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."shipping_labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_label_documents" ADD CONSTRAINT "shipping_label_documents_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visits_session_idx" ON "visits" USING btree ("shop_id","session_id");--> statement-breakpoint
ALTER TABLE "shipping_labels" ADD CONSTRAINT "shipping_labels_source_chk" CHECK ("shipping_labels"."source" in ('MANUAL', 'PURCHASED'));