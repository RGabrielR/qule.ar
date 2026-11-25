import { useEffect, useState } from "react";
import { api, type Author } from "../../api";
import { Avatar } from "../../components/Avatar";

/** Por qué una cuenta aparece acá (ver apps/api/src/reportSpam.ts). */
export type ReporterSignal =
  | { kind: "burst"; targets: number; lastHour: number }
  | { kind: "dismissed"; dismissed: number; resolved: number }
  | { kind: "noAction"; total: number }
  | { kind: "pileOn"; reporters: number; newAccounts: number; closeSignups: number };

type History = { total: number; open: number; dismissed: number; actioned: number };

/** Una cuenta que reporta de una forma que vale la pena mirar. */
export type ReportSpamAlert = {
  reporterId: string;
  /** Con nombre solo para la administración general, como en los reportes. */
  reporter: Author | null;
  signals: ReporterSignal[];
  targets: number;
  lastHour: number;
  since: string;
  history: History;
};

/** Una cuenta cuyos reportes dejaron de contar. */
export type MutedReporter = { reporterId: string; reporter: Author | null; mutedAt: string; reason: string | null; history: History };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const fmt = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short" });

function signalText(s: ReporterSignal): string {
  switch (s.kind) {
    case "burst":
      return `Reportó a ${plural(s.targets, "persona o grupo", "personas o grupos")} distintos en la última hora (${plural(s.lastHour, "reporte", "reportes")}).`;
    case "dismissed":
      return `De sus ${plural(s.resolved, "reporte revisado", "reportes revisados")}, se ${s.dismissed === 1 ? "descartó" : "descartaron"} ${s.dismissed}.`;
    case "noAction":
      return `Mandó ${plural(s.total, "reporte", "reportes")} en 90 días y ninguno terminó en una medida.`;
    case "pileOn": {
      const many = (n: number) => (n === s.reporters ? `las ${n}` : `${n}`);
      const parts = [
        s.newAccounts >= 2 && `${many(s.newAccounts)} son nuevas`,
        s.closeSignups >= 2 && `${many(s.closeSignups)} se crearon casi a la misma hora`,
      ].filter(Boolean);
      const others = s.reporters === 2 ? "otra cuenta" : `otras ${s.reporters - 1} cuentas`;
      return `Junto con ${others}, reportó a la misma persona o grupo en un día. De esas ${s.reporters} cuentas, ${parts.join(" y ")}.`;
    }
  }
}

/** El motivo que se propone al suspender o al hacer que los reportes no cuenten. Se puede editar. */
const reasonFor = (a: ReportSpamAlert) => `Reportes de mala fe: ${a.signals.map(signalText).join(" ")}`;

function HistoryLine({ h }: { h: History }) {
  return (
    <span className="muted small rcard__count">
      En 90 días: {plural(h.total, "reporte", "reportes")} · {h.dismissed} {h.dismissed === 1 ? "descartado" : "descartados"} ·{" "}
      {h.actioned} con una medida · {h.open} sin revisar
    </span>
  );
}

/**
 * Quién reporta: cuentas que reportan de una forma para mirar, arriba de los reportes abiertos. No esconde nada y
 * no decide nada: muestra los datos y deja actuar. A la persona no se le avisa de nada de esto.
 */
export function ReportSpamAlerts({ act, onSuspend, refresh }: {
  act: (fn: () => Promise<unknown>) => Promise<void>;
  onSuspend: (target: { id: string; name: string; reason: string }) => void;
  /** Cambia cuando el panel se recarga (por ejemplo, después de suspender). */
  refresh: unknown;
}) {
  const [data, setData] = useState<{ alerts: ReportSpamAlert[]; muted: MutedReporter[] }>({ alerts: [], muted: [] });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    api<{ alerts: ReportSpamAlert[]; muted: MutedReporter[] }>("/admin/report-spam").then(setData, () => setData({ alerts: [], muted: [] }));
  }, [refresh, reload]);

  const { alerts, muted } = data;
  if (!alerts.length && !muted.length) return null;
  const done = () => setReload((n) => n + 1);
  const post = (path: string, json?: unknown) => act(() => api(path, { method: "POST", json })).then(done);

  return (
    <section className="reports spam-alerts" aria-label="Quién reporta">
      {alerts.length > 0 && (
        <p className="muted small">
          Cuentas que reportan de una forma para mirar. Puede ser alguien que encontró varios problemas de verdad: revisá
          sus reportes antes de decidir. Si sus reportes dejan de contar, siguen entrando, pero no ocultan perfiles, no
          mandan avisos y no alcanzan para una suspensión preventiva. A la persona no se le avisa.
        </p>
      )}
      {alerts.map((a) => {
        const name = a.reporter?.name ?? "Una cuenta";
        return (
          <article key={a.reporterId} className="rcard spam-alert">
            <div className="rcard__head">
              <span className="pill pill--reason">Para revisar: cómo reporta</span>
            </div>
            <div className="rcard__who">
              {a.reporter && <Avatar src={a.reporter.photo} name={a.reporter.name} size={40} />}
              <span>
                <b>{name}</b>
                <HistoryLine h={a.history} />
              </span>
            </div>
            <ul className="spam-alert__signals small">
              {a.signals.map((s) => <li key={s.kind}>{signalText(s)}</li>)}
            </ul>
            <div className="rcard__actions">
              <button className="btn btn--small" onClick={() => post(`/admin/report-spam/${a.reporterId}/mute`, { reason: reasonFor(a).slice(0, 300) })}>
                Que sus reportes no cuenten
              </button>
              {a.history.open > 0 && (
                <button className="btn btn--small" onClick={() => post(`/admin/report-spam/${a.reporterId}/dismiss`)}>
                  {a.history.open === 1 ? "Descartar su reporte abierto" : `Descartar sus ${a.history.open} reportes abiertos`}
                </button>
              )}
              <button className="btn btn--small btn--danger" onClick={() => onSuspend({ id: a.reporterId, name: a.reporter?.name ?? "esta cuenta", reason: reasonFor(a).slice(0, 300) })}>
                Suspender
              </button>
              <button className="btn btn--small btn--ghost" onClick={() => post(`/admin/report-spam/${a.reporterId}/ignore`)}>
                Ignorar
              </button>
            </div>
          </article>
        );
      })}
      {muted.length > 0 && (
        <details className="rcard rcard__notes spam-muted">
          <summary className="small">
            <b>{plural(muted.length, "cuenta cuyos reportes no cuentan", "cuentas cuyos reportes no cuentan")}</b>
          </summary>
          <ul>
            {muted.map((m) => (
              <li key={m.reporterId} className="spam-muted__item">
                <span className="rcard__who">
                  {m.reporter && <Avatar src={m.reporter.photo} name={m.reporter.name} size={32} />}
                  <span>
                    <b>{m.reporter?.name ?? "Una cuenta"}</b> <span className="muted small">desde el {fmt(m.mutedAt)}</span>
                    <HistoryLine h={m.history} />
                  </span>
                </span>
                {m.reason && <span className="small rcard__note">{m.reason}</span>}
                <span className="rcard__actions">
                  <button className="btn btn--small btn--ghost" onClick={() => post(`/admin/report-spam/${m.reporterId}/unmute`)}>
                    Que vuelvan a contar
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
