DROP INDEX "gjr_group_status_idx";--> statement-breakpoint
CREATE INDEX "gjr_group_status_created_idx" ON "group_join_request" USING btree ("group_id","status","created_at","id");