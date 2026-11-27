import type { ReactNode } from "react";
import { useOutlet } from "react-router";
import { useDesktop } from "./useDesktop";

/**
 * Lista y detalle. En el celular es una pantalla por vez, como siempre: la lista sola, o lo que se abrió (la ruta hija).
 * En compu van lado a lado: la lista queda a la izquierda y lo abierto a la derecha, así se pasa de una charla a otra sin
 * ir y volver.
 */
export function SplitView({ list, empty }: { list: ReactNode; empty: { title: string; text: string } }) {
  const desktop = useDesktop();
  const outlet = useOutlet();
  if (!desktop) return outlet ?? list;
  return (
    <div className="split">
      <div className="split__list">{list}</div>
      <div className="split__detail">
        {outlet ?? (
          <div className="empty split__empty">
            <p className="empty__title">{empty.title}</p>
            <p className="muted">{empty.text}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Un chat con su panel al costado. En compu, los detalles de un grupo (o sus solicitudes, invitaciones, edición) se abren
 * a la derecha del chat, sin taparlo. En el celular se ve uno por vez.
 */
export function ThreadWithAside({ thread }: { thread: ReactNode }) {
  const desktop = useDesktop();
  const outlet = useOutlet();
  if (!desktop) return outlet ?? thread;
  return (
    <div className="split__thread">
      <div className="split__chat">{thread}</div>
      {outlet && <aside className="split__aside">{outlet}</aside>}
    </div>
  );
}
