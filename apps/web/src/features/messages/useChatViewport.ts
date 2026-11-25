import { useLayoutEffect, useRef } from "react";

export function useChatViewport(active: boolean) {
  const shell = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = shell.current;
    const viewport = window.visualViewport;
    if (!active || !element || !viewport) return;

    const installedOnIOS = (navigator as Navigator & { standalone?: boolean }).standalone === true;
    let fullHeight = viewport.height;
    let width = viewport.width;

    const reset = () => {
      element.removeAttribute("data-chat-keyboard");
      element.style.removeProperty("--chat-top");
      element.style.removeProperty("--chat-height");
    };

    const update = () => {
      // Al hacer zoom, dejá que el navegador desplace la página normalmente.
      if (viewport.scale === 1) {
        if (installedOnIOS) {
          // iOS puede conservar el área segura inferior mientras el teclado la cubre.
          if (width !== viewport.width) {
            width = viewport.width;
            fullHeight = viewport.height;
          }
          fullHeight = Math.max(fullHeight, viewport.height);
          const covered = Math.max(fullHeight, document.documentElement.clientHeight) - viewport.height;
          element.toggleAttribute("data-chat-keyboard", covered > 80);
        }
        element.style.setProperty("--chat-top", viewport.offsetTop + "px");
        element.style.setProperty("--chat-height", viewport.height + "px");
      } else {
        reset();
      }
    };

    const focusBeforeKeyboard = (event: PointerEvent) => {
      const input = event.target;
      if (event.pointerType !== "touch" || !event.isPrimary || viewport.scale !== 1) return;
      if (!(input instanceof HTMLTextAreaElement) || !input.matches(".composer__input") || input === document.activeElement) return;

      // Al pedir foco, el campo ya está en la parte que seguirá visible con teclado.
      // El desplazamiento visual dura solo este evento y no mueve el resto del chat.
      const offset = viewport.offsetTop - input.getBoundingClientRect().top;
      input.style.setProperty("--chat-focus-translate", "0 " + offset + "px");
      try {
        input.focus({ preventScroll: true });
      } finally {
        input.style.removeProperty("--chat-focus-translate");
      }
    };

    const agent = navigator.userAgent;
    const safariOnIPhone = /iPhone/.test(agent) && /Version\/[\d.]+ Mobile\/\S+ Safari\//.test(agent)
      && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(agent);
    if (installedOnIOS || safariOnIPhone) element.addEventListener("pointerup", focusBeforeKeyboard);
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      element.removeEventListener("pointerup", focusBeforeKeyboard);
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      reset();
    };
  }, [active]);

  return shell;
}
