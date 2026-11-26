import type { StaffAccess } from "./api";

/** Los permisos chicos de moderación, con lo que permite cada uno. */
export const PERMISSION_LABELS: { id: Exclude<StaffAccess, "owner">; label: string; hint: string }[] = [
  { id: "reports", label: "Reportes", hint: "Revisar reportes, descartarlos y borrar el mensaje reportado. Ante un reporte por menor de edad, suspender de forma preventiva" },
  { id: "sanctions", label: "Suspensiones", hint: "Suspender y reactivar cuentas" },
  { id: "photoVerification", label: "Verificar fotos", hint: "Comparar capturas con fotos privadas vinculadas a un reporte. También requiere el permiso Reportes" },
  { id: "appeals", label: "Revisiones", hint: "Responder pedidos de revisión de suspensiones" },
];

export function toggleStaffPermission<T extends string>(permissions: T[], permission: T): T[] {
  if (!permissions.includes(permission)) return [...permissions, permission];
  return permissions.filter((existing) =>
    existing !== permission && (permission !== "reports" || existing !== "photoVerification"));
}
