import type { ReactNode } from "react";
import { Button, Card, CardTitle, Skeleton } from "@/components/ui";
import { PlusIcon } from "@/pages/utility/icons";

export type ConnectionRow = {
  key: string;
  name: string;
  detail: string;
  mark: ReactNode;
  onDisconnect: () => void;
};

/** Lista de uma conexão, no formato das API Keys. O botão fica bloqueado enquanto houver uma linha. */
export function ConnectionCard({
  title,
  hint,
  connectLabel,
  connectDisabled,
  onConnect,
  empty,
  rows,
}: {
  title: string;
  hint: string;
  connectLabel: string;
  connectDisabled: boolean;
  onConnect: () => void;
  empty: string;
  rows: ConnectionRow[];
}) {
  return (
    <Card className="mt-6">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-3">
        <CardTitle>{title}</CardTitle>
        <Button icon={<PlusIcon size={14} />} onClick={onConnect} disabled={connectDisabled}>
          {connectLabel}
        </Button>
      </div>
      <p className="mb-4.5 text-[12.5px] text-t2">{hint}</p>
      {rows.length === 0 ? (
        <p className="text-[13px] text-t2">{empty}</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((row) => (
            <div key={row.key} className="flex flex-col gap-3 rounded-[13px] border border-line bg-bg-inset px-4 py-3.5 sm:flex-row sm:items-center">
              <Mark>{row.mark}</Mark>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-bold text-t0">{row.name}</p>
                <p className="mt-0.5 truncate text-xs text-t2">{row.detail}</p>
              </div>
              <Button variant="outline" size="sm" onClick={row.onDisconnect}>
                Desconectar
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function ConnectionSkeleton({ label }: { label: string }) {
  return (
    <Card className="mt-6" aria-busy="true" aria-label={label}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-9 w-44 rounded-[var(--radius-vela-sm)]" />
      </div>
      <Skeleton className="mb-4 h-3 w-72 max-w-full" />
      <div className="flex items-center gap-3 rounded-[13px] border border-line px-4 py-3.5">
        <Skeleton className="h-[38px] w-[38px] rounded-[11px]" />
        <div className="flex-1">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="mt-2 h-3 w-40" />
        </div>
      </div>
    </Card>
  );
}

export function PickerRow({ name, detail, mark, onClick }: { name: string; detail: string; mark: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-[13px] border border-line bg-bg-inset px-4 py-3.5 text-left transition-colors hover:bg-bg-3"
    >
      <Mark>{mark}</Mark>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-bold text-t0">{name}</span>
        <span className="mt-0.5 block text-xs text-t2">{detail}</span>
      </span>
    </button>
  );
}

function Mark({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center overflow-hidden rounded-[11px] border border-line bg-bg-2">
      {children}
    </span>
  );
}
