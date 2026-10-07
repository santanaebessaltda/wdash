import { Badge, Card } from "@/components/ui";
import { GoalLevelsBar } from "@/components/wedash/GoalLevelsBar";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { brlCent } from "@/data/wedash/engine/format";
import { dataCurta } from "@/lib/format";
import type { SellerHomeStore } from "@/data/wedash/engine/sellerHome";

type Goal = NonNullable<SellerHomeStore["goal"]>;

/** Premiacao do vendedor numa loja: ate agora, nivel, barra, falta, ao chegar e projecao. */
export function PrizeCard({ store, embedded = false }: { store: SellerHomeStore; embedded?: boolean }) {
  const goal = store.goal;
  const body = (
    <>
      {!embedded && <h2 className="text-[15px] font-bold text-t0">{store.storeName}</h2>}
      {!goal ? (
        <EmptyBlock icon="🎯" title="Meta não configurada" description="Quando a meta da loja for cadastrada, ela aparecerá aqui." />
      ) : !goal.me ? (
        <p className="py-6 text-center text-[13.5px] text-t1">
          Você ainda não está em um grupo desta meta. Fale com a gerência da loja.
        </p>
      ) : (
        <PrizeBody goal={goal} me={goal.me} />
      )}
    </>
  );
  if (embedded) return body;
  return <Card className="flex flex-col">{body}</Card>;
}

function PrizeBody({ goal, me }: { goal: Goal; me: NonNullable<Goal["me"]> }) {
  const nivel = me.nivelNumero != null && me.nivel ? `N${me.nivelNumero} · ${me.nivel}` : null;
  const proximo = me.proximo ? `N${me.proximo.numero} · ${me.proximo.nome}` : null;
  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold text-t2">Sua premiação até agora</p>
          <p className="font-mono text-[26px] font-extrabold text-t0">{brlCent(me.premiacao + me.bonus)}</p>
        </div>
        {nivel && <Badge variant="accent">{nivel}</Badge>}
      </div>
      <div className="overflow-x-auto">
        <GoalLevelsBar pct={me.atingimentoPct} marcos={me.marcos} completo />
      </div>
      {proximo ? (
        <div className="flex flex-col gap-1 text-[13px] text-t1">
          <p>Faltam {brlCent(me.proximo!.falta)} para {proximo}</p>
          {goal.nextLevelGain != null && <p>Ao chegar: +{brlCent(goal.nextLevelGain)} em premiação</p>}
        </div>
      ) : (
        <p className="text-[13px] font-semibold text-ok">Você chegou ao último nível da meta.</p>
      )}
      {goal.projectedPrize != null && (
        <div>
          <p className="text-[13px] font-semibold text-t1">Projeção: {brlCent(goal.projectedPrize)} até {dataCurta(goal.endsOn)}</p>
          <p className="text-[12.5px] text-t2">Se mantiver o ritmo atual.</p>
        </div>
      )}
    </div>
  );
}
