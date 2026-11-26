import { REPORT_RESPONSE_EVENT } from "@mortero/shared/realtime";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { api, getSocket } from "../api";
import { BackIcon } from "../components/Icons";

type ReportSummary = {
  id: string;
  reason: string;
  targetName: string | null;
  createdAt: string;
  respondedAt: string | null;
  open: boolean;
};

type ReportThread = ReportSummary & { details: string | null; response: string | null; hasCapture: boolean };

const date = (value: string) => new Date(value).toLocaleDateString("es-AR", { dateStyle: "medium" });
const dateTime = (value: string) => new Date(value).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
const status = (report: ReportSummary) => report.open ? "En revisión" : "Cerrado";

function useReportData<T>(path: string, id?: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let controller: AbortController;
    function load() {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      void api<T>(path, { signal: current.signal }).then((result) => {
        if (current.signal.aborted) return;
        setData(result);
        setError("");
      }).catch((err: Error) => {
        if (!current.signal.aborted) setError(err.message);
      });
    }
    function onResponse({ reportId }: { reportId: string }) {
      if (!id || reportId === id) load();
    }
    load();
    const socket = getSocket();
    socket.on(REPORT_RESPONSE_EVENT, onResponse);
    window.addEventListener("focus", load);
    return () => {
      controller.abort();
      socket.off(REPORT_RESPONSE_EVENT, onResponse);
      window.removeEventListener("focus", load);
    };
  }, [path, id]);

  return { data, error };
}

export function MyReports() {
  const { data: reports, error } = useReportData<ReportSummary[]>("/me/reportes");

  return (
    <div className="page">
      <header className="topbar topbar--thread">
        <Link to="/yo/configuracion" className="iconbtn" aria-label="Volver a Configuración"><BackIcon /></Link>
        <h1 className="topbar__title topbar__title--sm">Mis reportes</h1>
      </header>
      {error ? <p className="notice notice--error" role="alert">No pudimos cargar tus reportes.</p>
        : !reports ? <p className="empty muted" role="status">Cargando…</p>
        : reports.length === 0 ? <p className="empty muted">Todavía no enviaste reportes.</p>
        : (
          <ul className="inbox reports-inbox">
            {reports.map((report) => (
              <li key={report.id}>
                <Link to={`/yo/reportes/${encodeURIComponent(report.id)}`} className="inbox__item">
                  <div className="inbox__text">
                    <div className="inbox__top">
                      <strong>{report.targetName == null ? report.reason : <bdi>{report.targetName}</bdi>}</strong>
                      <time dateTime={report.respondedAt ?? report.createdAt}>{date(report.respondedAt ?? report.createdAt)}</time>
                    </div>
                    <p className="inbox__preview">
                      {report.targetName && `${report.reason} · `}{report.respondedAt ? "Respuesta de Moderación" : status(report)}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

export function MyReport() {
  const { id = "" } = useParams();
  return <ReportConversation key={id} id={id} />;
}

function ReportConversation({ id }: { id: string }) {
  const { data: report, error } = useReportData<ReportThread>(`/me/reportes/${encodeURIComponent(id)}`, id);

  return (
    <div className="page">
      <header className="topbar topbar--thread">
        <Link to="/yo/reportes" className="iconbtn" aria-label="Volver a Mis reportes"><BackIcon /></Link>
        <h1 className="topbar__title topbar__title--sm">{report?.targetName == null ? "Reporte" : <bdi>{report.targetName}</bdi>}</h1>
      </header>
      {error ? <p className="notice notice--error" role="alert">{error}</p>
        : !report ? <p className="empty muted" role="status">Cargando…</p>
        : (
          <div className="chat__list--dm" role="log" aria-label="Conversación del reporte">
            <div className="bubble bubble--mine">
              <strong>Tu reporte</strong>
              <p>Motivo: {report.reason}</p>
              {report.details && <p>{report.details}</p>}
              {report.hasCapture && <p>Adjuntaste una captura.</p>}
              <time dateTime={report.createdAt}>{dateTime(report.createdAt)}</time>
            </div>
            {report.response && report.respondedAt ? (
              <div className="bubble">
                <strong>Moderación</strong>
                <p>{report.response}</p>
                <time dateTime={report.respondedAt}>{dateTime(report.respondedAt)}</time>
              </div>
            ) : <p className="seen">{status(report)} · Sin respuesta de Moderación</p>}
          </div>
        )}
    </div>
  );
}
