CREATE TABLE "report_mute" (
	"user_id" text PRIMARY KEY NOT NULL,
	"muted_by" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_mute" ADD CONSTRAINT "report_mute_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_mute" ADD CONSTRAINT "report_mute_muted_by_user_id_fk" FOREIGN KEY ("muted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;