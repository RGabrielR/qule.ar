CREATE TABLE "group_poll" (
	"message_id" text PRIMARY KEY NOT NULL,
	"options" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_poll_vote" (
	"message_id" text NOT NULL,
	"user_id" text NOT NULL,
	"option" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_poll_vote_message_id_user_id_pk" PRIMARY KEY("message_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "group_poll" ADD CONSTRAINT "group_poll_message_id_group_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."group_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_poll_vote" ADD CONSTRAINT "group_poll_vote_message_id_group_poll_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."group_poll"("message_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_poll_vote" ADD CONSTRAINT "group_poll_vote_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gpv_user_idx" ON "group_poll_vote" USING btree ("user_id");