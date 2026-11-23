import type { StaffAccess } from "./api";

/** Los permisos chicos de moderación, con lo que permite cada uno. */
export const PERMISSION_LABELS: { id: Exclude<StaffAccess, "owner">; label: string; hint: string }[] = [
  { id: "reports", label: "Reportes", hint: "Revisar reportes, descartarlos y borrar el mensaje reportado" },
  { id: "sanctions", label: "Suspensiones", hint: "Suspender y reactivar cuentas" },
  { id: "appeals", label: "Revisiones", hint: "Responder pedidos de revisión de suspensiones" },
];
