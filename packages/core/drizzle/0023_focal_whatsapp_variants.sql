ALTER TABLE "media" ADD COLUMN "focal_x" real;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "focal_y" real;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "hidden_from_online_store" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "whatsapp_marketing_state" text DEFAULT 'NOT_SUBSCRIBED' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "whatsapp_marketing_updated_at" timestamp with time zone;