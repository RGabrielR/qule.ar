import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from "react-router";
import { api, ApiError, closeSocket, getSocket, type Me } from "./api";
import { Admin } from "./pages/Admin";
import { Suspended } from "./pages/Suspended";
import { Login } from "./pages/Login";
import { NotifyBanner } from "./components/NotifyBanner";
import { UpdateBanner } from "./components/UpdateBanner";
import { TermsBanner } from "./components/TermsBanner";
import { Legal } from "./pages/Legal";
import { Logo } from "./components/Logo";
import { TAB_PATHS, useTabSwipe } from "./features/navigation/useTabSwipe";
import { TabDataProvider, useTabData } from "./features/navigation/tabData";
import { APP_NAME } from "./brand";
import { ForgotPassword, ResetPassword } from "./pages/Password";
import { Onboarding } from "./pages/Onboarding";
import { GroupChat } from "./pages/GroupChat";
import { Groups } from "./pages/Groups";
import { GroupInfo } from "./pages/GroupInfo";
import { Inbox } from "./pages/Inbox";
import { Conversation } from "./pages/Conversation";
import { ProfilePage } from "./pages/Profile";
import { EditProfile } from "./pages/MyProfile";
import { MyProfileOverview } from "./pages/MyProfileOverview";
import { Settings } from "./pages/Settings";
import { ChatIcon, GridIcon, GroupIcon, UserIcon } from "./components/Icons";
import { Nearby } from "./pages/Nearby";
import { Favorites, Toques, Views } from "./pages/People";
import { useLocationSync } from "./location";

