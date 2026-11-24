ALTER TABLE "direct_message" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "group_message" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "dm_sender_idempotency_idx" ON "direct_message" USING btree ("sender_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "gm_sender_idempotency_idx" ON "group_message" USING btree ("user_id","idempotency_key");