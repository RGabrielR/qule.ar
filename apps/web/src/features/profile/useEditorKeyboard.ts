import { useEffect, useState } from "react";

export function useEditorKeyboard() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!window.matchMedia("(any-pointer: coarse)").matches) return;
    const viewport = window.visualViewport;
    const height = () => viewport?.height ?? window.innerHeight;
    let restingHeight = height();
    let width = window.innerWidth;
    let keyboardOpen = false;

    function resize() {
      if (viewport && viewport.scale !== 1) return;
      const current = height();
      if (window.innerWidth !== width) {
        width = window.innerWidth;
        restingHeight = current;
      }
      const editing = document.activeElement?.matches(".profile-editor :is(input, textarea)");
      // La barra del navegador también cambia de alto. Un teclado ocupa bastante más.
      keyboardOpen = Boolean((editing || keyboardOpen) && restingHeight - current > 100);
      if (!editing && !keyboardOpen) restingHeight = current;
      else restingHeight = Math.max(restingHeight, current);
      setOpen(keyboardOpen);
    }

    viewport?.addEventListener("resize", resize);
    window.addEventListener("resize", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return open;
}
