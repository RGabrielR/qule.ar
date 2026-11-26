import { api } from "../../api";
import type { Report } from "./types";

export function suspendReportAccount(report: Report, reason: string, verified = false) {
  return api(`/admin/users/${report.target?.id}/suspend`, {
    method: "POST",
    json: { reason, photoReportId: verified ? report.id : undefined },
  });
}
