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
  /** Cuántas personas distintas reportaron ese tema (entre los reportes de la lista). No suma a quienes no cuentan. */
  subjectReporters: number;
  /** Lo mandó una cuenta cuyos reportes moderación hizo que no cuenten (ver ReportSpamAlerts). */
  reporterMuted: boolean;
  reason: string;
  details: string | null;
  status: "open" | "dismissed" | "actioned";
  urgent: boolean;
  automatic: boolean;
  targetAutoHidden: boolean;
  /** Varias personas la reportaron por lo mismo: si nadie lo revisa, se suspende sola en esta fecha. */
  targetAutoSuspendAt: string | null;
  resolution: string | null;
  createdAt: string;
  messageId: string | null;
  messageKind: "group" | "dm" | null;
  message: { body: string | null; photo: boolean; deleted: boolean; hidden?: boolean } | null;
  reporter: Author | null;
  /** Quién reportó solo lo ve la administración general */
  reporterHidden: boolean;
  // Reporte de una persona (id null: la cuenta se borró) o de un grupo (target null y group con datos)
  target: (Omit<Author, "id"> & { id: string | null }) | null;
  group: ReportedGroup | null;
  evidenceFiles: number;
  photoVerification: boolean;
  photoEvidence: boolean;
  targetSuspendedAt: string | null;
  targetSuspendedUntil?: string | null;
  targetReportCount: number;
};
