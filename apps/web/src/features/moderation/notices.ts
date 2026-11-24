import type { NotifyKind } from "../../api";

export type Notice = { kind: NotifyKind; label: string; hint?: string };

/**
 * Avisos de moderación que se pueden apagar. Se muestran en Configuración y en el panel de Moderación.
 * Lo urgente va aparte y solo para la administración general (el servidor se lo manda como "moderacion_urgente").
 */
export const staffNotices = (owner: boolean): Notice[] => [
  {
    kind: "moderacion",
    label: "Moderación",
    hint: "Reportes urgentes y pedidos de revisión. Si lo apagás, igual los ves al entrar a Moderación.",
  },
  ...(owner
    ? [{
        kind: "moderacion_urgente" as const,
        label: "Moderación: lo más urgente",
        hint: "Reportes por menor de edad y suspensiones preventivas para revisar. Si lo apagás, fijate que alguien más de la administración lo tenga prendido.",
      }]
    : []),
];
