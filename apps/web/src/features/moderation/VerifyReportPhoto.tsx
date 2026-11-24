import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, upload } from "../../api";
import { DialogFocus } from "../../components/DialogFocus";
import type { Report } from "./types";

type Reference = { id: string; position: number; album: string; name: string; attached: boolean };
type Variant = "photo" | "thumb";
type Crop = { left: number; top: number; width: number; height: number };
type Result = { status: "match" | "no_match" | "insufficient"; uploader: string; recipient: { id: string; name: string } | null };

const formatReport = (report: Report) =>
  `${report.reason} · ${new Date(report.createdAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}`;

export function VerifyReportPhoto({ reports, onClose }: { reports: Report[]; onClose: () => void }) {
  const [reportId, setReportId] = useState(reports[0].id);
  const currentReport = reports.find((report) => report.id === reportId) ?? reports[0];

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet sheet--list verify-photo" role="dialog" aria-modal="true" aria-labelledby="verify-photo-title" onClick={(e) => e.stopPropagation()}>
        <DialogFocus onClose={onClose} />
        <h2 id="verify-photo-title">Verificar foto</h2>
        {reports.length > 1 && (
          <label className="field">
            <span>Reporte</span>
            <select className="input" value={currentReport.id} onChange={(e) => setReportId(e.target.value)}>
              {reports.map((report) => <option key={report.id} value={report.id}>{formatReport(report)}</option>)}
            </select>
          </label>
        )}
        <VerificationForm key={currentReport.id} report={currentReport} onClose={onClose} />
      </div>
    </div>
  );
}

function VerificationForm({ report, onClose }: { report: Report; onClose: () => void }) {
  const path = `/admin/reports/${encodeURIComponent(report.id)}/photo-verification`;
  const [photos, setPhotos] = useState<Reference[] | null>(null);
  const [photoId, setPhotoId] = useState("");
  const [variant, setVariant] = useState<Variant>("photo");
  const [viewerId, setViewerId] = useState(report.target?.id ?? "");
  const [hasCapture, setHasCapture] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [captureUrl, setCaptureUrl] = useState("");
  const [originalCrop, setOriginalCrop] = useState<Crop>();
  const [captureCrop, setCaptureCrop] = useState<Crop>();
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api<{ photos: Reference[]; hasCapture: boolean }>(path, { signal: controller.signal })
      .then(({ photos, hasCapture }) => {
        if (controller.signal.aborted) return;
        setPhotos(photos);
        setHasCapture(hasCapture);
        setPhotoId(photos.find((photo) => photo.attached)?.id ?? "");
      })
      .catch((e: Error) => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path]);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setCaptureUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const chosen = photos?.find((photo) => photo.id === photoId);
  const originalUrl = chosen ? `/api${path}/${encodeURIComponent(chosen.id)}/${variant}` : "";

  const comparisonUrl = hasCapture ? `/api${path}/capture` : captureUrl;
  const canVerify = chosen && (hasCapture || file) && viewerId.trim() && !busy;

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!canVerify) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const fields = { photoId: chosen.id, viewerId, variant, originalCrop, captureCrop };
      setResult(file
        ? await upload<Result>(path, file, { fields: JSON.stringify(fields) })
        : await api<Result>(path, { method: "POST", json: fields }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="verify-photo__form" onSubmit={verify}>
      {loading && <p className="muted small" role="status">Buscando fotos del reporte…</p>}
      {photos?.length === 0 && (
        <>
          <p className="muted small">No hay una foto original disponible en los álbumes de este reporte.</p>
          {hasCapture && <div className="verify-photo__comparison">
            <VerificationImage title="Captura recibida" url={comparisonUrl} disabled onCrop={setCaptureCrop} />
          </div>}
        </>
      )}
      {!!photos?.length && (
        <>
          <div className={hasCapture ? undefined : "verify-photo__fields"}>
            <label className="field">
              <span>Foto original</span>
              <select className="input" value={photoId} disabled={busy} onChange={(e) => {
                setPhotoId(e.target.value); setOriginalCrop(undefined); setResult(null);
              }}>
                <option value="">Elegí una foto</option>
                {photos.map((photo) => (
                  <option key={photo.id} value={photo.id}>{photo.name} · {photo.album} · Foto {photo.position + 1}</option>
                ))}
              </select>
            </label>
            {!hasCapture && <label className="field">
              <span>Captura recibida</span>
              <input className="input" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => {
                setFile(e.target.files?.[0] ?? null); setCaptureUrl(""); setCaptureCrop(undefined); setResult(null);
              }} />
            </label>}
          </div>

          <div className="verify-photo__comparison">
            <VerificationImage key={originalUrl} title="Foto original" url={originalUrl} crop={originalCrop} disabled={busy}
              onCrop={(crop) => { setOriginalCrop(crop); setResult(null); }} />
            <VerificationImage key={comparisonUrl} title="Captura recibida" url={comparisonUrl} crop={captureCrop} disabled={busy}
              onCrop={(crop) => { setCaptureCrop(crop); setResult(null); }} />
          </div>

          <div className="verify-photo__fields">
            <label className="field">
              <span>Versión de la foto</span>
              <select className="input" value={variant} disabled={busy} onChange={(e) => {
                setVariant(e.target.value === "thumb" ? "thumb" : "photo"); setOriginalCrop(undefined); setResult(null);
              }}>
                <option value="photo">Foto abierta</option>
                <option value="thumb">Miniatura del álbum</option>
              </select>
            </label>
            <label className="field">
              <span>ID de la cuenta a verificar</span>
              <input className="input" value={viewerId} maxLength={200} disabled={busy} onChange={(e) => {
                setViewerId(e.target.value); setResult(null);
              }} />
            </label>
          </div>
        </>
      )}

      {chosen && (
        <dl className="verify-photo__result" aria-live="polite">
          <div><dt>Foto subida por</dt><dd>{result?.uploader ?? chosen.name}</dd></div>
          {result?.recipient && <div><dt>Copia entregada a</dt><dd>{result.recipient.name}</dd></div>}
        </dl>
      )}
      {result && (
        <p className="muted small" role="status">
          {result.status === "match" && result.recipient && `La marca coincide con la copia entregada a ${result.recipient.name}.`}
          {result.status === "no_match" && "Sin coincidencia para esta cuenta."}
          {result.status === "insufficient" && "Imagen insuficiente para verificar la marca."}
        </p>
      )}
      {error && <p className="notice notice--error" role="alert">{error}</p>}
      <div className="rcard__actions">
        <button type="button" className="btn" onClick={onClose}>Volver al reporte</button>
        {!!photos?.length && <button className="btn btn--primary" disabled={!canVerify}>
          {busy ? "Verificando…" : "Verificar"}
        </button>}
      </div>
    </form>
  );
}

