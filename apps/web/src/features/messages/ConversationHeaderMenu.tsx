import { useId, useRef, useState } from "react";
import { DotsIcon } from "../../components/Icons";
import type { ConversationAction } from "./ConversationActions";
import { ConversationMenu } from "./ConversationMenu";

export function ConversationHeaderMenu({ muted, onAction }: { muted: boolean; onAction: (action: ConversationAction) => void }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  return (
    <div className="conversation-header-menu">
      <button ref={button} type="button" className="iconbtn" aria-label="Opciones del chat"
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((previous) => !previous)}>
        <DotsIcon />
      </button>
      {open && <ConversationMenu id={menuId} className="menu--conversation-header" anchor={button}
        muted={muted} canModerate onAction={onAction} onClose={() => setOpen(false)} />}
    </div>
  );
}
