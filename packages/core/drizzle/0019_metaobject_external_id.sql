ALTER TABLE "metaobjects" ADD COLUMN "external_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "metaobjects_external_uq" ON "metaobjects" USING btree ("shop_id","type","external_id");