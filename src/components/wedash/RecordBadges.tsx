import type { ReactNode } from "react";
import { Badge } from "@/components/ui";
import { shortDate } from "@/lib/format";
import { statusBadgeVariant } from "@/lib/status";
import { TrophyIcon } from "@/pages/dashboards/icons";

function MiniIcon({ children }: { children: ReactNode }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

/** Selo de status do card e do detalhe: Em andamento, A começar, Encerrada ou Encerrado. */
export function RecordStatusBadge({ label }: { label: string }) {
  return (
    <Badge variant={statusBadgeVariant(label)} className="shrink-0 uppercase">
      {label}
    </Badge>
  );
}

export function PeriodBadge({ from, to }: { from: string; to: string }) {
  return (
    <Badge variant="neutral" className="gap-1 uppercase">
      <MiniIcon>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </MiniIcon>
      {shortDate(from)} a {shortDate(to)}
    </Badge>
  );
}

export function BranchBadge({ name }: { name: string }) {
  return (
    <Badge variant="neutral" className="gap-1 uppercase">
      <MiniIcon>
        <path d="M3 21h18" />
        <path d="M5 21V7l7-4 7 4v14" />
        <path d="M9 21v-6h6v6" />
      </MiniIcon>
      {name}
    </Badge>
  );
}

/** "3 dias restantes", "Último dia" ou "Começa em …", no mesmo selo da meta. */
export function DeadlineBadge({ label }: { label: string }) {
  return (
    <Badge variant="neutral" className="gap-1 uppercase">
      <MiniIcon>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </MiniIcon>
      {label}
    </Badge>
  );
}

/** Meta com o rateio de vendas sem vendedor identificado ligado. */
export function UnidentifiedSalesBadge() {
  return (
    <Badge variant="neutral" className="gap-1 uppercase">
      <MiniIcon>
        <circle cx="12" cy="18" r="3" />
        <circle cx="6" cy="6" r="3" />
        <circle cx="18" cy="6" r="3" />
        <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9" />
        <path d="M12 12v3" />
      </MiniIcon>
      Rateio automático
    </Badge>
  );
}

export function PrizeBadge({ label }: { label: string }) {
  return (
    <Badge variant="neutral" className="gap-1 uppercase">
      <TrophyIcon size={11} />
      {label}
    </Badge>
  );
}
