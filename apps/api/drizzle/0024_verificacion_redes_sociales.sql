CREATE TABLE IF NOT EXISTS "bio_quota" (
	"network" text PRIMARY KEY NOT NULL,
	"reads" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"paused_until" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN IF NOT EXISTS "x_proof" jsonb;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN IF NOT EXISTS "instagram_proof" jsonb;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN IF NOT EXISTS "x_username" varchar(15);--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN IF NOT EXISTS "instagram_username" varchar(30);
