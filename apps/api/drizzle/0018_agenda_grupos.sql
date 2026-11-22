CREATE TABLE "group_event" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone NOT NULL,
	"capacity" integer NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "group_event_group_key" UNIQUE("id","group_id")
);
--> statement-breakpoint
CREATE TABLE "group_event_attendance" (
	"event_id" text NOT NULL,
	"group_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "group_event_attendance_event_id_user_id_pk" PRIMARY KEY("event_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "group_event" ADD CONSTRAINT "group_event_group_id_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_event_attendance" ADD CONSTRAINT "group_event_attendance_event_id_group_id_group_event_id_group_id_fk" FOREIGN KEY ("event_id","group_id") REFERENCES "public"."group_event"("id","group_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_event_attendance" ADD CONSTRAINT "group_event_attendance_group_id_user_id_group_member_group_id_user_id_fk" FOREIGN KEY ("group_id","user_id") REFERENCES "public"."group_member"("group_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_event_start_idx" ON "group_event" USING btree ("group_id","starts_at");--> statement-breakpoint
CREATE INDEX "group_event_attendance_member_idx" ON "group_event_attendance" USING btree ("group_id","user_id");