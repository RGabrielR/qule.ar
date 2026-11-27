import { useEffect } from "react";
import { Link, useNavigate } from "react-router";
import { useMe } from "../App";
import { BackIcon } from "../components/Icons";
import { Markdown } from "../components/Markdown";
import { Wordmark } from "../components/Wordmark";
import { markBack, usePageTransition } from "../features/navigation/pageTransition";
import terminos from "../legal/terminos.md?raw";
import privacidad from "../legal/privacidad.md?raw";

const DOCS = { terminos, privacidad };

/** Términos y Política de privacidad. Son públicas: se pueden leer sin tener cuenta. */
export function Legal({ doc }: { doc: keyof typeof DOCS }) {
  const nav = useNavigate();
  const { me } = useMe();
  const enter = usePageTransition();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [doc]);

  return (
    <div className={`legal ${enter}`}>
      <header className="legal__top">
        <button className="iconbtn" aria-label="Volver" onClick={() => { markBack(); if (history.length > 1) nav(-1); else nav("/"); }}>
          <BackIcon />
        </button>
        <Wordmark />
      </header>
      <article className="legal__body">
        <Markdown source={DOCS[doc]} />
      </article>
      <footer className="legal__foot muted small">
        {doc === "terminos" ? <Link to="/privacidad">Política de privacidad</Link> : <Link to="/terminos">Términos y condiciones</Link>}
        {" · "}
        <Link to={me ? "/" : "/entrar"}>{me ? "Volver a la app" : "Entrar"}</Link>
      </footer>
    </div>
  );
}