function VerificationImage({ title, url, crop, disabled, onCrop }: {
  title: string; url: string; crop?: Crop; disabled: boolean; onCrop: (crop?: Crop) => void;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>();
  const [failed, setFailed] = useState(false);

  function point(image: HTMLImageElement, clientX: number, clientY: number) {
    const rect = image.getBoundingClientRect();
    return {
      x: Math.round(image.naturalWidth * Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))),
      y: Math.round(image.naturalHeight * Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))),
    };
  }

  return (
    <figure>
      <figcaption>{title}</figcaption>
      {url && !failed ? (
        <div className="verify-photo__image">
          <img alt={title} src={url} draggable={false} onError={() => setFailed(true)}
            onLoad={(e) => setSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
            onPointerDown={(e) => {
              if (disabled || !size || e.button !== 0) return;
              start.current = point(e.currentTarget, e.clientX, e.clientY);
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerCancel={() => { start.current = null; }}
            onPointerUp={(e) => {
              const from = start.current;
              start.current = null;
              if (disabled || !from) return;
              const to = point(e.currentTarget, e.clientX, e.clientY);
              const width = Math.abs(to.x - from.x);
              const height = Math.abs(to.y - from.y);
              if (width >= 8 && height >= 8) onCrop({ left: Math.min(from.x, to.x), top: Math.min(from.y, to.y), width, height });
            }}
          />
          {crop && size && (
            <span className="verify-photo__selection" aria-hidden="true" style={{
              left: `${100 * crop.left / size.width}%`, top: `${100 * crop.top / size.height}%`,
              width: `${100 * crop.width / size.width}%`, height: `${100 * crop.height / size.height}%`,
            }} />
          )}
        </div>
      ) : <p className="muted small">{failed ? "No pudimos abrir la imagen." : "Todavía no elegiste una imagen."}</p>}
      {size && !failed && (
        <details>
          <summary className="muted small">Ajustar recorte</summary>
          <p className="muted small">Arrastrá sobre la imagen o indicá el área en píxeles.</p>
          <div className="verify-photo__fields">
            {([["left", "Izquierda"], ["top", "Arriba"], ["width", "Ancho"], ["height", "Alto"]] as const).map(([key, label]) => {
              const full: Crop = { left: 0, top: 0, width: size.width, height: size.height };
              return (
                <label className="field" key={key}>
                  <span>{label}</span>
                  <input className="input" type="number" min={key === "left" || key === "top" ? 0 : 1}
                    max={key === "left" || key === "width" ? size.width : size.height} disabled={disabled}
                    value={(crop ?? full)[key]} onChange={(e) => onCrop({ ...full, ...crop, [key]: Number(e.target.value) })} />
                </label>
              );
            })}
          </div>
          {crop && <button className="linkbtn small" type="button" disabled={disabled} onClick={() => onCrop()}>Sacar recorte</button>}
        </details>
      )}
    </figure>
  );
}
