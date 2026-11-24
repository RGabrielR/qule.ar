import { useEffect } from "react";

function scrollToField() {
  const viewport = window.visualViewport;
  const field = document.activeElement;
  if (!field?.matches("input, textarea")) return;
  const editor = field.closest<HTMLElement>(".profile-editor");
  if (!editor) return;

  const visibleTop = viewport?.offsetTop ?? 0;
  const bounds = editor.getBoundingClientRect();
  const header = editor.querySelector(".topbar")?.getBoundingClientRect();
  const top = Math.max(visibleTop, bounds.top, header?.bottom ?? 0);
  const bottom = Math.min(visibleTop + (viewport?.height ?? window.innerHeight), bounds.bottom);
  const rect = field.getBoundingClientRect();
  if (rect.height > bottom - top) return;
  if (rect.bottom > bottom) editor.scrollTop += Math.ceil(rect.bottom - bottom);
  else if (rect.top < top) editor.scrollTop -= Math.ceil(top - rect.top);
}

export function useEditorKeyboard() {
  useEffect(() => {
    if (!window.matchMedia("(any-pointer: coarse)").matches) return;
    const viewport = window.visualViewport;
    const height = () => viewport?.height ?? window.innerHeight;
    let restingHeight = height();
    let width = window.innerWidth;
    let keyboardOpen = false;

    let frame = 0;

    function revealField() {
      cancelAnimationFrame(frame);
      if (!keyboardOpen) return;
      frame = requestAnimationFrame(scrollToField);
    }

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
      revealField();
    }

    viewport?.addEventListener("resize", resize);
    window.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", revealField);
    document.addEventListener("focusin", revealField);
    return () => {
      viewport?.removeEventListener("resize", resize);
      window.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", revealField);
      document.removeEventListener("focusin", revealField);
      cancelAnimationFrame(frame);
    };
  }, []);
}
