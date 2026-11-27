import { UserName } from "../../components/UserName";
import { useState } from "react";
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
  /** Identificador de la tarjeta: no deja saber de qué cuenta es. */
  id: string;
  /** Con nombre solo para la administración general, como en los reportes. */
  reporter: Author | null;
  signals: ReporterSignal[];
  targets: number;
  lastHour: number;
  since: string;
  /** Los que se descartan en bloque: abiertos, de la última hora y no urgentes. */
  dismissable: number;
  history: History;
};

/** Una cuenta cuyos reportes dejaron de contar. `id` tampoco deja saber de qué cuenta es. */
export type MutedReporter = { id: string; reporter: Author | null; mutedAt: string; reason: string | null; history: History };

/** Lo que devuelve GET /admin/report-spam. */
export type ReportSpamData = { alerts: ReportSpamAlert[]; muted: MutedReporter[] };

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
 * Quién reporta: cuentas que reportan de una forma para mirar, en su propia pestaña de Moderación. No esconde nada y
 * no decide nada: muestra los datos y deja actuar. A la persona no se le avisa de nada de esto. El equipo actúa con el
 * identificador de cada tarjeta, sin ver de qué cuenta es (salvo la administración general, que ve el nombre).
 */
export function ReportSpamAlerts({ data, act, onSuspend }: {
  data: ReportSpamData;
  /** Hace la acción y recarga el panel (y con eso, esta lista). */
  act: (fn: () => Promise<unknown>) => Promise<void>;
  onSuspend: (target: { url: string; name: string; reason: string }) => void;
}) {
  /** La tarjeta cuyo descarte en bloque se está confirmando. */
  const [confirming, setConfirming] = useState<string | null>(null);

  const { alerts, muted } = data;
  if (!alerts.length && !muted.length) {
    return <div className="empty"><p className="muted">Por ahora no hay cuentas que reporten de una forma para mirar.</p></div>;
  }
  const post = (path: string, json?: unknown) => act(() => api(path, { method: "POST", json })).then(() => setConfirming(null));

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
        const burst = a.signals.some((s) => s.kind === "burst");
        return (
          <article key={a.id} className="rcard spam-alert">
            <div className="rcard__head">
              <span className="pill pill--reason">Para revisar: cómo reporta</span>
            </div>
            <div className="rcard__who">
              {a.reporter && <Avatar src={a.reporter.photo} name={a.reporter.name} size={40} />}
              <span>
                <b><UserName name={name} /></b>
                <HistoryLine h={a.history} />
              </span>
            </div>
            <ul className="spam-alert__signals small">
              {a.signals.map((s) => <li key={s.kind}>{signalText(s)}</li>)}
            </ul>
            {burst && (
              <p className="muted small">
                Mientras tanto, sus reportes urgentes no te mandan avisos. Si eran reportes de verdad, ignorá la tarjeta y
                lo urgente vuelve a avisar.
              </p>
            )}
            {confirming === a.id ? (
              <div className="rcard__actions" role="group" aria-label="Confirmar descarte">
                <p className="small">
                  ¿Descartar {plural(a.dismissable, "reporte", "reportes")}? Son los de la última hora, sin los urgentes.
                  Se borran las pruebas guardadas y no se puede deshacer.
                </p>
                <button className="btn btn--small btn--danger" onClick={() => post(`/admin/report-spam/${a.id}/dismiss`)}>
                  Sí, descartar
                </button>
                <button className="btn btn--small btn--ghost" onClick={() => setConfirming(null)}>
                  Cancelar
                </button>
              </div>
            ) : (
              <div className="rcard__actions">
                <button className="btn btn--small" onClick={() => post(`/admin/report-spam/${a.id}/mute`, { reason: reasonFor(a).slice(0, 300) })}>
                  Que sus reportes no cuenten
                </button>
                {a.dismissable > 0 && (
                  <button className="btn btn--small" onClick={() => setConfirming(a.id)}>
                    Descartar {plural(a.dismissable, "reporte", "reportes")} de la última hora
                  </button>
                )}
                <button
                  className="btn btn--small btn--danger"
                  onClick={() => onSuspend({ url: `/admin/report-spam/${a.id}/suspend`, name: a.reporter?.name ?? "esta cuenta", reason: reasonFor(a).slice(0, 300) })}
                >
                  Suspender
                </button>
                <button className="btn btn--small btn--ghost" onClick={() => post(`/admin/report-spam/${a.id}/ignore`)}>
                  Ignorar
                </button>
              </div>
            )}
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
              <li key={m.id} className="spam-muted__item">
                <span className="rcard__who">
                  {m.reporter && <Avatar src={m.reporter.photo} name={m.reporter.name} size={32} />}
                  <span>
                    <b><UserName name={m.reporter?.name ?? "Una cuenta"} /></b> <span className="muted small">desde el {fmt(m.mutedAt)}</span>
                    <HistoryLine h={m.history} />
                  </span>
                </span>
                {m.reason && <span className="small rcard__note">{m.reason}</span>}
                <span className="rcard__actions">
                  <button className="btn btn--small btn--ghost" onClick={() => post(`/admin/report-spam/${m.id}/unmute`)}>
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
