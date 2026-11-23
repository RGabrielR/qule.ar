import { useCallback, type RefObject } from "react";

export function useMessageMenuPosition(listRef: RefObject<HTMLDivElement | null>) {
  return useCallback((menu: HTMLDivElement | null) => {
    const list = listRef.current;
    if (!menu || !list) return;

    const viewport = window.visualViewport;
    const viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
    const visibleBottom = Math.min(list.getBoundingClientRect().bottom, viewportBottom);
    menu.classList.remove("menu--above");
    if (menu.getBoundingClientRect().bottom > visibleBottom) menu.classList.add("menu--above");
  }, [listRef]);
}
