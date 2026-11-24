import type { Report } from "./types";

/**
 * Mensajes reportados con el mismo texto (por ejemplo, lo mismo mandado a varias personas) se muestran juntos.
 * ids: cada mensaje; reports: todos los reportes de esos mensajes.
 */
export type ReportedMessage = {
  key: string;
  kind: "group" | "dm";
  message: NonNullable<Report["message"]>;
  ids: string[];
  reports: Report[];
};

/** Todos los reportes sobre una misma persona o grupo. */
export type ReportGroup = {
  key: string;
  /** Del más nuevo al más viejo. El primero sirve de muestra para nombre, foto, estado, etc. */
  reports: Report[];
  first: Report;
  latest: string;
  oldest: string;
  urgent: boolean;
  automatic: boolean;
  /** Motivos con cuántas veces aparece cada uno, del más repetido al menos. */
  reasons: [string, number][];
  reporters: number;
  messages: ReportedMessage[];
  evidenceFiles: number;
  /** Para buscar: nombre, descripción, mensajes y comentarios, en minúsculas. */
  haystack: string;
};

export type ReportType = "todo" | "perfil" | "mensaje" | "grupo";
export type ReportSort = "recientes" | "reportados" | "antiguos";
export type ReportFilters = { q: string; reason: string; type: ReportType; urgentOnly: boolean; sort: ReportSort };
export const NO_FILTERS: ReportFilters = { q: "", reason: "", type: "todo", urgentOnly: false, sort: "recientes" };

const norm = (s: string) => s.toLocaleLowerCase("es").normalize("NFD").replace(/\p{Diacritic}/gu, "");

/** Junta los reportes por tema (persona o grupo). */
export function groupReports(reports: Report[]): ReportGroup[] {
  const byKey = new Map<string, Report[]>();
  for (const r of reports) {
    const list = byKey.get(r.subject);
    if (list) list.push(r);
    else byKey.set(r.subject, [r]);
  }
  return [...byKey.entries()].map(([key, list]) => {
    const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const reasonCount = new Map<string, number>();
    for (const r of sorted) reasonCount.set(r.reason, (reasonCount.get(r.reason) ?? 0) + 1);
    const messages = new Map<string, ReportedMessage>();
    for (const r of sorted) {
      if (!r.messageId || !r.message || !r.messageKind) continue;
      // Con texto: se junta por texto. Solo foto: cada mensaje aparte (no se puede saber si es la misma foto)
      const key = r.message.body ? `${r.messageKind}:${r.message.deleted}:${r.message.body}` : r.messageId;
      const m = messages.get(key);
      if (!m) messages.set(key, { key, kind: r.messageKind, message: r.message, ids: [r.messageId], reports: [r] });
      else {
        m.reports.push(r);
        if (!m.ids.includes(r.messageId)) m.ids.push(r.messageId);
      }
    }
    const first = sorted[0];
    const name = first.group?.name ?? first.target?.name ?? "";
    return {
      key,
      reports: sorted,
      first,
      latest: first.createdAt,
      oldest: sorted[sorted.length - 1].createdAt,
      urgent: sorted.some((r) => r.urgent),
      automatic: sorted.every((r) => r.automatic),
      reasons: [...reasonCount.entries()].sort((a, b) => b[1] - a[1]),
      reporters: Math.max(...sorted.map((r) => r.subjectReporters)),
      messages: [...messages.values()],
      evidenceFiles: sorted.reduce((n, r) => n + r.evidenceFiles, 0),
      haystack: norm([name, first.group?.description ?? "", ...sorted.flatMap((r) => [r.details ?? "", r.message?.body ?? ""])].join(" ")),
    };
  });
}

/** Filtra y ordena los temas. Un tema entra si alguno de sus reportes cumple el motivo elegido. */
export function filterGroups(groups: ReportGroup[], f: ReportFilters): ReportGroup[] {
  const q = norm(f.q.trim());
  const out = groups.filter((g) => {
    if (f.urgentOnly && !g.urgent) return false;
    if (f.reason && !g.reasons.some(([r]) => r === f.reason)) return false;
    if (f.type === "grupo" && !g.first.group) return false;
    if (f.type === "mensaje" && !g.messages.length) return false;
    if (f.type === "perfil" && (g.first.group || !g.reports.some((r) => !r.messageId))) return false;
    if (q && !g.haystack.includes(q)) return false;
    return true;
  });
  const by: Record<ReportSort, (a: ReportGroup, b: ReportGroup) => number> = {
    recientes: (a, b) => b.latest.localeCompare(a.latest),
    antiguos: (a, b) => a.oldest.localeCompare(b.oldest),
    reportados: (a, b) => b.reports.length - a.reports.length || b.latest.localeCompare(a.latest),
  };
  return out.sort(by[f.sort]);
}
