ALTER TABLE "report" ADD COLUMN "capture_key" text;--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "photo_match" jsonb;--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "moderator_response" text;--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "responded_at" timestamp with time zone;