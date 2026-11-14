ALTER TABLE "shop_secrets" ADD COLUMN "paypal_client_id" text;--> statement-breakpoint
ALTER TABLE "shop_secrets" ADD COLUMN "paypal_client_secret" text;--> statement-breakpoint
ALTER TABLE "shop_secrets" ADD COLUMN "paypal_environment" text;--> statement-breakpoint
ALTER TABLE "shop_secrets" ADD COLUMN "paypal_webhook_id" text;--> statement-breakpoint
ALTER TABLE "shop_secrets" ADD COLUMN "paypal_webhook_managed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_secrets" ADD COLUMN "mollie_api_key" text;