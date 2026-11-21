ALTER TABLE "group" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "group" ADD COLUMN "removed_reason" text;--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "group_id" text;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_group_id_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."group"("id") ON DELETE set null ON UPDATE no action;