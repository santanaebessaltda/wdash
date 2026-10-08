import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Card, CardHeader, CardSubtitle, CardTitle, EmptyState, FormField, Input, PageHeader, Select, TabNav } from "@/components/ui";
import { costTabs, managementTabs, operationTabs } from "@/layout/nav-wedash";
import { halfHourOptions } from "@/data/wedash/storeHours";
import { useActiveSession } from "@/session/SessionProvider";
import { storesKey } from "@/session/session";
import { useScope } from "@/pages/dashboard/useScope";
import { hydrateSessionStores, storesForSession, type Store } from "@/data/wedash/stores";
import { StoreIcon } from "@/pages/dashboards/icons";
import { cn } from "@/lib/cn";
import { useMinSkeleton } from "@/lib/useMinSkeleton";

/** Lojas do escopo do StorePicker ("Todas" = todas as lojas da sessao), ja com custos e horario do banco. */
export function useScopedStores() {
  const session = useActiveSession();
  const { escopo } = useScope();
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const key = `${session.tenantId}|${storesKey(session.stores)}`;
  const loadedKey = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Skeleton so quando as lojas da sessao mudam de verdade (nao a cada reidratacao da sessao).
      if (loadedKey.current !== key) setLoading(true);
      if (session.stores.length > 0) {
        await hydrateSessionStores(session.tenantId, session.stores);
        if (!cancelled) setTick((n) => n + 1);
      }
      if (!cancelled) {
        loadedKey.current = key;
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const lojas = useMemo(() => {
    const todas = storesForSession(session.stores);
    return escopo.filialIds.length === 0 ? todas : todas.filter((s) => escopo.filialIds.includes(s.id));
  }, [session.stores, escopo.filialIds, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  return { session, lojas, loading, refresh: () => setTick((n) => n + 1) };
}

export type SectionName = "Estoque" | "Gestão" | "Operação" | "Custos";

const SECTION_TABS: Record<SectionName, Array<{ label: string; to: string; end?: boolean }>> = {
  Estoque: [],
  Gestão: managementTabs,
  Operação: operationTabs,
  Custos: costTabs,
};

/** Codigo das outras abas da secao  -  baixado junto para a troca de aba nao esperar o download. */
const SECTION_PAGES: Record<SectionName, Array<() => Promise<unknown>>> = {
  Estoque: [() => import("@/pages/stock/InventoryPage")],
  Gestão: [
    () => import("@/pages/goals/GoalsPage"),
    () => import("@/pages/management/ChallengesPage"),
    () => import("@/pages/cash-close/CashClosePage"),
    () => import("@/pages/stock/PurchaseOrderPage"),
  ],
  Operação: [
    () => import("@/pages/operation/StorePage"),
    () => import("@/pages/management/ShiftsPage"),
    () => import("@/pages/management/StaffPage"),
  ],
  Custos: [
    () => import("@/pages/operation/FranchisePage"),
    () => import("@/pages/operation/RentPage"),
    () => import("@/pages/operation/ProductsTaxesPage"),
    () => import("@/pages/cash-close/AcquirersPage"),
  ],
};

/** Cabecalho da secao (breadcrumb + abas do grupo do menu). */
export function SectionHeader({
  section,
  title,
  subtitle,
  actions,
  notices,
}: {
  section: SectionName;
  title: string;
  subtitle: string;
  actions?: ReactNode;
  notices?: ReactNode;
}) {
  useEffect(() => {
    for (const load of SECTION_PAGES[section]) void load().catch(() => {});
  }, [section]);
  const tabs = SECTION_TABS[section];
  return (
    <>
      <PageHeader
        crumbs={section === title ? [{ label: title }] : [{ label: section }, { label: title }]}
        title={title}
        subtitle={subtitle}
        actions={actions}
        notices={notices}
      />
      {tabs.length > 1 && <TabNav items={tabs} />}
    </>
  );
}

/** Cabecalho da secao + 1 card por loja do escopo. */
export function StoreCardsPage({
  section,
  title,
  subtitle,
  actions,
  loading,
  skeleton,
  lojas,
  wide = false,
  children,
}: {
  section: SectionName;
  title: string;
  subtitle: string;
  actions?: ReactNode;
  loading: boolean;
  /** Recebe quantos cards desenhar = lojas do StorePicker ("Todas" = todas as da sessao). */
  skeleton: (count: number) => ReactNode;
  lojas: Store[];
  wide?: boolean;
  children: (loja: Store) => ReactNode;
}) {
  const showSkeleton = useMinSkeleton(loading);
  const session = useActiveSession();
  const { escopo } = useScope();
  const skeletonCount = Math.max(1, escopo.filialIds.length || session.stores.length);
  return (
    <div>
      <SectionHeader section={section} title={title} subtitle={subtitle} actions={actions} />
      <div className="mt-6">
        {showSkeleton ? (
          skeleton(skeletonCount)
        ) : lojas.length === 0 ? (
          <Card>
            <EmptyState framed={false} icon="🏬" title="Nenhuma loja disponível" description="Não há lojas disponíveis para este acesso." />
          </Card>
        ) : (
          <div className={wide ? "flex flex-col gap-5" : "flex max-w-[720px] flex-col gap-5"}>
            {lojas.map((loja) => (
              <div key={loja.id}>{children(loja)}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Titulo do card = loja (icone + fantasia + CNPJ). */
export function StoreCardHeader({ loja, action, className }: { loja: Store; action?: ReactNode; className?: string }) {
  return (
    <CardHeader className={className}>
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-acc-soft text-acc">
          <StoreIcon size={18} />
        </span>
        <div className="min-w-0">
          <CardTitle className="truncate">{loja.fantasia}</CardTitle>
          <CardSubtitle className="truncate">{loja.cnpj || `Filial ${loja.codFilial}`}</CardSubtitle>
        </div>
      </div>
      {action}
    </CardHeader>
  );
}

export const SAVE_ERROR_MSG = "Não foi possível salvar as alterações. Tente novamente.";

export function FormActions({ dirty, saving, onReset }: { dirty: boolean; saving: boolean; onReset: () => void }) {
  return (
    <div className="flex gap-2.5 pt-1">
      <Button variant="outline" type="button" onClick={onReset} disabled={!dirty || saving}>
        Resetar
      </Button>
      <Button type="submit" disabled={!dirty || saving}>
        {saving ? "Salvando…" : "Salvar alterações"}
      </Button>
    </div>
  );
}

/** "" = vazio; aceita "2,5", "2.5", "1.234,56" e "3.100" (milhar). NaN = invalido. */
export function parseNum(txt: string): number | null {
  const raw = txt.trim();
  const t = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(\.\d{3})+$/.test(raw)
      ? raw.replace(/\./g, "")
      : raw;
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/** R$ com 2 casas ("3.100,00"); % sem casas fixas ("2,5"). */
export function numText(v: number | null | undefined, unit: "%" | "R$" = "%"): string {
  if (v == null) return "";
  if (unit === "R$") return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return String(v).replace(".", ",");
}

/** Mascara de R$: so digitos, preenchidos pelos centavos ("123456"  ->  "1.234,56"). */
export function maskBrl(txt: string): string {
  const digits = txt.replace(/\D/g, "").replace(/^0+/, "").slice(0, 13);
  if (!digits) return "";
  return (Number(digits) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Campo numerico com sufixo (%) ou prefixo (R$). */
export function NumberField({
  label,
  hint,
  value,
  onChange,
  disabled,
  unit,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  unit: "%" | "R$";
}) {
  return (
    <FormField label={label} hint={hint}>
      <NumberInput value={value} onChange={onChange} disabled={disabled} unit={unit} aria-label={label} />
    </FormField>
  );
}

export function NumberInput({
  value,
  onChange,
  disabled,
  unit,
  compact = false,
  invalid = false,
  autoFocus,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  unit: "%" | "R$";
  /** Altura das linhas editaveis (h-9). */
  compact?: boolean;
  /** Borda vermelha (campo com erro). */
  invalid?: boolean;
  autoFocus?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const money = unit === "R$";
  return (
    <div className={cn("relative", className)}>
      <Input
        inputMode={money ? "numeric" : "decimal"}
        placeholder={money ? "0,00" : "0"}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) => onChange(money ? maskBrl(e.target.value) : e.target.value)}
        className={cn(money ? "pl-10" : "pr-8", compact && "h-9!", invalid && "border-bad!")}
        aria-label={ariaLabel}
      />
      <span className={cn("pointer-events-none absolute top-1/2 -translate-y-1/2 text-[13px] text-t2", money ? "left-3" : "right-3")}>
        {unit}
      </span>
    </div>
  );
}

const TIME_OPTS = halfHourOptions();

/** Hora de meia em meia hora (horario da loja, turnos). */
export function TimeSelect({
  value,
  disabled,
  onChange,
  "aria-label": ariaLabel,
}: {
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
  "aria-label"?: string;
}) {
  return (
    <Select
      className="h-9! w-[80px]! bg-[position:right_0.45rem_center]! pl-2.5! pr-7! sm:w-[96px]! sm:pl-3.5! sm:pr-8!"
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
    >
      {TIME_OPTS.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </Select>
  );
}

/** Proxima meia hora depois de `after` (ou a propria, se for a ultima). */
export function nextHalfHour(after: string): string {
  return TIME_OPTS.find((t) => t > after) ?? after;
}

export function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
  );
}
