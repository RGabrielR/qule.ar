-- Varios álbumes privados por persona, que se comparten de a uno.
-- Todo lo que ya estaba en el álbum único (fotos, videos y accesos) pasa a un álbum por defecto, sin perder nada.
CREATE TABLE "album" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "album" ADD CONSTRAINT "album_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "album_user_idx" ON "album" USING btree ("user_id","position");--> statement-breakpoint
-- Un álbum por defecto para cada persona que ya tenía algo en su álbum privado o lo había compartido
INSERT INTO "album" ("id", "user_id", "name", "position")
SELECT gen_random_uuid()::text, "uid", 'Álbum privado', 0
FROM (
	SELECT "user_id" AS "uid" FROM "photo" WHERE "is_private"
	UNION
	SELECT "owner_id" FROM "album_grant"
) AS "owners";--> statement-breakpoint
ALTER TABLE "photo" ADD COLUMN "album_id" text;--> statement-breakpoint
UPDATE "photo" SET "album_id" = "album"."id" FROM "album" WHERE "album"."user_id" = "photo"."user_id" AND "photo"."is_private";--> statement-breakpoint
ALTER TABLE "photo" ADD CONSTRAINT "photo_album_id_album_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."album"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Los accesos que ya existen pasan al álbum por defecto, con el mismo vencimiento
ALTER TABLE "album_grant" ADD COLUMN "album_id" text;--> statement-breakpoint
UPDATE "album_grant" SET "album_id" = "album"."id" FROM "album" WHERE "album"."user_id" = "album_grant"."owner_id";--> statement-breakpoint
ALTER TABLE "album_grant" ALTER COLUMN "album_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "album_grant" DROP CONSTRAINT "album_grant_owner_id_grantee_id_pk";--> statement-breakpoint
ALTER TABLE "album_grant" ADD CONSTRAINT "album_grant_album_id_grantee_id_pk" PRIMARY KEY("album_id","grantee_id");--> statement-breakpoint
ALTER TABLE "album_grant" ADD CONSTRAINT "album_grant_album_id_album_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."album"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "album_grant_owner_idx" ON "album_grant" USING btree ("owner_id","grantee_id");
