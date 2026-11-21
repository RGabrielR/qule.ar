ALTER TABLE "profile" ADD COLUMN "gender_identity" text;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "gender_other" text;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "sexual_orientation" text;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "orientation_other" text;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "is_trans" boolean;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "lgbtq_member" boolean;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "show_gender" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "show_orientation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "show_trans" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "show_lgbtq" boolean DEFAULT false NOT NULL;