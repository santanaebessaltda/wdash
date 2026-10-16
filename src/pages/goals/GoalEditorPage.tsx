import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PersonAvatar } from "@/components/wedash/PersonAvatar";
import {
  Alert,
  Breadcrumbs,
  Button,
  Card,
  CardHeader,
  CardTitle,
  DatePicker,
  FormField,
  Input,
  Segmented,
  Select,
  Skeleton,
  Switch,
  useToast,
} from "@/components/ui";
import {
  fetchGoal,
  fetchGoalTeam,
  saveGoal,
  type GoalGroup,
  type GoalTeamMember,
} from "@/data/wedash/goalsRepo";
import { copyGoalName, nextGoalPeriod } from "@/data/wedash/goalView";
import { fetchStoreShifts, storesForSession } from "@/data/wedash/stores";
import { brlCent, isoToDate, dateToIso } from "@/lib/format";
import { cn } from "@/lib/cn";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { useReturnWhenStoreChanges, useScope } from "@/pages/dashboard/useScope";
import {
  NumberInput,
  numText,
  parseNum,
  SAVE_ERROR_MSG,
} from "@/pages/operation/shared";
import { Icon, icons } from "@/pages/users/Icons";
import { goalBackPath } from "@/pages/goals/backPath";
import { paths } from "@/router/paths";
import { useActiveSession } from "@/session/SessionProvider";

/** Grupo da loja (Gestao > Grupos): na meta so muda o % da meta global. */
type GroupRow = {
  key: string;
  name: string;
  pct: string;
  /** Ordem da ultima edicao manual; 0 = % ajustado automaticamente. */
  editedAt: number;
};
/** Nivel da premiacao progressiva: meta = % da meta a atingir; premiacao = % sobre as vendas; bonus = R$ fixo por atingir. */
type TierRow = {
  key: number;
  name: string;
  goal: string;
  commission: string;
  bonus: string;
  /** Premiacao da gerencia (% sobre o faturamento total da loja). */
  mgrCommission: string;
  mgrBonus: string;
};
/** Individual = cada pessoa sobre a propria meta; Grupo = o grupo sobre a soma; Geral = a loja sobre o total vendido, premiacao dividida. */
type PrizeMode = "INDIVIDUAL" | "GROUP" | "GENERAL";

const PRIZE_MODE_HELP: Record<PrizeMode, string> = {
  INDIVIDUAL:
    "Cada pessoa sobe de nível pela própria meta e recebe a premiação sobre as próprias vendas. O bônus também é individual.",
  GROUP:
    "O grupo sobe de nível pela soma das vendas. A premiação é dividida igualmente entre as pessoas do grupo, e o bônus vale para cada pessoa.",
  GENERAL:
    "A filial sobe de nível pelo total vendido, inclusive a venda do caixa e a venda sem vendedor. Faturamento e nº de vendas de cada pessoa são a parte igual desse total. Ticket médio e P.A. são os da filial. A premiação é dividida igualmente e o bônus vale para cada pessoa.",
};

type TierErrors = { goal?: string; commission?: string; mgrCommission?: string };
type FormErrors = {
  name?: string;
  startsOn?: string;
  endsOn?: string;
  storeId?: string;
  target?: string;
  groups?: string;
  /** Por `TierRow.key`. */
  tiers?: Record<number, TierErrors>;
};

const REQUIRED = "Campo obrigatório.";

/** Erros do formulario; objeto vazio = pode salvar. */
function validateGoal(f: {
  name: string;
  startsOn: Date | null;
  endsOn: Date | null;
  storeId: string;
  target: number | null;
  groupsOn: boolean;
  groups: GroupRow[] | null;
  tiersOn: boolean;
  tiers: TierRow[];
  managerOn: boolean;
}): FormErrors {
  const e: FormErrors = {};
  if (!f.name.trim()) e.name = REQUIRED;
  if (!f.startsOn) e.startsOn = REQUIRED;
  if (!f.endsOn) e.endsOn = REQUIRED;
  else if (f.startsOn && f.endsOn < f.startsOn)
    e.endsOn = "A data de fim precisa ser depois da data de início.";
  if (!f.storeId) e.storeId = REQUIRED;
  if (f.target == null) e.target = "Informe a meta da filial.";

  if (f.groupsOn && f.storeId) {
    if (f.groups == null) e.groups = "Os grupos da filial ainda estão carregando.";
    else if (f.groups.length === 0)
      e.groups = "Crie os grupos da filial ou desative a Distribuição por grupos.";
    else {
      const total = f.groups.reduce((s, g) => s + (groupPct(g) ?? 0), 0);
      if (Math.abs(total - 100) >= 0.005)
        e.groups = `A soma dos grupos precisa totalizar 100%. Atualmente está em ${numText(Math.round(total * 10) / 10)}%.`;
    }
  }

  if (f.tiersOn) {
    const tiers: Record<number, TierErrors> = {};
    let previous: number | null = null;
    for (const t of f.tiers) {
      const te: TierErrors = {};
      const goal = positive(t.goal);
      if (goal == null) te.goal = REQUIRED;
      else if (previous != null && goal <= previous)
        te.goal = `A meta deste nível precisa ser maior que a do nível anterior (${numText(previous)}%).`;
      if (positive(t.commission) == null) te.commission = REQUIRED;
      if (f.managerOn && positive(t.mgrCommission) == null) te.mgrCommission = REQUIRED;
      if (te.goal || te.commission || te.mgrCommission) tiers[t.key] = te;
      if (goal != null) previous = goal;
    }
    if (Object.keys(tiers).length > 0) e.tiers = tiers;
  }
  return e;
}

/** Valor > 0 digitado, ou null. */
function positive(txt: string): number | null {
  const v = parseNum(txt);
  return v != null && !Number.isNaN(v) && v > 0 ? v : null;
}

/** "Atingir", premiacao (% sobre o total vendido) e bonus de cada nivel sobre uma base (meta global ou meta do grupo). */
function tierResults(
  tiers: TierRow[],
  base: number | null,
): {
  atingir: number | null;
  commission: number | null;
  bonus: number | null;
  /** Bonus somados ate este nivel (bateu o 2 = bonus do 1 + do 2). */
  bonusTotal: number;
}[] {
  let accumulated = 0;
  return tiers.map((t) => {
    const m = positive(t.goal);
    const atingir = m != null && base ? (base * m) / 100 : null;
    const c = positive(t.commission);
    const commission = c != null && atingir != null ? (atingir * c) / 100 : null;
    const bonus = positive(t.bonus);
    accumulated += bonus ?? 0;
    return { atingir, commission, bonus, bonusTotal: accumulated };
  });
}

