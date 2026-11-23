CREATE TABLE "appeal" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"suspended_at" timestamp with time zone NOT NULL,
	"suspend_reason" text,
	"suspended_by" text,
	"body" text NOT NULL,
	"extra" text,
	"extra_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"response" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_log" (
	"id" text PRIMARY KEY NOT NULL,
	"to_hash" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_action" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target_id" text,
	"details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_permission" (
	"user_id" text NOT NULL,
	"permission" text NOT NULL,
	"granted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_permission_user_id_permission_pk" PRIMARY KEY("user_id","permission")
);
--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "suspended_by" text;--> statement-breakpoint
ALTER TABLE "appeal" ADD CONSTRAINT "appeal_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeal" ADD CONSTRAINT "appeal_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_action" ADD CONSTRAINT "mod_action_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_permission" ADD CONSTRAINT "staff_permission_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_permission" ADD CONSTRAINT "staff_permission_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appeal_suspension_idx" ON "appeal" USING btree ("user_id","suspended_at");--> statement-breakpoint
CREATE INDEX "appeal_status_idx" ON "appeal" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "mail_log_created_idx" ON "mail_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "mail_log_to_idx" ON "mail_log" USING btree ("to_hash","created_at");--> statement-breakpoint
CREATE INDEX "mod_action_created_idx" ON "mod_action" USING btree ("created_at");