CREATE INDEX "report_target_history_idx" ON "report" USING btree ("target_user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "report_group_history_idx" ON "report" USING btree ("group_id","created_at","id");--> statement-breakpoint
CREATE INDEX "report_reporter_history_idx" ON "report" USING btree ("reporter_id","created_at","id");
