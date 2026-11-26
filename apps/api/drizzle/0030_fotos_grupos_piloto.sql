ALTER TABLE "group" ADD COLUMN "photo_uploads_paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "group_message" ADD COLUMN "photo_key" text;--> statement-breakpoint
ALTER TABLE "group_message" ADD COLUMN "photo_hidden_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "gm_photo_idx" ON "group_message" USING btree ("photo_key") WHERE "group_message"."photo_key" is not null;