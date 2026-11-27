import { NavLink } from "react-router";

export function PeopleTabs({ unseen }: { unseen: number }) {
  return (
    <nav className="tabs people-tabs" aria-label="Vistas de Gente">
      <NavLink to="/cerca" end>Todos</NavLink>
      <NavLink to="/cerca/nuevos">Nuevos</NavLink>
      <NavLink to="/cerca/toques">
        Toques
        {unseen > 0 && <span className="badge badge--inline">{unseen > 99 ? "99+" : unseen}</span>}
      </NavLink>
    </nav>
  );
}
