ALTER TABLE "photo" ADD COLUMN "explicit_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "photo" ADD COLUMN "explicit_score" real;--> statement-breakpoint
ALTER TABLE "photo" ADD COLUMN "explicit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "photo" ADD COLUMN "explicit_review_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "photo" ADD COLUMN "explicit_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "photo" ADD COLUMN "explicit_reviewed_by" text;--> statement-breakpoint
-- Las cuentas que ya existían arrancan con la opción apagada (como estaban); las nuevas, prendida.
ALTER TABLE "profile" ADD COLUMN "hide_explicit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profile" ALTER COLUMN "hide_explicit" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "photo" ADD CONSTRAINT "photo_explicit_reviewed_by_user_id_fk" FOREIGN KEY ("explicit_reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "photo_explicit_queue_idx" ON "photo" USING btree ("created_at" DESC NULLS LAST) WHERE "photo"."explicit_checked_at" is null and "photo"."explicit_reviewed_at" is null and "photo"."is_private" = false and "photo"."kind" = 'photo';--> statement-breakpoint
CREATE INDEX "photo_explicit_review_idx" ON "photo" USING btree ("explicit_review_requested_at") WHERE "photo"."explicit_review_requested_at" is not null;