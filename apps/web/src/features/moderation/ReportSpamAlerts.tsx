import { useEffect, useState } from "react";
import { api, type Author } from "../../api";
import { Avatar } from "../../components/Avatar";

/** Una cuenta que reportó a muchas personas en poco tiempo (ver apps/api/src/reportSpam.ts y la discusión #219). */
export type ReportSpamAlert = {
  reporterId: string;
  /** Con nombre solo para la administración general, como en los reportes. */
  reporter: Author | null;
  targets: number;
  lastHour: number;
  since: string;
  history: { total: number; open: number; dismissed: number; actioned: number };
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Alertas de spam de reportes, arriba de los reportes abiertos. Los reportes de esa cuenta siguen en la lista:
 * la alerta no esconde nada, solo avisa y deja actuar sobre quien reporta.
 */
export function ReportSpamAlerts({ act, onSuspend, refresh }: {
  act: (fn: () => Promise<unknown>) => Promise<void>;
  onSuspend: (target: { id: string; name: string; reason: string }) => void;
  /** Cambia cuando el panel se recarga (por ejemplo, después de suspender). */
  refresh: unknown;
}) {
  const [alerts, setAlerts] = useState<ReportSpamAlert[]>([]);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    api<ReportSpamAlert[]>("/admin/report-spam").then(setAlerts, () => setAlerts([]));
  }, [refresh, reload]);

  if (!alerts.length) return null;
  const done = () => setReload((n) => n + 1);

  return (
    <section className="reports spam-alerts" aria-label="Alertas de spam de reportes">
      {alerts.map((a) => {
        const name = a.reporter?.name ?? "Una cuenta";
        const reason = `Spam de reportes: reportó a ${plural(a.targets, "persona", "personas")} en una hora, casi siempre sin fundamento. Satura el canal y tapa los reportes reales.`;
        return (
          <article key={a.reporterId} className="rcard rcard--urgent spam-alert">
            <div className="rcard__head">
              <span className="pill pill--reason">Posible spam de reportes</span>
            </div>
            <div className="rcard__who">
              {a.reporter && <Avatar src={a.reporter.photo} name={a.reporter.name} size={40} />}
              <span>
                <b>{name}</b> reportó a <b>{plural(a.targets, "persona", "personas")}</b> en la última hora
                <span className="muted small rcard__count">
                  {plural(a.lastHour, "reporte", "reportes")} en la última hora. En total: {a.history.total}, con{" "}
                  {plural(a.history.dismissed, "descartado", "descartados")}, {plural(a.history.actioned, "válido", "válidos")} y{" "}
                  {plural(a.history.open, "sin revisar", "sin revisar")}.
                </span>
              </span>
            </div>
            <p className="muted small">
              Sus reportes siguen en la lista de abajo, pero ya no te mandan avisos urgentes. Si eran reportes de verdad
              (por ejemplo, encontró varios perfiles falsos), ignorá la alerta.
            </p>
            <div className="rcard__actions">
              <button className="btn btn--small btn--danger" onClick={() => onSuspend({ id: a.reporterId, name: a.reporter?.name ?? "esta cuenta", reason })}>
                Suspender a quien reporta
              </button>
              {a.history.open > 0 && (
                <button className="btn btn--small" onClick={() => act(() => api(`/admin/report-spam/${a.reporterId}/dismiss`, { method: "POST" })).then(done)}>
                  Descartar sus {plural(a.history.open, "reporte abierto", "reportes abiertos")}
                </button>
              )}
              <button className="btn btn--small btn--ghost" onClick={() => act(() => api(`/admin/report-spam/${a.reporterId}/ignore`, { method: "POST" })).then(done)}>
                Ignorar
              </button>
            </div>
          </article>
        );
      })}
    </section>
  );
}
