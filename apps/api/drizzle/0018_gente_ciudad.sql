ALTER TABLE "profile" ADD COLUMN "discovery_country" text;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "discovery_city" text;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "discovery_city_key" text;--> statement-breakpoint
CREATE INDEX "profile_discovery_city_idx" ON "profile" USING btree ("discovery_country","discovery_city_key");