import { useState } from "react";
import { api, type ConversationSummary } from "../../api";
import { ReportDialog } from "../../components/ReportDialog";
import { useTabData } from "../navigation/tabData";
import { ConversationActionDialog } from "./ConversationActionDialog";

export type ConversationAction = "remove" | "mute" | "block" | "report";
type Chat = Pick<ConversationSummary, "id" | "other" | "muted">;

export function useConversationActions(onExit?: () => void) {
  const { refreshConversations, refreshAfterBlock } = useTabData();
  const [selection, setSelection] = useState<{ action: Exclude<ConversationAction, "mute">; chat: Chat } | null>(null);
  const [muteError, setMuteError] = useState(false);
  const close = () => setSelection(null);

  async function act(action: ConversationAction, chat: Chat, onMuted?: (muted: boolean) => void) {
    setMuteError(false);
    if (action !== "mute") {
      setSelection({ action, chat });
      return;
    }
    try {
      const { muted } = await api<{ muted: boolean }>(`/conversations/${chat.id}/notifications`, {
        method: "PUT", json: { muted: !chat.muted },
      });
      onMuted?.(muted);
      refreshConversations("refresh");
    } catch {
      setMuteError(true);
    }
  }

  async function confirm() {
    if (!selection) return;
    const { action, chat } = selection;
    if (action === "remove") {
      await api(`/conversations/${chat.id}`, { method: "DELETE" });
      refreshConversations("refresh");
      onExit?.();
    } else if (action === "block" && chat.other) {
      await api("/blocks", { method: "POST", json: { userId: chat.other.id } });
      refreshAfterBlock();
      onExit?.();
    }
  }

  const dialog = selection?.action === "report" && selection.chat.other
    ? <ReportDialog userId={selection.chat.other.id} name={selection.chat.other.name} onClose={close} />
    : selection && selection.action !== "report"
      ? <ConversationActionDialog action={selection.action} name={selection.chat.other?.name} onConfirm={confirm} onClose={close} />
      : null;
  const errorNotice = muteError && (
    <div className="notice notice--error" role="alert">No se pudieron cambiar los avisos del chat. Probá de nuevo.</div>
  );
  return { act, dialog, errorNotice };
}
