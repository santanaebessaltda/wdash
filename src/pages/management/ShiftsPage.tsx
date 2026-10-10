import { useEffect, useState } from "react";
import { Button, Card, EmptyState, Input, Modal, useToast } from "@/components/ui";
import { ShiftRowsSkeleton, StoreCardsSkeleton } from "@/components/wedash/LoadingSkeletons";
import {
  deleteStoreShift,
  fetchStoreSellers,
  fetchStoreShifts,
  isActiveSalesPerson,
  saveStoreShift,
  type Store,
  type StoreShift,
} from "@/data/wedash/stores";
import { Icon, icons } from "@/pages/users/Icons";
import { shiftName } from "@/lib/format";
import { FormActions, SAVE_ERROR_MSG, StoreCardHeader, StoreCardsPage, TimeSelect, nextHalfHour, useScopedStores } from "@/pages/operation/shared";

/** Linha editavel; `id` ausente = turno novo ainda nao salvo. */
type ShiftDraft = { key: string; id?: string; name: string; start: string; end: string };

const toDraft = (s: StoreShift): ShiftDraft => ({ key: s.id, id: s.id, name: s.name, start: s.start, end: s.end });
const toShift = (d: ShiftDraft): StoreShift => ({ id: d.id ?? "", name: shiftName(d.name), start: d.start, end: d.end });

/** Configurações > Grupos. O grupo de cada pessoa fica em Vendedores. */
export function ShiftsPage() {
  const { session, lojas, loading } = useScopedStores();
  return (
    <StoreCardsPage
      section="Operação"
      title="Grupos"
      subtitle="Configure os grupos de cada loja. O grupo de cada vendedor é definido em Vendedores."
      loading={loading}
      skeleton={(n) => <StoreCardsSkeleton count={n} shifts />}
      lojas={lojas}
      oneStore
    >
      {(loja) => <ShiftsCard tenantId={session.tenantId} loja={loja} />}
    </StoreCardsPage>
  );
}

const sameShifts = (drafts: ShiftDraft[], list: StoreShift[]) => JSON.stringify(drafts.map(toShift)) === JSON.stringify(list);

