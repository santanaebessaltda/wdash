import type { ReactNode } from "react";
import { PageHeader, TabNav } from "@/components/ui";
import { documentTabs } from "@/layout/nav-wedash";
import type { DocumentRow } from "@/data/wedash/documentsRepo";

export const STATUS_LABEL: Record<DocumentRow["status"], string> = {
  UNASSIGNED: "Pendente",
  PENDING: "Pendente",
  SIGNED: "Assinado",
  DECLINED: "Recusado",
  EXPIRED: "Expirado",
};

export function badgeVariant(status: DocumentRow["status"]) {
  if (status === "SIGNED") return "success" as const;
  if (status === "DECLINED") return "danger" as const;
  if (status === "EXPIRED") return "warning" as const;
  return "neutral" as const;
}

export function DocumentsFrame({ title, subtitle, actions, children }: { title: string; subtitle: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <PageHeader crumbs={[{ label: "Documentos" }, { label: title }]} title={title} subtitle={subtitle} actions={actions} />
      <div className="mb-5">
        <TabNav items={documentTabs} />
      </div>
      {children}
    </div>
  );
}

export function FolderGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

export function FileGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