type MeState = { me: Me | null; loading: boolean; reload: () => Promise<void> };
const MeContext = createContext<MeState>({ me: null, loading: true, reload: async () => {} });
export const useMe = () => useContext(MeContext);

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setMe(await api<Me>("/me"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setMe(null);
        closeSocket();
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  if (loading) return <div className="splash"><Logo className="splash__logo" /></div>;

  return (
    <MeContext.Provider value={{ me, loading, reload }}>
      <Routes>
        <Route path="/entrar" element={me ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/recuperar" element={<ForgotPassword />} />
        <Route path="/nueva-clave" element={<ResetPassword />} />
        {/* Públicas: se leen con o sin cuenta (y también si la cuenta está suspendida) */}
        <Route path="/terminos" element={<Legal doc="terminos" />} />
        <Route path="/privacidad" element={<Legal doc="privacidad" />} />
        <Route path="/bienvenida" element={<RequireAuth><Onboarding /></RequireAuth>} />
        <Route element={<RequireAuth needProfile><Shell /></RequireAuth>}>
          <Route path="/" element={<Navigate to="/cerca" replace />} />
          <Route path="/cerca" element={<Nearby />} />
          <Route path="/grupos" element={<Groups />} />
          <Route path="/grupos/:id" element={<GroupChat />} />
          <Route path="/grupos/:id/info" element={<GroupInfo />} />
          <Route path="/mensajes" element={<Inbox />} />
          <Route path="/mensajes/:id" element={<Conversation />} />
          <Route path="/perfil/:id" element={<ProfilePage />} />
          <Route path="/yo" element={<MyProfileOverview />} />
          <Route path="/yo/editar" element={<EditProfile />} />
          <Route path="/yo/configuracion" element={<Settings />} />
          <Route path="/visitas" element={<Views />} />
          <Route path="/favoritos" element={<Favorites />} />
          <Route path="/toques" element={<Toques />} />
          <Route element={<RequirePermission allows={(me) => me.user.isAdmin} />}>
            <Route path="/admin" element={<Admin />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <UpdateBanner />
    </MeContext.Provider>
  );
}

function RequireAuth({ children, needProfile }: { children: React.ReactNode; needProfile?: boolean }) {
  const { me, reload } = useMe();
  const loc = useLocation();
  if (!me) return <Navigate to="/entrar" replace state={{ from: loc.pathname }} />;
  if (me.profile?.suspendedAt) return <Suspended me={me} onSignedOut={reload} />;
  if (needProfile && !me.profile) return <Navigate to="/bienvenida" replace />;
  if (!needProfile && me.profile && loc.pathname === "/bienvenida") return <Navigate to="/yo/editar?nuevo=1" replace />;
  return <>{children}</>;
}

function RequirePermission({ allows }: { allows: (me: Me) => boolean }) {
  const { me } = useMe();
  if (!me || !allows(me)) return <Navigate to="/" replace />;
  return <Outlet />;
}

type Toast = { id: number; text: string; to?: string };

function Shell() {
  const { me, reload } = useMe();
  return <TabDataProvider key={me?.user.id} userId={me?.user.id ?? ""} onUnauthorized={reload}><ShellContent /></TabDataProvider>;
}

function ShellContent() {
  const { groups, invites, conversations } = useTabData();
  const unread = conversations?.reduce((n, c) => n + c.unread, 0) ?? 0;
  const pending = (groups?.reduce((n, g) => n + g.pendingCount, 0) ?? 0) + (invites?.length ?? 0);
  const [toast, setToast] = useState<Toast | null>(null);
  const loc = useLocation();
  const { main, enabled: canSwipeTabs, ...swipeHandlers } = useTabSwipe();
  const { me } = useMe();

  // Si compartiste tu ubicación, se mantiene al día mientras usás la app (por si te moviste o te fuiste de viaje)
  useLocationSync(!!me?.profile?.hasLocation);

  // Avisos en vivo de grupos. Los contadores y las listas comparten los mismos pedidos.
  useEffect(() => {
    const s = getSocket();
    const show = (text: string, to?: string) => setToast({ id: Date.now(), text, to });
    const accepted = (p: { groupId: string; name: string }) => show(`Te aceptaron en ${p.name}`, `/grupos/${p.groupId}`);
    const rejected = (p: { name: string }) => show(`No te aceptaron en ${p.name}`);
    const removed = (p: { name: string }) => show(`Te sacaron de ${p.name}`);
    const invited = (p: { name?: string }) => {
      if (p.name) show(`Te invitaron a ${p.name}`, "/grupos");
    };
    s.on("group:accepted", accepted);
    s.on("group:rejected", rejected);
    s.on("group:removed", removed);
    s.on("group:invite", invited);
    return () => {
      s.off("group:accepted", accepted);
      s.off("group:rejected", rejected);
      s.off("group:removed", removed);
      s.off("group:invite", invited);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  // Contador en la pestaña del navegador y en el ícono de la app instalada
  useEffect(() => {
    const n = unread + pending;
    document.title = n ? `(${n}) ${APP_NAME}` : APP_NAME;
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (n) nav.setAppBadge?.(n).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
  }, [unread, pending]);

  // En una conversación abierta, la barra de abajo se esconde para dejar lugar al teclado
  const inThread = /^\/mensajes\/.+/.test(loc.pathname) || /^\/grupos\/[^/]+\/?$/.test(loc.pathname);
  const inMyProfile = /^\/yo(?:\/|$)/.test(loc.pathname);
  const nearbyEntry = loc.pathname.startsWith("/perfil/") ? loc.state?.nearbyEntry : undefined;

  return (
    <div className={`shell${inThread ? " shell--thread" : ""}${canSwipeTabs ? " shell--swipe" : ""}`}>
      <main className="shell__main" ref={main} {...swipeHandlers}>
        <Outlet />
      </main>
      {!inThread && <TermsBanner />}
      {!inThread && !inMyProfile && <NotifyBanner />}
      {toast && (
        <div className="toast" role="status" key={toast.id}>
          {toast.to ? <NavLink to={toast.to} onClick={() => setToast(null)}>{toast.text} →</NavLink> : <span>{toast.text}</span>}
        </div>
      )}
      {!inThread && (
        <nav className="tabbar" aria-label="Secciones">
          <NavLink to={TAB_PATHS[0]} state={nearbyEntry ? { nearbyEntry } : undefined} className="tabbar__item">
            <GridIcon /> <span>Gente</span>
          </NavLink>
          <NavLink to={TAB_PATHS[1]} className="tabbar__item">
            <GroupIcon /> <span>Grupos</span>
            {pending > 0 && <b className="badge">{pending > 99 ? "99+" : pending}</b>}
          </NavLink>
          <NavLink to={TAB_PATHS[2]} className="tabbar__item">
            <ChatIcon /> <span>Mensajes</span>
            {unread > 0 && <b className="badge">{unread > 99 ? "99+" : unread}</b>}
          </NavLink>
          <NavLink to={TAB_PATHS[3]} className="tabbar__item">
            <UserIcon /> <span>Yo</span>
          </NavLink>
        </nav>
      )}
    </div>
  );
}
