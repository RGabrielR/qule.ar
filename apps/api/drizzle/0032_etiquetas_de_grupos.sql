ALTER TABLE "group" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "group_tags_idx" ON "group" USING gin ("tags");