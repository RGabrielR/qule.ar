import type { Author } from "../../api";

export type ReportedGroup = {
  // id null: el grupo ya se purgó (pasaron los 90 días); queda el nombre que tenía al reportarlo
  id: string | null;
  name: string;
  description: string | null;
  memberCount: number;
  removedAt: string | null;
  autoHidden: boolean;
};

export type Report = {
  id: string;
  /** Sobre qué es: "g:<grupo>", "u:<persona>" o "r:<reporte>" si la cuenta se borró. Los del mismo tema se agrupan. */
  subject: string;
  /** Cuántas personas distintas reportaron ese tema (entre los reportes de la lista). */
  subjectReporters: number;
  reason: string;
  details: string | null;
  status: "open" | "dismissed" | "actioned";
  urgent: boolean;
  automatic: boolean;
  targetAutoHidden: boolean;
  resolution: string | null;
  createdAt: string;
  messageId: string | null;
  messageKind: "group" | "dm" | null;
  message: { body: string | null; photo: boolean; deleted: boolean } | null;
  reporter: Author | null;
  /** Quién reportó solo lo ve la administración general */
  reporterHidden: boolean;
  // Reporte de una persona (id null: la cuenta se borró) o de un grupo (target null y group con datos)
  target: (Omit<Author, "id"> & { id: string | null }) | null;
  group: ReportedGroup | null;
  evidenceFiles: number;
  targetSuspendedAt: string | null;
  targetReportCount: number;
};
