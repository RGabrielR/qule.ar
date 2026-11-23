import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db, schema } from "./db/index.js";
import { pushTo } from "./push.js";
import { notifyStaff } from "./staff.js";
import { deleteImage } from "./storage.js";
import { forgetFile } from "./fileCache.js";

const { report } = schema;

/**
 * Motivos de reporte. Los tres primeros son urgentes: se revisan primero, avisan a moderación al instante
 * y, si varias personas los reportan, ocultan el perfil de la grilla hasta que alguien lo revise.
 * Tiene que coincidir con REPORT_REASONS en apps/web/src/options.ts. Ver docs/MODERACION.md.
 */
export const REPORT_REASONS = [
  "menor de edad",
  "contenido íntimo sin consentimiento",
  "amenazas o violencia",
  "venta o drogas",
  "acoso",
  "fotos inapropiadas",
  "perfil falso",
  "spam",
  "otro",
] as const;
export const URGENT_REASONS: readonly string[] = REPORT_REASONS.slice(0, 3);
export const isUrgent = (reason: string) => URGENT_REASONS.includes(reason);

/** Cuántas personas distintas tienen que reportar algo urgente para ocultar el perfil de la grilla. */
export const AUTO_HIDE_REPORTERS = 3;

/**
 * Aviso a moderación de un reporte urgente. Discreto, como todas las notificaciones: no dice quién ni por qué.
 * Si es por menor de edad, a la administración general le llega siempre, aunque haya apagado los avisos de moderación.
 */
export async function notifyModeratorsUrgent(reason: string) {
  await notifyStaff(
    "reports",
    { title: "Reporte urgente", body: "Abrí Moderación para revisarlo.", url: "/admin", tag: "reporte-urgente" },
    { ownersAlways: reason === "menor de edad" },
  );
}

/**
 * Perfiles ocultos de la grilla por precaución: tienen reportes urgentes abiertos de AUTO_HIDE_REPORTERS
 * personas distintas. Vuelven a aparecer cuando moderación cierra esos reportes (descarta o actúa).
 * No es una suspensión: la cuenta sigue funcionando, solo deja de aparecer en "Cerca" y en las listas para invitar.
 */
export async function autoHiddenUsers(): Promise<Set<string>> {
  const rows = await db
    .select({ id: report.targetUserId })
    .from(report)
    .where(and(eq(report.status, "open"), inArray(report.reason, [...URGENT_REASONS])))
    .groupBy(report.targetUserId)
    .having(sql`count(distinct ${report.reporterId}) >= ${AUTO_HIDE_REPORTERS}`);
  return new Set(rows.flatMap((r) => (r.id ? [r.id] : [])));
}

// ---------- Pruebas de los reportes ----------
// Un reporte guarda una copia del texto y la lista de archivos involucrados (evidenceKeys). Esos archivos no se
// borran mientras el reporte esté abierto o haya terminado en una medida, aunque se desenvíe el mensaje, se borre
// la foto o la cuenta. Ley 25.326, art. 16 inc. 5: la supresión no procede si perjudica derechos de terceros
// o hay obligación legal de conservar. Si moderación descarta el reporte, la copia se libera y se borra.

const KEPT = ["open", "actioned"];

/** ¿Este archivo es prueba de algún reporte abierto o que terminó en una medida? */
export async function isEvidence(key: string): Promise<boolean> {
  const [r] = await db.select({ id: report.id }).from(report)
    .where(and(inArray(report.status, KEPT), sql`${report.evidenceKeys} @> ${JSON.stringify([key])}::jsonb`))
    .limit(1);
  return Boolean(r);
}

/** Borra un archivo, salvo que sea prueba de un reporte (en ese caso queda guardado para moderación). */
export async function deleteImageUnlessEvidence(key: string) {
  // Si quedó como prueba, desde ahora solo la ve moderación
  forgetFile(key);
  if (await isEvidence(key)) return;
  await deleteImage(key);
}

/** ¿El archivo lo sigue usando algo vivo (un mensaje, una foto de perfil/álbum o la foto de un grupo)? */
async function stillInUse(key: string) {
  const [m] = await db.select({ id: schema.directMessage.id }).from(schema.directMessage)
    .where(eq(schema.directMessage.photoKey, key)).limit(1);
  if (m) return true;
  const [p] = await db.select({ id: schema.photo.id }).from(schema.photo)
    .where(or(eq(schema.photo.key, key), eq(schema.photo.posterKey, key))).limit(1);
  if (p) return true;
  const [g] = await db.select({ id: schema.group.id }).from(schema.group).where(eq(schema.group.photoKey, key)).limit(1);
  return Boolean(g);
}

/** Al descartar reportes: se borra la copia del texto y los archivos que ya nadie usa ni son prueba de otro reporte. */
export async function releaseEvidence(reportIds: string[]) {
  if (!reportIds.length) return;
  const rows = await db.select({ keys: report.evidenceKeys }).from(report).where(inArray(report.id, reportIds));
  await db.update(report).set({ messageBody: null, evidenceKeys: [] }).where(inArray(report.id, reportIds));
  for (const key of new Set(rows.flatMap((r) => r.keys))) {
    if (!(await isEvidence(key)) && !(await stillInUse(key))) await deleteImage(key);
  }
}

