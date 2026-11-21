import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, getSocket, ROLE_LABEL, type GroupInfo as Info, type JoinRequest, type Member, type SentInvite, type SpamRules } from "../api";
import { useMe } from "../App";
import { Avatar } from "../components/Avatar";
import { BackIcon, PlusIcon } from "../components/Icons";
import { InvitePeopleSheet } from "../components/Invite";
import { ReportDialog } from "../components/ReportDialog";

export function GroupInfo() {
  const { id = "" } = useParams();
  const { me } = useMe();
  const nav = useNavigate();
  const [info, setInfo] = useState<Info | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [invites, setInvites] = useState<SentInvite[]>([]);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState("");
  const [memberMenu, setMemberMenu] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "leave" | "delete">(null);
  const [reporting, setReporting] = useState(false);

  const isMod = info?.role === "owner" || info?.role === "moderator";
  const isOwner = info?.role === "owner";

  const load = useCallback(async () => {
    try {
      const g = await api<Info>(`/groups/${id}`);
      setInfo(g);
      if (!g.role) return nav(`/grupos/${id}`, { replace: true });
      setMembers(await api<Member[]>(`/groups/${id}/members`));
      if ((g.role === "owner" || g.role === "moderator") && !g.isGeneral) {
        const [reqs, invs] = await Promise.all([
          api<JoinRequest[]>(`/groups/${id}/requests`),
          api<SentInvite[]>(`/groups/${id}/invites`),
        ]);
        setRequests(reqs);
        setInvites(invs);
      } else {
        setRequests([]);
        setInvites([]);
      }
    } catch {
      nav("/grupos", { replace: true });
    }
  }, [id, nav]);

  useEffect(() => {
    load();
    const s = getSocket();
    const onAny = (p: { groupId: string }) => p.groupId === id && load();
    const gone = (p: { groupId: string }) => p.groupId === id && nav("/grupos", { replace: true });
    s.on("group:request", onAny);
    s.on("group:role", onAny);
    s.on("group:removed", gone);
    s.on("group:gone", gone);
    return () => {
      s.off("group:request", onAny);
      s.off("group:role", onAny);
      s.off("group:removed", gone);
      s.off("group:gone", gone);
    };
  }, [id, load, nav]);

  async function act(fn: () => Promise<unknown>) {
    setError("");
    setMemberMenu(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!info) return <div className="page" />;

  return (
    <div className="page">
      <header className="topbar topbar--thread">
        <button className="iconbtn" onClick={() => nav(`/grupos/${id}`)} aria-label="Volver al chat"><BackIcon /></button>
        <h1 className="topbar__title topbar__title--sm">{info.isGeneral ? "# " : ""}{info.name}</h1>
      </header>

      <section className="section">
        {info.description && <p className="profile__about">{info.description}</p>}
        <p className="muted small hint">
          {info.memberCount} {info.memberCount === 1 ? "miembro" : "miembros"} · Tu rol: {ROLE_LABEL[info.role!]}
        </p>
      </section>

      <section className="section">
        <div className="setting">
          <div>
            <h2 className="section__title section__title--tight">Avisos de este grupo</h2>
            <p className="muted small">
              {info.muted
                ? "Silenciado: solo te avisamos si alguien te responde."
                : "Te avisamos cuando hay mensajes nuevos (como mucho cada 10 minutos) y cuando te responden."}
            </p>
          </div>
          <button
            className={`switch ${!info.muted ? "switch--on" : ""}`}
            role="switch"
            aria-checked={!info.muted}
            aria-label="Avisos de este grupo"
            onClick={async () => {
              const muted = !info.muted;
              setInfo({ ...info, muted });
              await api(`/groups/${id}/notifications`, { method: "PUT", json: { muted } }).catch(() => setInfo({ ...info }));
            }}
          >
            <span />
          </button>
        </div>
      </section>

      {error && <div className="notice notice--error" role="alert">{error}</div>}

      {isMod && !info.isGeneral && (
        <section className="section">
          <h2 className="section__title">Solicitudes <span className="muted">{requests.length}</span></h2>
          {requests.length === 0 ? (
            <p className="muted">No hay solicitudes pendientes.</p>
          ) : (
            <ul className="reqs">
              {requests.map((r) => (
                <li key={r.id} className="req">
                  <Link to={`/perfil/${r.user.id}`} className="req__who">
                    <Avatar src={r.user.photo} name={r.user.name} size={44} />
                    <span><b>{r.user.name}</b> <span className="muted">{r.user.age}</span></span>
                  </Link>
                  {r.message && <p className="req__msg">“{r.message}”</p>}
                  <div className="row">
                    <button className="btn btn--small" onClick={() => act(() => api(`/groups/${id}/requests/${r.id}/reject`, { method: "POST" }))}>Rechazar</button>
                    <button className="btn btn--small btn--primary" onClick={() => act(() => api(`/groups/${id}/requests/${r.id}/accept`, { method: "POST" }))}>Aceptar</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small hint">Si rechazás a alguien, puede volver a pedir ingreso en 7 días.</p>
        </section>
      )}

      {isMod && !info.isGeneral && (
        <section className="section">
          <h2 className="section__title">Invitaciones <span className="muted">{invites.length}</span></h2>
          <button className="btn btn--primary" onClick={() => setInviting(true)}><PlusIcon /> Invitar gente</button>
          {invites.length > 0 && (
            <ul className="members invite-sent">
              {invites.map((inv) => (
                <li key={inv.id} className="member">
                  <Link to={`/perfil/${inv.user.id}`} className="member__who">
                    <Avatar src={inv.user.photo} name={inv.user.name} size={40} />
                    <span><b>{inv.user.name}</b> <span className="muted small">· sin responder</span></span>
                  </Link>
                  <button className="linkbtn small" onClick={() => act(() => api(`/groups/${id}/invites/${inv.id}`, { method: "DELETE" }))}>Cancelar</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {inviting && <InvitePeopleSheet groupId={id} groupName={info.name} onClose={() => setInviting(false)} onChange={load} />}

      {!info.isGeneral && (
        <section className="section">
          <h2 className="section__title">Miembros <span className="muted">{members.length}</span></h2>
          <ul className="members">
            {members.map((m) => {
              const isMe = m.id === me?.user.id;
              const canKick = !isMe && (isOwner || (info.role === "moderator" && m.role === "member"));
              const canPromote = isOwner && !isMe;
              return (
                <li key={m.id} className="member">
                  <Link to={`/perfil/${m.id}`} className="member__who">
                    <Avatar src={m.photo} name={m.name} size={40} />
                    <span>
                      <b>{m.name}</b>{isMe && <span className="muted"> (vos)</span>}
                      {m.role !== "member" && <span className="pill pill--role">{ROLE_LABEL[m.role]}</span>}
                    </span>
                  </Link>
                  {(canKick || canPromote) && m.role !== "owner" && (
                    <div className="member__actions">
                      <button className="linkbtn small" onClick={() => setMemberMenu(memberMenu === m.id ? null : m.id)} aria-expanded={memberMenu === m.id}>Opciones</button>
                      {memberMenu === m.id && (
                        <div className="menu" role="menu">
                          {canPromote && m.role === "member" && (
                            <button role="menuitem" onClick={() => act(() => api(`/groups/${id}/members/${m.id}`, { method: "PATCH", json: { role: "moderator" } }))}>Hacer moderador</button>
                          )}
                          {canPromote && m.role === "moderator" && (
                            <button role="menuitem" onClick={() => act(() => api(`/groups/${id}/members/${m.id}`, { method: "PATCH", json: { role: "member" } }))}>Quitar moderador</button>
                          )}
                          {canKick && (
                            <button role="menuitem" className="danger" onClick={() => act(() => api(`/groups/${id}/members/${m.id}`, { method: "DELETE" }))}>Expulsar del grupo</button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {isOwner && !info.isGeneral && <GroupSettings info={info} onSaved={load} />}

      {!info.isGeneral && (
        <section className="section">
          <div className="stack">
            {confirm === "leave" ? (
              <div className="confirm">
                <p>¿Salir de {info.name}? Para volver vas a tener que pedir ingreso de nuevo.{isOwner && " Como sos el dueño, el grupo pasa a un moderador o al miembro más antiguo. Si no queda nadie, se cierra."}</p>
                <div className="row">
                  <button className="btn" onClick={() => setConfirm(null)}>Cancelar</button>
                  <button className="btn btn--danger" onClick={() => act(async () => { await api(`/groups/${id}/leave`, { method: "POST" }); nav("/grupos"); })}>Salir</button>
                </div>
              </div>
            ) : confirm === "delete" ? (
              <div className="confirm confirm--danger">
                <p>¿Borrar {info.name} para todos? Se pierden todos los mensajes. <b>No se puede deshacer.</b></p>
                <div className="row">
                  <button className="btn" onClick={() => setConfirm(null)}>Cancelar</button>
                  <button className="btn btn--danger" onClick={() => act(async () => { await api(`/groups/${id}`, { method: "DELETE" }); nav("/grupos"); })}>Borrar grupo</button>
                </div>
              </div>
            ) : (
              <>
                <button className="btn" onClick={() => setConfirm("leave")}>Salir del grupo</button>
                {isOwner && <button className="btn btn--ghost btn--dangertext" onClick={() => setConfirm("delete")}>Borrar grupo</button>}
                {!isOwner && (
                  <button className="btn btn--ghost btn--dangertext" onClick={() => setReporting(true)}>Reportar este grupo</button>
                )}
              </>
            )}
          </div>
        </section>
      )}

      {reporting && <ReportDialog groupId={id} name={info.name} onClose={() => setReporting(false)} />}

      {info.isGeneral && (
        <section className="section">
          <p className="muted">Este es el chat de toda la app: todo el mundo está acá y no se puede salir. Si alguien molesta, bloquealo o reportalo desde su perfil.</p>
        </section>
      )}
    </div>
  );
}

function GroupSettings({ info, onSaved }: { info: Info; onSaved: () => void }) {
  const [name, setName] = useState(info.name);
  const [description, setDescription] = useState(info.description ?? "");
  const [rules, setRules] = useState<SpamRules>(info.rules);
  const [state, setState] = useState<"idle" | "saving" | "ok">("idle");
  const [error, setError] = useState("");

  const setRule = (k: keyof SpamRules, v: string) => {
    setRules({ ...rules, [k]: Number(v) });
    setState("idle");
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    setError("");
    try {
      await api(`/groups/${info.id}`, { method: "PATCH", json: { name, description: description || null, rules } });
      setState("ok");
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setState("idle");
    }
  }

  return (
    <form className="section form" onSubmit={save}>
      <h2 className="section__title">Ajustes del grupo</h2>
      <label className="field">
        <span>Nombre</span>
        <input className="input" required minLength={3} maxLength={40} value={name} onChange={(e) => { setName(e.target.value); setState("idle"); }} />
      </label>
      <label className="field">
        <span>Descripción</span>
        <textarea className="input" rows={3} maxLength={300} value={description} onChange={(e) => { setDescription(e.target.value); setState("idle"); }} />
      </label>

      <h3 className="subhead">Antispam</h3>
      <p className="muted small">
        Cada persona puede mandar <b>{rules.burst}</b> {rules.burst === 1 ? "mensaje" : "mensajes"} cada <b>{fmtSecs(rules.burst * rules.intervalSeconds)}</b>.
        Lo que mande de más queda en cola. Si tiene {rules.rotationMax} o más de los últimos {rules.rotationWindow} mensajes, espera el doble.
      </p>
      <div className="grid2">
        <label className="field">
          <span>Segundos por mensaje</span>
          <input className="input" type="number" min={5} max={3600} value={rules.intervalSeconds} onChange={(e) => setRule("intervalSeconds", e.target.value)} />
        </label>
        <label className="field">
          <span>Ráfaga (mensajes seguidos)</span>
          <input className="input" type="number" min={1} max={10} value={rules.burst} onChange={(e) => setRule("burst", e.target.value)} />
        </label>
        <label className="field">
          <span>Rotación: mirar los últimos</span>
          <input className="input" type="number" min={5} max={100} value={rules.rotationWindow} onChange={(e) => setRule("rotationWindow", e.target.value)} />
        </label>
        <label className="field">
          <span>Rotación: máximo tuyos</span>
          <input className="input" type="number" min={1} max={50} value={rules.rotationMax} onChange={(e) => setRule("rotationMax", e.target.value)} />
        </label>
        <label className="field">
          <span>Horas de cuenta nueva</span>
          <input className="input" type="number" min={0} max={720} value={rules.newAccountHours} onChange={(e) => setRule("newAccountHours", e.target.value)} />
        </label>
        <label className="field">
          <span>Máximo en cola</span>
          <input className="input" type="number" min={1} max={10} value={rules.maxQueued} onChange={(e) => setRule("maxQueued", e.target.value)} />
        </label>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn btn--primary" disabled={state === "saving"}>
        {state === "saving" ? "Guardando…" : state === "ok" ? "Guardado ✓" : "Guardar ajustes"}
      </button>
    </form>
  );
}

function fmtSecs(s: number) {
  if (s < 60) return `${s} s`;
  const m = Math.round((s / 60) * 10) / 10;
  return `${m} min`;
}
