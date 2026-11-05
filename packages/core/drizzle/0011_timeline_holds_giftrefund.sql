ALTER TABLE "orders" ADD COLUMN "hold_reason" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "hold_note" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "held_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "gift_card_id" bigint;