/** Premiacao da gerencia no nivel `i`: % da venda da loja quando a loja atinge o nivel, + bonus somados. */
function managerResult(
  tiers: TierRow[],
  i: number,
  atingir: number | null,
): { commission: number | null; bonus: number | null; bonusTotal: number } {
  const c = positive(tiers[i]!.mgrCommission);
  const bonusTotal = tiers
    .slice(0, i + 1)
    .reduce((s, t) => s + (positive(t.mgrBonus) ?? 0), 0);
  return {
    commission: c != null && atingir != null ? (atingir * c) / 100 : null,
    bonus: positive(tiers[i]!.mgrBonus),
    bonusTotal,
  };
}

/** "bonus de R$ X". A soma dos niveis ("total de R$ Y") so entra na simulacao. */
function bonusItems(bonus: number | null, total: number, byPerson = false, sum = false): ReactNode[] {
  if (total <= 0) return [];
  const suffix = byPerson ? " por pessoa" : "";
  const amount = (v: number) => <span className="font-mono font-semibold text-ok">{brlCent(v)}</span>;
  const items: ReactNode[] = [];
  if (bonus != null) items.push(<>bônus de {amount(bonus)}{suffix}</>);
  if (sum && total > (bonus ?? 0)) items.push(<>total de {amount(total)}{suffix}</>);
  return items;
}

let groupEditSeq = 1;
/**
 * Grava o % digitado num grupo e distribui o que falta para 100% entre os grupos automaticos
 * (sem edicao manual). Sem grupo automatico, quem se ajusta e o editado ha mais tempo.
 */
function distributeGroups(
  gs: GroupRow[],
  key: string,
  pct: string,
): GroupRow[] {
  const rows = gs.map((g) =>
    g.key === key ? { ...g, pct, editedAt: groupEditSeq++ } : g,
  );
  const others = rows.filter((g) => g.key !== key);
  if (others.length === 0) return rows;
  let autos = others.filter((g) => g.editedAt === 0);
  if (autos.length === 0) {
    const maisOld = others.reduce((a, b) =>
      b.editedAt < a.editedAt ? b : a,
    );
    autos = [maisOld];
  }
  const autoKeys = new Set(autos.map((g) => g.key));
  const manual = rows
    .filter((g) => !autoKeys.has(g.key))
    .reduce((s, g) => s + (groupPct(g) ?? 0), 0);
  const resto = Math.max(0, Math.round((100 - manual) * 10));
  const parte = Math.floor(resto / autos.length);
  let surplus = resto - parte * autos.length;
  return rows.map((g) => {
    if (!autoKeys.has(g.key)) return g;
    const decimos = parte + (surplus-- > 0 ? 1 : 0);
    return { ...g, pct: numText(decimos / 10), editedAt: 0 };
  });
}

/** % informado > 0, ou null. */
function groupPct(g: GroupRow): number | null {
  const v = parseNum(g.pct);
  return v != null && !Number.isNaN(v) && v > 0 ? v : null;
}
/** Meta do grupo (R$) = % x meta global. */
function groupTarget(g: GroupRow, target: number | null): number | null {
  const v = groupPct(g);
  return v != null && target ? (target * v) / 100 : null;
}

let nextKey = 1;
const newTier = (index: number, goal = "", commission = ""): TierRow => ({
  key: nextKey++,
  name: `Nível ${index + 1}`,
  goal,
  commission,
  bonus: "",
  mgrCommission: "",
  mgrBonus: "",
});

const DEFAULT_TIERS = () => [
  newTier(0, "100", "1,5"),
  newTier(1, "120", "2"),
  newTier(2, "150", "2,5"),
  newTier(3, "180", "3"),
];

