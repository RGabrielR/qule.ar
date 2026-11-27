CREATE TABLE "conversation_settings" (
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	"cleared_at" timestamp with time zone,
	CONSTRAINT "conversation_settings_user_id_conversation_id_pk" PRIMARY KEY("user_id","conversation_id")
);
--> statement-breakpoint
ALTER TABLE "conversation_settings" ADD CONSTRAINT "conversation_settings_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_settings" ADD CONSTRAINT "conversation_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conv_settings_conversation_idx" ON "conversation_settings" USING btree ("conversation_id");