// ---------- Grupos ----------

/** Grupos ocultos del listado por precaución: reportes urgentes abiertos de AUTO_HIDE_REPORTERS personas distintas. */
export async function autoHiddenGroups(): Promise<Set<string>> {
  const rows = await db
    .select({ id: report.groupId })
    .from(report)
    .where(and(eq(report.status, "open"), inArray(report.reason, [...URGENT_REASONS]), sql`${report.groupId} is not null`))
    .groupBy(report.groupId)
    .having(sql`count(distinct ${report.reporterId}) >= ${AUTO_HIDE_REPORTERS}`);
  return new Set(rows.flatMap((r) => (r.id ? [r.id] : [])));
}

/** ¿El grupo es prueba de algún reporte (el grupo en sí o un mensaje suyo)? Entonces no se borra: se da de baja. */
export async function groupIsEvidence(groupId: string): Promise<boolean> {
  const [r] = await db.select({ id: report.id }).from(report)
    .where(and(
      inArray(report.status, KEPT),
      or(
        eq(report.groupId, groupId),
        and(eq(report.messageKind, "group"),
          sql`${report.messageId} in (select id from ${schema.groupMessage} where ${schema.groupMessage.groupId} = ${groupId})`),
      ),
    ))
    .limit(1);
  return Boolean(r);
}

/** Días que un grupo dado de baja queda guardado como prueba antes de borrarse del todo. */
export const REMOVED_GROUP_DAYS = 90;

/** Borra del todo los grupos dados de baja hace más de REMOVED_GROUP_DAYS (sus reportes conservan la copia). */
export async function purgeRemovedGroups() {
  const gone = await db.delete(schema.group)
    .where(sql`${schema.group.removedAt} < now() - make_interval(days => ${REMOVED_GROUP_DAYS})`)
    .returning({ photoKey: schema.group.photoKey });
  // La foto del grupo se guardó con él como prueba; ahora se borra, salvo que sea prueba de un reporte
  for (const g of gone) if (g.photoKey) await deleteImageUnlessEvidence(g.photoKey);
}

// ---------- Alertas automáticas: señales de menores en nombres y descripciones ----------
// No borran ni ocultan nada: crean un reporte urgente para que una persona lo revise. Ver docs/MODERACION.md.

const MINOR_SIGNALS: RegExp[] = [
  /(?:^|[^\d+])[-−]\s?18\b/, // "-18"
  /\+\s?1[0-7]\b/, // "+14", "+16" (el "+18" de adultos no cuenta)
  /\b1[0-7]\s?(?:anos|anitos)\b|\b1[0-7]a\b/, // "15 años", "16a" (pero no "de 15 a 18", que es un horario)
  /\bsub\s?-?\s?1[0-8]\b/, // "sub 18", "sub-16"
  /\bmenores\b|\bmenor de edad\b|\bmenorcit[oa]s?\b/,
  /\bteens?\b|\bsecundari[oa]s?\b|\bliceo\b/,
];

/** Devuelve el fragmento que dispara la alerta, o null. Ignora mayúsculas y tildes. */
export function minorSignal(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  for (const re of MINOR_SIGNALS) {
    const m = re.exec(t);
    if (m) return m[0].trim();
  }
  return null;
}

export const AUTO_DETAILS_PREFIX = "Alerta automática";

/**
 * Revisa un texto y, si hay señales de menores, crea un reporte urgente sin persona que lo mande (reporterId null).
 * No duplica: si ya hay una alerta abierta para ese perfil o grupo, no crea otra.
 */
export async function checkMinorSignals(
  target: { userId: string; name: string } | { groupId: string; name: string },
  fields: Record<string, string | null | undefined>,
) {
  let hit: string | null = null;
  let where = "";
  for (const [label, value] of Object.entries(fields)) {
    hit = minorSignal(value);
    if (hit) { where = label; break; }
  }
  if (!hit) return;
  const isGroup = "groupId" in target;
  // No repite: si hay una alerta abierta, o una ya resuelta con el mismo texto (por ejemplo, descartada), no crea otra
  const text = Object.values(fields).filter(Boolean).join("\n");
  const [dup] = await db.select({ id: report.id }).from(report)
    .where(and(
      sql`${report.reporterId} is null`,
      sql`${report.details} like ${AUTO_DETAILS_PREFIX + "%"}`,
      isGroup ? eq(report.groupId, target.groupId) : eq(report.targetUserId, target.userId),
      or(eq(report.status, "open"), eq(report.messageBody, text)),
    ))
    .limit(1);
  if (dup) return;
  await db.insert(report).values({
    id: crypto.randomUUID(),
    reporterId: null,
    targetUserId: isGroup ? null : target.userId,
    groupId: isGroup ? target.groupId : null,
    reason: "menor de edad",
    details: `${AUTO_DETAILS_PREFIX}: «${hit}» en ${where}.`,
    targetName: target.name,
    messageBody: text,
  });
  await notifyModeratorsUrgent("menor de edad");
}

