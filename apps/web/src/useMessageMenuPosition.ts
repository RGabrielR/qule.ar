import { useCallback, type RefObject } from "react";

/**
 * Ubica el menú de un mensaje o de un chat arriba o abajo de lo que lo abrió, según dónde entra.
 * `preferAbove`: se abre para arriba siempre que entre (lo estándar en los menús de contexto, así no lo tapa el
 * dedo); si no, para abajo. Sin eso se abre para abajo y solo sube si no entra.
 */
export function useMessageMenuPosition(listRef: RefObject<HTMLDivElement | null>, setMenu?: (id: null) => void, preferAbove = false) {
  return useCallback((menu: HTMLDivElement | null) => {
    const list = listRef.current;
    if (!menu || !list) return;

    const viewport = window.visualViewport;
    const listBox = list.getBoundingClientRect();
    const viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
    const visibleBottom = Math.min(listBox.bottom, viewportBottom);
    // Lo de arriba que tapa: el encabezado fijo de la pantalla, si lo hay
    const header = list.querySelector(":scope > .topbar")?.getBoundingClientRect().bottom ?? 0;
    const visibleTop = Math.max(listBox.top, header, viewport?.offsetTop ?? 0);
    if (preferAbove) {
      menu.classList.add("menu--above");
      if (menu.getBoundingClientRect().top < visibleTop) menu.classList.remove("menu--above");
    } else {
      menu.classList.remove("menu--above");
      if (menu.getBoundingClientRect().bottom > visibleBottom) menu.classList.add("menu--above");
    }

    function closeOnOutsideClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element) || menu?.contains(target)) return;
      if (target.closest("[aria-controls]")?.getAttribute("aria-controls") === menu?.id) return;
      setMenu?.(null);
    }
    document.addEventListener("click", closeOnOutsideClick, true);
    return () => document.removeEventListener("click", closeOnOutsideClick, true);
  }, [listRef, setMenu, preferAbove]);
}
