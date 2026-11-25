import type { ChatContact } from "../../api";

export function ChatPresenceDot({ state }: { state?: ChatContact["presence"] }) {
  if (!state) return null;
  const online = state === "online";
  const label = online ? "En línea" : "Hace un rato";
  return <i className={online ? "dot dot--on" : "dot dot--recent"} role="img" aria-label={label} title={label} />;
}
