import { eq } from "drizzle-orm";
import { db, schema } from "./db/index.js";

/** El texto de la marca para quien mira: "Nombre · 1a2b3c4d · 27/11 15:03" (hora de Argentina). */
export async function viewerLabel(viewerId: string, now = new Date()) {
  const [row] = await db
    .select({ displayName: schema.profile.displayName, name: schema.user.name })
    .from(schema.user)
    .leftJoin(schema.profile, eq(schema.profile.userId, schema.user.id))
    .where(eq(schema.user.id, viewerId));
  const name = row?.displayName || row?.name || "";
  const when = now.toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Buenos_Aires",
  });
  return [name, viewerId.slice(0, 8), when.replace(",", "")].filter(Boolean).join(" · ");
}