/** Performance > Metas > criar / editar — informacoes gerais a esquerda; grupos, premiacao progressiva e simulacao em 3 cards. */
export default function GoalEditorPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  /** Duplicar: nova meta com a configuracao desta. `for=store` = mesmas datas, outra loja; senao periodo seguinte. */
  const copyId = id ? null : searchParams.get("copy");
  const copyForStore = Boolean(copyId) && searchParams.get("for") === "store";
  const navigate = useNavigate();
  const location = useLocation();
  const session = useActiveSession();
  const toast = useToast();
  const title = id ? "Editar meta" : "Nova meta";
  const origin = goalBackPath(location.state);
  const back = () => navigate(id ? paths.goalDetail(id) : origin, id ? { state: location.state } : undefined);

  const { scope } = useScope();
  const storeRows = useMemo(
    () => storesForSession(session.stores),
    [session.stores],
  );
  const [storeId, setStoreId] = useState(
    () => (copyForStore ? "" : scope.storeIds[0] ?? (storeRows.length === 1 ? storeRows[0]!.id : "")),
  );
  const storeFilter = scope.storeIds[0];
  useReturnWhenStoreChanges(id ? storeId || undefined : undefined, origin);
  useEffect(() => {
    if (!id && !copyForStore && storeFilter) setStoreId(storeFilter);
  }, [id, storeFilter, copyForStore]);
  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState<Date | null>(null);
  const [endsOn, setEndsOn] = useState<Date | null>(null);
  const [target, setTarget] = useState("");
  const [groupsOn, setGroupsOn] = useState(false);
  const [tiersOn, setTiersOn] = useState(false);
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [tiers, setTiers] = useState<TierRow[]>(DEFAULT_TIERS);
  const [managerOn, setManagerOn] = useState(false);
  const [prizeMode, setPrizeMode] = useState<PrizeMode>("INDIVIDUAL");
  /** % gravado de cada grupo (edicao); aplicado quando os grupos da loja carregam. */
  const savedGroups = useRef<GoalGroup[]>([]);
  const applySavedGroups = (rows: GroupRow[]): GroupRow[] =>
    rows.map((r) => {
      const name = r.name.trim().toLocaleUpperCase("pt-BR");
      const s =
        savedGroups.current.find((x) => x.shiftId === r.key) ??
        savedGroups.current.find((x) => x.name.trim().toLocaleUpperCase("pt-BR") === name);
      return s ? { ...r, pct: numText(s.pct), editedAt: groupEditSeq++ } : r;
    });
  const [copiedFrom, setCopiedFrom] = useState<{ name: string; target: number; forStore?: boolean } | null>(null);
  const [sourceStoreId, setSourceStoreId] = useState<string | null>(null);
  const sourceId = id ?? copyId;
  const targetStores = useMemo(
    () => (copyForStore && sourceStoreId ? storeRows.filter((l) => l.id !== sourceStoreId) : storeRows),
    [copyForStore, sourceStoreId, storeRows],
  );
  /** Loja ja definida (StorePicker numa loja, usuario de 1 loja ou edicao): combo aparece bloqueado. Copia para outra loja deixa livre. */
  const fixedStore = copyForStore
    ? targetStores.length === 1
    : Boolean(id) || Boolean(storeFilter) || storeRows.length === 1;
  const storeHint = id
    ? "A filial não pode ser alterada depois que a meta é criada."
    : copyForStore
      ? "Escolha a filial de destino."
      : storeFilter && storeRows.length > 1
        ? "Para escolher outra filial, selecione Todas as filiais no topo."
        : undefined;
  useEffect(() => {
    if (!sourceId) return;
    let cancelled = false;
    void fetchGoal(session.tenantId, sourceId).then((g) => {
      if (cancelled || !g) return;
      if (copyId) {
        if (copyForStore) {
          setSourceStoreId(g.storeId);
          const others = storeRows.filter((l) => l.id !== g.storeId);
          const destination =
            storeFilter && storeFilter !== g.storeId ? storeFilter : others.length === 1 ? others[0]!.id : "";
          setStoreId(destination);
          setName(g.name);
          setStartsOn(isoToDate(g.startsOn));
          setEndsOn(isoToDate(g.endsOn));
          setTarget(numText(g.target, "R$"));
          setCopiedFrom({ name: g.name, target: g.target, forStore: true });
        } else {
          setSourceStoreId(null);
          const period = nextGoalPeriod(g.startsOn, g.endsOn);
          setStoreId(storeFilter ?? g.storeId);
          setName(copyGoalName(g.name, period.startsOn));
          setStartsOn(isoToDate(period.startsOn));
          setEndsOn(isoToDate(period.endsOn));
          setTarget("");
          setCopiedFrom({ name: g.name, target: g.target });
        }
      } else {
        setStoreId(g.storeId);
        setName(g.name);
        setStartsOn(isoToDate(g.startsOn));
        setEndsOn(isoToDate(g.endsOn));
        setTarget(numText(g.target, "R$"));
      }
      setPrizeMode(g.tierMode);
      if (g.tiers.length > 0) {
        setTiersOn(true);
        setTiers(
          g.tiers.map((t, i) => ({
            ...newTier(i, numText(t.minAttainmentPct), numText(t.commissionPct)),
            name: t.name,
            bonus: t.bonus > 0 ? numText(t.bonus, "R$") : "",
            mgrCommission: t.managerPct != null && t.managerPct > 0 ? numText(t.managerPct) : "",
            mgrBonus: t.managerBonus != null && t.managerBonus > 0 ? numText(t.managerBonus, "R$") : "",
          })),
        );
        setManagerOn(g.tiers.some((t) => t.managerPct != null));
      }
      savedGroups.current = g.groups;
      if (g.groups.length > 0 && g.tierMode !== "GENERAL") {
        setGroupsOn(true);
        setGroups((gs) => gs && applySavedGroups(gs));
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a loja do filtro so vale no momento em que a copia abre
  }, [sourceId, copyId, copyForStore, session.tenantId]);

  const [team, setTeam] = useState<GoalTeamMember[] | null>(null);
  useEffect(() => {
    setTeam(null);
    setGroups(null);
    if (!storeId) return;
    let cancelled = false;
    void fetchGoalTeam(session.tenantId, [storeId]).then((t) => {
      if (!cancelled) setTeam(t.filter((m) => m.salesPerson));
    });
    void fetchStoreShifts(session.tenantId, storeId).then((shifts) => {
      if (!cancelled)
        setGroups(
          applySavedGroups(
            shifts.map((s) => ({
              key: s.id,
              name: s.name,
              pct: "",
              editedAt: 0,
            })),
          ),
        );
    });
    return () => {
      cancelled = true;
    };
  }, [session.tenantId, storeId]);
  const teamSize = team?.length ?? null;

  const parsedTarget = parseNum(target);
  const targetValue =
    parsedTarget != null && !Number.isNaN(parsedTarget) && parsedTarget > 0
      ? parsedTarget
      : null;
  /** Erros so aparecem depois da 1 tentativa de salvar; dai somem conforme o campo e corrigido. */
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [overlap, setOverlap] = useState(false);
  useEffect(() => setOverlap(false), [startsOn, endsOn, storeId]);
  const fields = {
    name,
    startsOn,
    endsOn,
    storeId,
    target: targetValue,
    groupsOn,
    groups,
    tiersOn,
    tiers,
    managerOn,
  };
  const errors: FormErrors = tried ? validateGoal(fields) : {};
  const overlapMsg = "Já existe uma meta desta filial nesse período.";
  const dateError = (e?: string) => e ?? (overlap ? overlapMsg : undefined);

  const submit = async () => {
    setTried(true);
    if (Object.keys(validateGoal(fields)).length > 0) {
      toast.show("Revise os campos destacados.", "danger");
      return;
    }
    setSaving(true);
    const res = await saveGoal(session.tenantId, id ?? null, {
      storeId,
      name,
      startsOn: dateToIso(startsOn!),
      endsOn: dateToIso(endsOn!),
      target: targetValue!,
      tierMode: prizeMode,
      tiers: tiersOn
        ? tiers.map((t, i) => ({
            name: t.name.trim() || `Nível ${i + 1}`,
            minAttainmentPct: positive(t.goal)!,
            commissionPct: positive(t.commission)!,
            bonus: positive(t.bonus) ?? 0,
            ...(managerOn
              ? { managerPct: positive(t.mgrCommission)!, managerBonus: positive(t.mgrBonus) ?? 0 }
              : {}),
          }))
        : [],
      groups:
        prizeMode !== "GENERAL" && groupsOn && groups
          ? groups.map((g) => ({
              shiftId: g.key,
              name: g.name,
              pct: groupPct(g) ?? 0,
            }))
          : [],
    });
    setSaving(false);
    if (!res.ok) {
      if (res.reason === "overlap") {
        setOverlap(true);
        toast.show(overlapMsg, "danger");
      } else toast.show(SAVE_ERROR_MSG, "danger");
      return;
    }
    toast.show(id ? "Alterações salvas." : "Meta criada.", "success");
    navigate(paths.goalDetail(res.id), { state: location.state });
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          icon={<Icon d={icons.arrowLeft} size={14} />}
          onClick={back}
        >
          Voltar
        </Button>
        <Breadcrumbs
          items={[
            { label: "Performance" },
            { label: "Metas", to: paths.goals },
            { label: title },
          ]}
        />
      </div>
      <div className="mb-5">
        <h1 className="text-[22px] font-extrabold tracking-tight text-t0">
          {title}
        </h1>
        {copiedFrom && (
          <p className="mt-1 text-[13px] text-t2">
            Cópia de <span className="font-semibold text-t1">{copiedFrom.name}</span>
            {copiedFrom.forStore ? " · mesma configuração para outra filial" : ""}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Informações gerais</CardTitle>
          </CardHeader>
          <div className="flex flex-col gap-4">
            <FormField label="Nome da meta" required error={errors.name}>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Meta outubro 2026"
                className={errors.name ? "border-bad!" : undefined}
              />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                label="Data de início"
                required
                error={dateError(errors.startsOn)}
              >
                <DatePicker
                  value={startsOn}
                  onChange={(d) => {
                    setStartsOn(d);
                    if (endsOn && endsOn < d) setEndsOn(null);
                  }}
                  invalid={Boolean(dateError(errors.startsOn))}
                  aria-label="Data de início"
                />
              </FormField>
              <FormField
                label="Data de fim"
                required
                error={overlap ? undefined : errors.endsOn}
              >
                <DatePicker
                  value={endsOn}
                  onChange={setEndsOn}
                  minDate={startsOn}
                  invalid={Boolean(dateError(errors.endsOn))}
                  aria-label="Data de fim"
                />
              </FormField>
            </div>
            <FormField label="Filial" required error={errors.storeId} hint={storeHint}>
              <Select
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                disabled={fixedStore}
                className={cn(
                  !storeId && "text-t2",
                  fixedStore && "cursor-not-allowed opacity-60",
                  errors.storeId && "border-bad!",
                )}
              >
                {!storeId && <option value="">Selecione a loja</option>}
                {targetStores.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.tradeName} · Filial {l.branchCode}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField
              label="Meta da filial"
              required
              error={errors.target}
            >
              <NumberInput
                value={target}
                onChange={setTarget}
                unit="R$"
                invalid={Boolean(errors.target)}
                autoFocus={Boolean(copyId)}
                aria-label="Meta da filial"
              />
              {copiedFrom && !copiedFrom.forStore && (
                <p className="mt-1.5 text-[12px] text-t2">
                  Meta anterior: <span className="font-mono font-semibold text-t1">{brlCent(copiedFrom.target)}</span>
                </p>
              )}
              <GlobalSplit
                target={targetValue}
                teamSize={teamSize}
                byPerson={prizeMode === "INDIVIDUAL" && !(groupsOn && groups && groups.length > 0)}
              />
            </FormField>
            <FormField label="Modo de premiação" required>
              <Segmented<PrizeMode>
                options={[
                  { value: "INDIVIDUAL", label: "Individual" },
                  { value: "GROUP", label: "Grupo" },
                  { value: "GENERAL", label: "Geral" },
                ]}
                value={prizeMode}
                onChange={(v) => {
                  if (!v) return;
                  setPrizeMode(v);
                  if (v === "GENERAL") setGroupsOn(false);
                }}
              />
              <p className="mt-1.5 text-[11.5px] text-t2">{PRIZE_MODE_HELP[prizeMode]}</p>
            </FormField>
          </div>
        </Card>

        {prizeMode !== "GENERAL" && (
        <SideCard
          title="Distribuição por grupos"
          active={groupsOn}
          onToggle={setGroupsOn}
          emptyIcon="👥"
          emptyText="Distribua a meta da filial entre os grupos, como Manhã 60% e Tarde 40%."
        >
          <GroupsEditor
            storeId={storeId}
            groups={groups}
            setGroups={setGroups}
            team={team}
            target={targetValue}
            mode={prizeMode}
            onCreate={() => navigate(paths.management.team)}
            error={errors.groups}
          />
        </SideCard>
        )}
        <SideCard
          title="Níveis de premiação"
          active={tiersOn}
          onToggle={setTiersOn}
          emptyIcon="📈"
          emptyText="Crie níveis de atingimento com premiações crescentes, como 100%, 120% e 150% da meta."
          action={
            <Button
              variant="secondary"
              size="sm"
              icon={<Icon d={icons.plus} size={14} />}
              onClick={() => setTiers((ts) => [...ts, newTier(ts.length)])}
            >
              Nível
            </Button>
          }
        >
          <TiersEditor
            tiers={tiers}
            setTiers={setTiers}
            target={targetValue}
            errors={errors.tiers}
            mode={prizeMode}
            hasGroups={prizeMode !== "GENERAL" && Boolean(groupsOn && groups && groups.length > 0)}
            managerOn={managerOn}
            setManagerOn={setManagerOn}
          />
        </SideCard>
        <SideCard
          title="Simulação"
          active
          emptyIcon="🧮"
          emptyText="Informe a meta da filial para visualizar a simulação."
        >
          <Simulation
            storeId={storeId}
            groups={groups}
            team={team}
            tiers={tiers}
            tiersOn={tiersOn}
            target={targetValue}
            mode={prizeMode}
            teamToda={prizeMode === "GENERAL" || !groupsOn}
            managerOn={managerOn}
          />
        </SideCard>
      </div>

      <div className="mt-5 flex justify-end gap-2.5">
        <Button variant="outline" onClick={back}>
          Cancelar
        </Button>
        <Button onClick={() => void submit()} disabled={saving}>
          {saving ? "Salvando…" : id ? "Salvar alterações" : "Criar meta"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Meta global  team from sales active ofValue store. So no modo Individual without groups from distribuicao  - 
 * withValue groups a meta from each one vem do % do group; no modo Group a meta nao e dividida by person.
 */
function GlobalSplit({
  target,
  teamSize,
  byPerson,
}: {
  target: number | null;
  teamSize: number | null;
  byPerson: boolean;
}) {
  if (target == null || teamSize == null) return null;
  if (teamSize === 0) {
    return (
      <p className="mt-1.5 text-[12px] font-semibold text-warn">
        Nenhuma pessoa na equipe de vendas desta loja.
      </p>
    );
  }
  if (!byPerson) return null;
  return (
    <p className="mt-1.5 text-[12px] font-semibold text-acc">
      Meta individual: {brlCent(target / teamSize)} · {teamSize} {teamSize === 1 ? "pessoa" : "pessoas"} na equipe
    </p>
  );
}

function SideCard({
  title,
  active,
  onToggle,
  emptyIcon,
  emptyTitle,
  emptyText,
  action,
  children,
}: {
  title: string;
  active: boolean;
  /** Liga/desliga o recurso pela chave no cabecalho. */
  onToggle?: (v: boolean) => void;
  emptyIcon: string;
  emptyTitle?: string;
  emptyText: string;
  /** Botao no canto do cabecalho (so com o recurso ativo). */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="flex min-h-[320px] flex-col">
      <CardHeader className="items-center">
        <CardTitle>{title}</CardTitle>
        {((active && action) || onToggle) && (
          <div className="flex shrink-0 items-center gap-2.5">
            {active && action}
            {onToggle && <Switch checked={active} onChange={onToggle} />}
          </div>
        )}
      </CardHeader>
      {active ? (
        children
      ) : (
        <EmptyBlock
          icon={emptyIcon}
          title={emptyTitle}
          description={emptyText}
        />
      )}
    </Card>
  );
}

function RemoveButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Remover"
      className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] border border-line text-bad transition-colors hover:bg-bad-soft disabled:pointer-events-none disabled:opacity-40"
    >
      <Icon d={icons.trash} size={14} />
    </button>
  );
}

/** Grupos da loja (Gestao > Grupos): nome e lista fixos; muda so o valor e o tipo (% ou R$). Soma  100% da meta global. */
function GroupsEditor({
  storeId,
  groups,
  setGroups,
  team,
  target,
  mode,
  onCreate,
  error,
}: {
  storeId: string;
  groups: GroupRow[] | null;
  setGroups: (fn: (g: GroupRow[] | null) => GroupRow[] | null) => void;
  team: GoalTeamMember[] | null;
  target: number | null;
  mode: PrizeMode;
  onCreate: () => void;
  error?: string;
}) {
  if (!storeId) {
    return (
      <EmptyBlock
        icon="🏬"
        title="Selecione a filial"
        description="Os grupos vêm da filial escolhida em Informações gerais."
      />
    );
  }
  if (groups == null) {
    return (
      <div className="flex flex-col gap-3">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }
  if (groups.length === 0) {
    return (
      <>
        <EmptyBlock
          icon="👥"
          title="Nenhum grupo cadastrado"
          description="Crie os grupos em Equipe para distribuir a meta entre eles."
          action={
            <Button size="sm" onClick={onCreate}>
              Ir para Equipe
            </Button>
          }
        />
        {error && (
          <p className="text-center text-[11.5px] font-medium text-bad">
            {error}
          </p>
        )}
      </>
    );
  }

  const update = (key: string, pct: string) =>
    setGroups((gs) => gs && distributeGroups(gs, key, pct));
  const preenchidos = groups.filter((g) => groupPct(g) != null);
  const total = preenchidos.reduce((s, g) => s + (groupPct(g) ?? 0), 0);
  const totalTxt = `${numText(Math.round(total * 10) / 10)}%`;
  const passou = total > 100.005;
  const fechou = Math.abs(total - 100) < 0.005;

  return (
    <div className="flex flex-1 flex-col gap-3">
      <p className="text-[11.5px] text-t2">
        Informe o percentual de um grupo. O restante é distribuído
        automaticamente entre os demais. A soma precisa totalizar 100%.
      </p>
      {groups.map((g) => (
        <div key={g.key} className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-t0">
            {g.name}
          </p>
          <NumberInput
            value={g.pct}
            onChange={(v) => update(g.key, v)}
            unit="%"
            compact
            invalid={Boolean(error)}
            className="w-[92px] shrink-0"
            aria-label={`% da meta do grupo ${g.name}`}
          />
        </div>
      ))}

      {error ? (
        <p className="text-[12px] font-semibold text-bad">{error}</p>
      ) : (
        preenchidos.length > 0 && (
          <p
            className={cn(
              "text-[12px] font-semibold",
              passou ? "text-bad" : fechou ? "text-ok" : "text-warn",
            )}
          >
            {passou
              ? `Total ${totalTxt} · excede a meta da filial em ${numText(Math.round((total - 100) * 10) / 10)}%.`
              : fechou
                ? "Total 100% · distribuição completa."
                : `Total ${totalTxt} · faltam ${numText(Math.round((100 - total) * 10) / 10)}% para distribuir.`}
          </p>
        )
      )}

      <GroupsSimulation groups={groups} team={team} target={target} mode={mode} />
    </div>
  );
}

/** Meta de cada grupo e as pessoas dele (o grupo de cada pessoa é definido em Equipe). */
function GroupsSimulation({
  groups,
  team,
  target,
  mode,
}: {
  groups: GroupRow[];
  team: GoalTeamMember[] | null;
  target: number | null;
  mode: PrizeMode;
}) {
  const ids = new Set(groups.map((g) => g.key));
  const people = [...(team ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR"),
  );
  const withoutGroup = people.filter((p) => !p.shiftId || !ids.has(p.shiftId));
  const personRow = (p: GoalTeamMember, goal: string | null) => (
    <div
      key={`${p.storeId}:${p.employeeId}`}
      className="flex items-center gap-2.5 py-1"
    >
      <PersonAvatar name={p.name} employeeId={p.employeeId} storeId={p.storeId} size="sm" />
      <p className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-t0">
        {p.name}
      </p>
      {goal && (
        <span className="shrink-0 font-mono text-[12px] text-t1">{goal}</span>
      )}
    </div>
  );
  return (
    <div className="mt-auto rounded-[var(--radius-vela-md)] bg-bg-1 p-3">
      <p className="mb-2.5 text-[12.5px] font-bold text-t0">Simulação</p>
      {team == null ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-line">
          {groups.map((g) => {
            const goal = groupTarget(g, target);
            const pct = groupPct(g);
            const members = people.filter((p) => p.shiftId === g.key);
            const each =
              mode === "INDIVIDUAL" && goal != null && members.length > 0
                ? brlCent(goal / members.length)
                : null;
            return (
              <div key={g.key} className="py-2.5 first:pt-0 last:pb-0">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <p className="truncate text-[12.5px] font-bold text-t0">
                    {g.name}
                    {pct != null && (
                      <span className="font-semibold text-t2">
                        {" "}
                        · {numText(Math.round(pct * 10) / 10)}%
                      </span>
                    )}
                  </p>
                  <span className="shrink-0 font-mono text-[12.5px] font-semibold text-t0">
                    {goal != null ? brlCent(goal) : "—"}
                  </span>
                </div>
                {members.length === 0 ? (
                  <p className="text-[11.5px] text-warn">
                    Nenhuma pessoa neste grupo.
                  </p>
                ) : (
                  members.map((p) => personRow(p, each))
                )}
              </div>
            );
          })}
          {withoutGroup.length > 0 && (
            <div className="py-2.5 last:pb-0">
              <p className="mb-1 text-[12.5px] font-bold text-warn">
                Sem grupo definido
              </p>
              {withoutGroup.map((p) => personRow(p, null))}
              <p className="mt-1 text-[11.5px] text-warn">
                {withoutGroup.length === 1 ? "Fica" : "Ficam"} fora da distribuição
                por grupos. Defina o grupo em Equipe.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Informacoes do nivel: uma por linha quando o card e estreito (celular e colunas lado a lado no desktop); em linha com " | " no meio. */
function InfoLine({
  items,
  className,
}: {
  items: ReactNode[];
  className?: string;
}) {
  const visible = items.filter((it) => it != null && it !== false);
  return (
    <div
      className={cn(
        "flex flex-col text-[11.5px] text-t2 sm:flex-row sm:flex-wrap lg:flex-col",
        className,
      )}
    >
      {visible.map((it, i) => (
        <span key={i} className="max-sm:first-letter:uppercase lg:first-letter:uppercase">
          {i > 0 && <span className="hidden sm:inline lg:hidden">{" · "}</span>}
          {it}
        </span>
      ))}
    </div>
  );
}

/** Linha "rotulo + valor" do nivel. */
function TierField({
  label,
  value,
  unit,
  onChange,
  required = false,
  optional = false,
  error,
}: {
  label: string;
  value: string;
  unit: "%" | "R$";
  onChange: (v: string) => void;
  required?: boolean;
  optional?: boolean;
  error?: string;
}) {
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-x-2 gap-y-1">
      <span className="text-[12px] font-semibold text-t1">
        {label}
        {required && <span className="text-bad"> *</span>}
        {optional && !required && <span className="font-normal text-t2"> (opcional)</span>}
      </span>
      <NumberInput
        value={value}
        onChange={onChange}
        unit={unit}
        compact
        invalid={Boolean(error)}
        aria-label={label}
      />
      {error && (
        <p className="col-start-2 text-[11.5px] font-medium text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

function TiersEditor({
  tiers,
  setTiers,
  target,
  errors,
  mode,
  hasGroups,
  managerOn,
  setManagerOn,
}: {
  tiers: TierRow[];
  setTiers: (fn: (t: TierRow[]) => TierRow[]) => void;
  target: number | null;
  errors?: Record<number, TierErrors>;
  mode: PrizeMode;
  hasGroups: boolean;
  managerOn: boolean;
  setManagerOn: (v: boolean) => void;
}) {
  const update = (key: number, patch: Partial<TierRow>) =>
    setTiers((ts) => ts.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  const resultados = tierResults(tiers, target);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 text-[11.5px] text-t2">
        <p>
          <span className="font-semibold text-t1">Meta:</span> percentual
          necessário para alcançar o nível. Ex.: 120% = vender 20% acima da
          meta.
        </p>
        <p>
          <span className="font-semibold text-t1">Premiação:</span> percentual
          pago sobre as vendas quando o nível é alcançado.
        </p>
        <p>
          <span className="font-semibold text-t1">Bônus:</span> valor fixo
          adicional pago ao atingir o nível.
        </p>
        <p className="font-semibold text-t1">
          Os bônus dos níveis alcançados são acumulados.
        </p>
      </div>
      <div className="flex items-start justify-between gap-3 rounded-[var(--radius-vela-md)] bg-bg-inset px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[12.5px] font-bold text-t0">Premiação da gerência</p>
          <p className="mt-0.5 text-[11.5px] text-t2">
            Mesmos níveis da equipe. A gerência ganha o percentual sobre a venda da loja.
          </p>
        </div>
        <Switch checked={managerOn} onChange={setManagerOn} />
      </div>
      {tiers.map((t, i) => {
        const r = resultados[i]!;
        const mgr = managerOn ? managerResult(tiers, i, r.atingir) : null;
        return (
          <div
            key={t.key}
            className="flex flex-col gap-2.5 rounded-[var(--radius-vela-md)] border border-line p-3"
          >
            <div className="flex items-center gap-2">
              <Input
                value={t.name}
                onChange={(e) => update(t.key, { name: e.target.value })}
                placeholder={`Nível ${i + 1}`}
                className="h-9! min-w-0 flex-1"
                aria-label="Nome do nível"
              />
              <RemoveButton
                onClick={() =>
                  setTiers((ts) => ts.filter((x) => x.key !== t.key))
                }
                disabled={tiers.length <= 1}
              />
            </div>
            <TierField
              label="Meta"
              unit="%"
              value={t.goal}
              onChange={(goal) => update(t.key, { goal })}
              required
              error={errors?.[t.key]?.goal}
            />
            <TierField
              label="Premiação"
              unit="%"
              value={t.commission}
              onChange={(commission) => update(t.key, { commission })}
              required
              error={errors?.[t.key]?.commission}
            />
            <TierField
              label="Bônus"
              unit="R$"
              value={t.bonus}
              onChange={(bonus) => update(t.key, { bonus })}
              optional
            />
            {r.atingir != null && (
              <InfoLine
                items={[
                  <>
                    A partir de{" "}
                    <span className="font-mono text-t1">
                      {brlCent(r.atingir)}
                    </span>{" "}
                    na meta da loja
                  </>,
                  positive(t.commission) != null && (
                    <>
                      premiação de{" "}
                      <span className="font-semibold text-ok">
                        {numText(positive(t.commission)!)}%
                      </span>
                    </>
                  ),
                  ...bonusItems(r.bonus, r.bonusTotal),
                ]}
              />
            )}
            {managerOn && (
              <div className="flex flex-col gap-2.5 border-t border-line pt-2.5">
                <p className="text-[11px] font-bold uppercase tracking-wide text-t2">Gerência</p>
                <TierField
                  label="Premiação"
                  unit="%"
                  value={t.mgrCommission}
                  onChange={(mgrCommission) => update(t.key, { mgrCommission })}
                  required
                  error={errors?.[t.key]?.mgrCommission}
                />
                <TierField
                  label="Bônus"
                  unit="R$"
                  value={t.mgrBonus}
                  onChange={(mgrBonus) => update(t.key, { mgrBonus })}
                  optional
                />
                {mgr && (r.atingir != null || mgr.bonusTotal > 0) && (
                  <InfoLine
                    items={[
                      r.atingir != null && (
                        <>
                          A partir de{" "}
                          <span className="font-mono text-t1">{brlCent(r.atingir)}</span> na meta da loja
                        </>
                      ),
                      positive(t.mgrCommission) != null && (
                        <>
                          premiação de{" "}
                          <span className="font-semibold text-ok">{numText(positive(t.mgrCommission)!)}%</span>
                        </>
                      ),
                      ...bonusItems(mgr.bonus, mgr.bonusTotal),
                    ]}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}

      {target != null && (
        <Alert variant="warning">
          {mode === "GENERAL" ? (
            <>
              Os percentuais são aplicados à{" "}
              <span className="font-semibold">meta da loja</span>. A equipe
              sobe de nível pelo total vendido da loja. Faturamento e nº de
              vendas de cada pessoa são a parte igual desse total. A premiação
              é dividida igualmente e o bônus vale para cada uma.
            </>
          ) : mode === "INDIVIDUAL" ? (
            <>
              Os percentuais dos níveis são aplicados à{" "}
              <span className="font-semibold">meta individual</span> de cada
              pessoa. A premiação é calculada sobre as próprias vendas, sem
              teto.{" "}
              {hasGroups
                ? "Meta individual = meta do grupo ÷ pessoas do grupo."
                : "Meta individual = meta da filial ÷ pessoas da equipe."}
            </>
          ) : hasGroups ? (
            <>
              Os percentuais são aplicados à{" "}
              <span className="font-semibold">meta de cada grupo</span>. O
              grupo sobe de nível pela soma das vendas, a premiação é dividida
              igualmente entre as pessoas e o bônus vale para cada uma.
            </>
          ) : (
            <>
              Os percentuais são aplicados à{" "}
              <span className="font-semibold">meta da loja</span>. A equipe
              sobe de nível pela soma das vendas, a premiação é dividida
              igualmente entre as pessoas e o bônus vale para cada uma.
            </>
          )}
          {managerOn && (
            <>
              {" "}A <span className="font-semibold">gerência</span> sobe pelos
              mesmos níveis, medidos na meta da loja, e ganha o percentual de
              cada nível sobre a venda da loja, incluindo vendas sem vendedor
              identificado ou realizadas pela gerência.
            </>
          )}
        </Alert>
      )}
    </div>
  );
}

function Simulation({
  storeId,
  groups: groupsAll,
  team,
  tiers,
  tiersOn,
  target,
  mode,
  teamToda,
  managerOn,
}: {
  storeId: string;
  /** null = grupos da loja ainda carregando. */
  groups: GroupRow[] | null;
  team: GoalTeamMember[] | null;
  tiers: TierRow[];
  /** Niveis desligados: a simulacao mostra so a meta, sem premiação. */
  tiersOn: boolean;
  target: number | null;
  mode: PrizeMode;
  /** Sem distribuicao por grupos: a equipe toda e um bloco so. Individual divide a meta da loja; Grupo e Geral usam a meta da loja. */
  teamToda: boolean;
  managerOn: boolean;
}) {
  const individual = mode === "INDIVIDUAL";
  const groups = teamToda
    ? target != null
      ? [
          {
            key: "equipe-toda",
            name: "Equipe toda",
            pct: null,
            groupGoal: target,
            people: team?.length ?? 0,
            base:
              individual && (team?.length ?? 0) > 0
                ? target / team!.length
                : individual
                  ? null
                  : target,
          },
        ]
      : []
    : (groupsAll ?? [])
    .map((g) => {
      const groupGoal = groupTarget(g, target);
      const people = team?.filter((m) => m.shiftId === g.key).length ?? 0;
      const base =
        groupGoal == null
          ? null
          : individual
            ? people > 0
              ? groupGoal / people
              : null
            : groupGoal;
      return {
        key: g.key,
        name: g.name,
        pct: groupPct(g),
        groupGoal,
        people,
        base,
      };
    })
    .filter((g) => g.groupGoal != null);
  const hasLevel = tiersOn && tiers.some((t) => positive(t.goal) != null);

  if (!storeId) {
    return (
      <EmptyBlock
        icon="🏬"
        title="Selecione a filial"
        description="A simulação usa a equipe e os grupos da filial escolhida em Informações gerais."
      />
    );
  }
  if (!target) {
    return (
      <EmptyBlock
        icon="🧮"
        title="Falta a meta da filial"
        description="Informe a meta da filial para simular os valores."
      />
    );
  }
  if (team == null || (!teamToda && groupsAll == null)) {
    return (
      <div className="flex flex-col gap-3">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-40 w-full" />
        ))}
      </div>
    );
  }
  if (!teamToda && groupsAll!.length === 0) {
    return (
      <EmptyBlock
        icon="🧮"
        title="Nenhum grupo cadastrado"
        description="Crie os grupos da filial para visualizar a simulação."
      />
    );
  }
  if (!teamToda && groups.length === 0) {
    return (
      <EmptyBlock
        icon="🧮"
        title="Faltam dados"
        description="Informe o percentual de pelo menos um grupo."
      />
    );
  }
  const membersOf = (key: string) =>
    (teamToda ? (team ?? []) : (team ?? []).filter((p) => p.shiftId === key))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11.5px] text-t2">
        {hasLevel
          ? individual
            ? "Premiação de cada pessoa calculada sobre a própria meta individual."
            : teamToda
              ? "Premiação da equipe calculada sobre a meta da filial e dividida igualmente entre as pessoas."
              : "Premiação do grupo calculada sobre a meta do grupo e dividida igualmente entre as pessoas."
          : individual
            ? teamToda
              ? "Meta individual de cada pessoa, com a meta da filial dividida pela equipe."
              : "Meta individual de cada pessoa, com a meta do grupo dividida pelas pessoas do grupo."
            : teamToda
              ? "Meta da filial para a equipe toda."
              : "Meta de cada grupo conforme a distribuição."}
      </p>
      {groups.map((g) => {
        const resultados = g.base != null ? tierResults(tiers, g.base) : [];
        return (
          <div
            key={g.key}
            className="rounded-[var(--radius-vela-md)] bg-bg-1 p-3"
          >
            <p className="truncate text-[13.5px] font-bold text-acc">
              {g.name}
              {g.pct != null && ` · ${numText(Math.round(g.pct * 10) / 10)}%`}
            </p>
            <p className="mb-2.5 mt-0.5 text-[11.5px] text-t2">
              {mode === "GENERAL" ? "Meta da filial" : individual ? "Meta individual" : "Meta do grupo"}:{" "}
              <span className="font-mono text-t1">
                {g.base != null ? brlCent(g.base) : "—"}
              </span>
              {" · "}
              {g.people} {g.people === 1 ? "pessoa" : "pessoas"}
            </p>
            {g.base == null || g.people === 0 ? (
              <p className="text-[11.5px] text-warn">
                {teamToda
                  ? "Nenhuma pessoa na equipe de vendas desta filial."
                  : "Nenhuma pessoa neste grupo."}
              </p>
            ) : hasLevel ? (
              <div className="flex flex-col gap-1">
                {tiers.map((t, i) => {
                  const r = resultados[i]!;
                  if (r.atingir == null) return null;
                  const pct = positive(t.goal);
                  const taxa = positive(t.commission);
                  return (
                    <div
                      key={t.key}
                      className="rounded-lg bg-bg-2 px-2.5 py-1.5 text-[12px]"
                    >
                      <p className="truncate">
                        <span className="font-semibold text-t0">
                          {t.name.trim() || `Nível ${i + 1}`}
                        </span>
                        {pct != null && (
                          <span className="text-t2"> · {numText(pct)}%</span>
                        )}
                      </p>
                      <InfoLine
                        className="mt-0.5"
                        items={[
                          <>
                            A partir de{" "}
                            <span className="font-mono text-t1">
                              {brlCent(r.atingir)}
                            </span>
                          </>,
                          taxa != null && (
                            <>
                              premiação de{" "}
                              <span className="font-semibold text-ok">
                                {numText(taxa)}% das vendas
                              </span>
                            </>
                          ),
                          taxa != null && r.commission != null && (individual || g.people > 0) && (
                            <>
                              <span className="font-mono font-semibold text-ok">
                                {brlCent(individual ? r.commission : r.commission / g.people)}
                              </span>{" "}
                              por pessoa
                            </>
                          ),
                          ...bonusItems(r.bonus, r.bonusTotal, true, true),
                        ]}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col">
                {membersOf(g.key).map((p) => (
                  <div key={`${p.storeId}:${p.employeeId}`} className="flex items-center gap-2.5 py-1">
                    <PersonAvatar name={p.name} employeeId={p.employeeId} storeId={p.storeId} size="sm" />
                    <p className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-t0">{p.name}</p>
                    {individual && g.base != null && (
                      <span className="shrink-0 font-mono text-[12px] text-t1">{brlCent(g.base)}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {tiersOn && !hasLevel && (
        <p className="text-[11.5px] text-t2">
          Informe a meta de pelo menos um nível para simular a premiação.
        </p>
      )}
      {hasLevel && managerOn && <ManagerSimulation tiers={tiers} target={target} />}
    </div>
  );
}

/** Mesmo formato da equipe, sobre a venda da loja. A soma dos bonus aparece aqui. */
function ManagerSimulation({ tiers, target }: { tiers: TierRow[]; target: number }) {
  const resultados = tierResults(tiers, target);
  return (
    <div className="rounded-[var(--radius-vela-md)] bg-bg-1 p-3">
      <p className="truncate text-[13.5px] font-bold text-acc">Gerência</p>
      <p className="mb-2.5 mt-0.5 text-[11.5px] text-t2">
        Meta da loja: <span className="font-mono text-t1">{brlCent(target)}</span>
        {" · "}premiação sobre a venda da loja
      </p>
      <div className="flex flex-col gap-1">
        {tiers.map((t, i) => {
          const r = resultados[i]!;
          const mgr = managerResult(tiers, i, r.atingir);
          if (r.atingir == null) return null;
          const pct = positive(t.goal);
          const taxa = positive(t.mgrCommission);
          return (
            <div key={t.key} className="rounded-lg bg-bg-2 px-2.5 py-1.5 text-[12px]">
              <p className="truncate">
                <span className="font-semibold text-t0">{t.name.trim() || `Nível ${i + 1}`}</span>
                {pct != null && <span className="text-t2"> · {numText(pct)}%</span>}
              </p>
              <InfoLine
                className="mt-0.5"
                items={[
                  <>
                    A partir de <span className="font-mono text-t1">{brlCent(r.atingir)}</span>
                  </>,
                  taxa != null && (
                    <>
                      premiação de <span className="font-semibold text-ok">{numText(taxa)}%</span> da venda da loja
                    </>
                  ),
                  taxa != null && mgr.commission != null && (
                    <span className="font-mono font-semibold text-ok">{brlCent(mgr.commission)}</span>
                  ),
                  ...bonusItems(mgr.bonus, mgr.bonusTotal, false, true),
                ]}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
