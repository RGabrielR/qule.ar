import type { SuspensionDuration, SuspensionWindow } from "@mortero/shared/suspension";
import { api } from "../../api";
import type { Report } from "./types";

export function suspendReportAccount(report: Report, reason: string, duration: SuspensionDuration | null, verified = false) {
  return api<SuspensionWindow>(`/admin/users/${report.target?.id}/suspend`, {
    method: "POST",
    json: { reason, duration, photoReportId: verified ? report.id : undefined },
  });
}
