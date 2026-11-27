-- Limpia los nombres existentes sin alterar las letras ni el texto libre de los reportes.
UPDATE "user"
SET "name" = coalesce(nullif(btrim(regexp_replace("name", U&'[\202A-\202E\2066-\2069]', '', 'g')), ''), 'Cuenta sin nombre')
WHERE "name" ~ U&'[\202A-\202E\2066-\2069]';
--> statement-breakpoint
UPDATE "profile"
SET "display_name" = coalesce(nullif(btrim(regexp_replace("display_name", U&'[\202A-\202E\2066-\2069]', '', 'g')), ''), 'Cuenta sin nombre')
WHERE "display_name" ~ U&'[\202A-\202E\2066-\2069]';
--> statement-breakpoint
UPDATE "group"
SET "name" = coalesce(nullif(btrim(regexp_replace("name", U&'[\202A-\202E\2066-\2069]', '', 'g')), ''), 'Grupo sin nombre')
WHERE "name" ~ U&'[\202A-\202E\2066-\2069]';
--> statement-breakpoint
UPDATE "report"
SET "target_name" = nullif(btrim(regexp_replace("target_name", U&'[\202A-\202E\2066-\2069]', '', 'g')), '')
WHERE "target_name" ~ U&'[\202A-\202E\2066-\2069]';
