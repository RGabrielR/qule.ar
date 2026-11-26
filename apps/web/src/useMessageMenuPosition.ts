import { useCallback, type RefObject } from "react";

export function useMessageMenuPosition(listRef: RefObject<HTMLDivElement | null>, setMenu?: (id: null) => void) {
  return useCallback((menu: HTMLDivElement | null) => {
    const list = listRef.current;
    if (!menu || !list) return;

    const viewport = window.visualViewport;
    const viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
    const visibleBottom = Math.min(list.getBoundingClientRect().bottom, viewportBottom);
    menu.classList.remove("menu--above");
    if (menu.getBoundingClientRect().bottom > visibleBottom) menu.classList.add("menu--above");

    function closeOnOutsideClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element) || menu?.contains(target)) return;
      if (target.closest("[aria-controls]")?.getAttribute("aria-controls") === menu?.id) return;
      setMenu?.(null);
    }
    document.addEventListener("click", closeOnOutsideClick, true);
    return () => document.removeEventListener("click", closeOnOutsideClick, true);
  }, [listRef, setMenu]);
}