// ---------- Nombres y descripciones de grupos que no se permiten ----------
// Un grupo no se puede crear ni editar con un nombre o una descripción que apunte a menores o a vender cosas o
// servicios (incluidos masajes y servicios sexuales). Ver los Términos (punto 4) y docs/MODERACION.md.
// Las drogas no se filtran por palabras: hablar de consumo cuidado y de reducción de daños está permitido.
// Vender u ofrecer drogas se reporta a mano ("venta o drogas").

type ForbiddenKind = "menores" | "venta" | "servicios";

const FORBIDDEN_GROUP: { kind: ForbiddenKind; message: string; patterns: RegExp[] }[] = [
  {
    kind: "menores",
    message: "No se pueden crear grupos que sugieran menores de edad. qule.ar es solo para mayores de 18.",
    patterns: MINOR_SIGNALS,
  },
  {
    kind: "servicios",
    message: "No se pueden crear grupos para ofrecer masajes, acompañantes ni servicios sexuales.",
    patterns: [/\bmasaj\w*/, /\bescorts?\b/, /\bacompanantes?\b/, /\bprepagos?\b/, /\btrabajo sexual\b/, /\bservicios? sexual\w*/],
  },
  {
    kind: "venta",
    message: "Los grupos no pueden ser para vender ni comprar cosas o servicios.",
    patterns: [
      /\bvend(?:o|e|emos|en|er|edor\w*)\b/, /\bventas?\b/, /\bcompr(?:o|amos|a y venta)\b/, /\bprecios?\b/,
      /\$\s?\d/, /\bofertas?\b/, /\bcobr(?:o|amos)\b/, /\bdelivery\b/, /\bstock\b/, /\bmayorista\w*/,
    ],
  },
];

const normalize = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Si el nombre o la descripción de un grupo no se permite, devuelve el tipo, el fragmento y el mensaje para mostrar. */
export function forbiddenGroupText(...texts: (string | null | undefined)[]) {
  for (const raw of texts) {
    if (!raw) continue;
    const t = normalize(raw);
    for (const rule of FORBIDDEN_GROUP) {
      for (const re of rule.patterns) {
        const m = re.exec(t) ?? re.exec(raw);
        if (m) return { kind: rule.kind, hit: m[0].trim(), message: rule.message };
      }
    }
  }
  return null;
}

/** Quien intentó crear o editar un grupo que sugiere menores: alerta urgente sobre esa persona (una sola mientras esté abierta). */
export async function reportMinorGroupAttempt(user: { id: string; name: string }, hit: string, text: string) {
  // No repite: si ya hay una alerta abierta por esto sobre la misma persona, no crea otra en cada intento
  const [dup] = await db.select({ id: report.id }).from(report)
    .where(and(
      sql`${report.reporterId} is null`,
      eq(report.targetUserId, user.id),
      eq(report.status, "open"),
      sql`${report.details} like ${AUTO_DETAILS_PREFIX + ": intentó crear o editar un grupo%"}`,
    ))
    .limit(1);
  if (dup) return;
  await db.insert(report).values({
    id: crypto.randomUUID(),
    reporterId: null,
    targetUserId: user.id,
    reason: "menor de edad",
    details: `${AUTO_DETAILS_PREFIX}: intentó crear o editar un grupo con «${hit}».`,
    targetName: user.name,
    messageBody: text,
  });
  await notifyModeratorsUrgent("menor de edad");
}

/**
 * Revisa los grupos que ya existen con las mismas reglas y manda a moderación los que no cumplen. Corre al arrancar.
 * No repite: si ya hay una alerta automática con el mismo texto para ese grupo (abierta o resuelta), no crea otra.
 */
export async function scanExistingGroups() {
  const rows = await db.select().from(schema.group)
    .where(and(sql`${schema.group.removedAt} is null`, eq(schema.group.isGeneral, false)));
  for (const g of rows) {
    const bad = forbiddenGroupText(g.name, g.description);
    if (!bad) continue;
    const text = [g.name, g.description].filter(Boolean).join("\n");
    const [dup] = await db.select({ id: report.id }).from(report)
      .where(and(eq(report.groupId, g.id), sql`${report.reporterId} is null`, eq(report.messageBody, text)))
      .limit(1);
    if (dup) continue;
    await db.insert(report).values({
      id: crypto.randomUUID(),
      reporterId: null,
      groupId: g.id,
      reason: bad.kind === "menores" ? "menor de edad" : "venta o drogas",
      details: `${AUTO_DETAILS_PREFIX}: «${bad.hit}» en un grupo creado antes de las reglas nuevas.`,
      targetName: g.name,
      messageBody: text,
    });
    if (bad.kind === "menores") await notifyModeratorsUrgent("menor de edad");
  }
}