function ShiftsCard({ tenantId, loja }: { tenantId: string; loja: Store }) {
  const { show } = useToast();
  const [saved, setSaved] = useState<StoreShift[]>([]);
  const [shifts, setShifts] = useState<ShiftDraft[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Vendedores (equipe de vendas ativa) por grupo salvo. */
  const [membros, setMembros] = useState<Map<string, number>>(new Map());
  const [confirmar, setConfirmar] = useState<ShiftDraft | null>(null);
  const dirty = !sameShifts(shifts, saved);
  const removidos = saved.filter((old) => !shifts.some((s) => s.id === old.id));

  function applySaved(list: StoreShift[]) {
    setSaved(list);
    setShifts(list.map(toDraft));
  }

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchStoreShifts(tenantId, loja.id), fetchStoreSellers(tenantId, [loja.id])]).then(([list, sellers]) => {
      if (cancelled) return;
      const contagem = new Map<string, number>();
      for (const s of sellers.get(loja.id) ?? []) {
        if (s.shiftId && isActiveSalesPerson(s)) contagem.set(s.shiftId, (contagem.get(s.shiftId) ?? 0) + 1);
      }
      setMembros(contagem);
      applySaved(list);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [tenantId, loja.id]);

  function remove(s: ShiftDraft) {
    setShifts((list) => list.filter((x) => x.key !== s.key));
  }

  function pedirExclusao(s: ShiftDraft) {
    if (s.id && (membros.get(s.id) ?? 0) > 0) setConfirmar(s);
    else remove(s);
  }

  const qtdConfirmar = confirmar?.id ? (membros.get(confirmar.id) ?? 0) : 0;
  const nomeConfirmar = confirmar ? shiftName(saved.find((x) => x.id === confirmar.id)?.name ?? confirmar.name) : "";

  function add() {
    const start = shifts[shifts.length - 1]?.end ?? "09:00";
    setShifts([...shifts, { key: crypto.randomUUID(), name: "", start, end: nextHalfHour(start) }]);
  }

  function change(key: string, patch: Partial<ShiftDraft>) {
    setShifts(shifts.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  async function save() {
    const nomes = new Set<string>();
    for (const s of shifts) {
      const nome = s.name.trim();
      if (!nome) return show("Dê um nome para cada grupo.", "danger");
      if (nomes.has(nome.toLowerCase())) return show(`Já existe um grupo chamado “${nome}”.`, "danger");
      nomes.add(nome.toLowerCase());
      if (s.start >= s.end) return show(`${nome}: o horário de início deve ser anterior ao horário de fim.`, "danger");
    }
    setSaving(true);
    let error: string | null = null;
    const keep = new Set(shifts.map((s) => s.id).filter(Boolean));
    for (const old of saved) {
      if (error || keep.has(old.id)) continue;
      const r = await deleteStoreShift(old.id);
      if (!r.ok) error = r.error;
    }
    for (const s of shifts) {
      if (error) break;
      const antes = saved.find((x) => x.id === s.id);
      if (antes && JSON.stringify(antes) === JSON.stringify(toShift(s))) continue;
      const r = await saveStoreShift({ tenantId, storeId: loja.id, shift: toShift(s) });
      if (!r.ok) error = r.error;
    }
    applySaved(await fetchStoreShifts(tenantId, loja.id));
    setSaving(false);
    if (error) show(SAVE_ERROR_MSG, "danger");
    else show("Alterações salvas.", "success");
  }

  return (
    <Card>
      <StoreCardHeader loja={loja} />
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {!loaded ? (
          <ShiftRowsSkeleton />
        ) : shifts.length === 0 ? (
          <EmptyState
            framed={false}
            className="py-4!"
            icon="👥"
            title="Nenhum grupo cadastrado"
            description="Crie os grupos da loja para organizar os vendedores e acompanhar o desempenho por grupo."
            action={
              <Button type="button" size="sm" icon={<Icon d={icons.plus} size={14} />} onClick={add}>
                Adicionar grupo
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-2.5">
            <p className="text-[12.5px] text-t2">Defina o horário em que cada grupo atua. Ele aparece junto ao grupo nas análises da equipe.</p>
            {shifts.map((s) => (
              <div key={s.key} className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-3">
                <Input
                  className="h-9! min-w-0 flex-1 basis-full sm:basis-auto"
                  placeholder="Nome do grupo"
                  value={s.name}
                  onChange={(e) => change(s.key, { name: e.target.value })}
                  aria-label="Nome do grupo"
                />
                <TimeSelect value={s.start} onChange={(v) => change(s.key, { start: v })} aria-label="Início" />
                <span className="text-t2">–</span>
                <TimeSelect value={s.end} onChange={(v) => change(s.key, { end: v })} aria-label="Fim" />
                <button
                  type="button"
                  onClick={() => pedirExclusao(s)}
                  aria-label="Excluir grupo"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-t2 hover:bg-bg-3 hover:text-bad"
                >
                  <Icon d={icons.trash} size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
        {shifts.length > 0 && (
          <button
            type="button"
            onClick={add}
            className="flex items-center gap-1.5 self-start text-[12.5px] font-semibold text-acc hover:underline"
          >
            <Icon d={icons.plus} size={14} />
            Adicionar grupo
          </button>
        )}
        {removidos.length > 0 && (
          <div className="flex flex-col gap-0.5 text-[12.5px] text-t2">
            {removidos.map((r) => (
              <p key={r.id}>
                <span className="font-semibold text-t1">{shiftName(r.name)}</span> será excluído ao salvar as alterações.
              </p>
            ))}
          </div>
        )}
        {(shifts.length > 0 || dirty) && <FormActions dirty={dirty} saving={saving} onReset={() => setShifts(saved.map(toDraft))} />}
      </form>
      <Modal
        open={confirmar !== null}
        onClose={() => setConfirmar(null)}
        title={`Excluir grupo ${nomeConfirmar}?`}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmar(null)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirmar) remove(confirmar);
                setConfirmar(null);
              }}
            >
              Excluir grupo
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-t1">
          {qtdConfirmar === 1 ? "1 vendedor ficará sem grupo definido." : `${qtdConfirmar} vendedores ficarão sem grupo definido.`}
        </p>
      </Modal>
    </Card>
  );
}

export default ShiftsPage;
