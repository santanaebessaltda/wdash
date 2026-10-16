import { useState, type ReactNode } from "react";
import { Button, Modal } from "@/components/ui";

export type SetupGuideScreen = "team" | "staff" | "goals" | "challenges";

const SCREEN_LEAD: Record<SetupGuideScreen, { title: string; body: string }> = {
  team: {
    title: "Nesta tela",
    body: "O ranking e o pódio mostram quem vende. Entra quem está ativo no Millennium com cargo Vendedor. Gerência, operador de caixa e o usuário da filial aparecem em Gestão > Equipe, mas não competem aqui.",
  },
  staff: {
    title: "Nesta tela",
    body: "A lista é o que a WDash leu no Millennium desta filial. Atualizar equipe busca de novo. Grupo e convite de acesso são da WDash: o cargo no Millennium não cria login.",
  },
  goals: {
    title: "Nesta tela",
    body: "A meta usa a mesma equipe de vendas. Quem está ativo com cargo Vendedor entra sozinho. Quem entra ou sai no meio do período participa só nos dias em que esteve na equipe.",
  },
  challenges: {
    title: "Nesta tela",
    body: "O desafio usa a mesma equipe de vendas. Quem está ativo com cargo Vendedor entra sozinho. No modo Quem atingir o mínimo, a marca acompanha os dias em que a pessoa esteve. Em Quem fizer mais, vale a venda do período, sem ratear.",
  },
};

/** Manual de como o funcionário do Millennium entra na equipe, na meta e no desafio. */
export function SetupGuide({ screen }: { screen: SetupGuideScreen }) {
  const [open, setOpen] = useState(false);
  const lead = SCREEN_LEAD[screen];
  return (
    <>
      <Button type="button" variant="outline" className="print:hidden" onClick={() => setOpen(true)}>
        Como configurar
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title="Como configurar o funcionário"
        footer={
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Fechar
          </Button>
        }
      >
        <div className="flex flex-col gap-5">
          <Block title={lead.title}>
            <p>{lead.body}</p>
          </Block>

          <Block title="Para competir na WDash">
            <p>No Millennium, deixe a pessoa neste padrão. Depois use Atualizar equipe para a WDash ler de novo.</p>
            <ul className="mt-2 list-disc space-y-1.5 pl-4">
              <Item>Cargo Vendedor.</Item>
              <Item>Inativo, Afastado e Não mostrar no evento desmarcados.</Item>
              <Item>O gerador da pessoa ativo. É o código que liga a venda a ela.</Item>
              <Item>Data de admissão preenchida. Sem ela, a meta e o mínimo do desafio usam o período inteiro.</Item>
              <Item>A pessoa cadastrada na filial certa.</Item>
            </ul>
          </Block>

          <Block title="Para desligar">
            <p>
              Desative o funcionário no Millennium. Qualquer um destes tira a pessoa da equipe ativa: Inativo, Afastado, Não mostrar no evento ou gerador desativado. O Millennium troca o cargo de Vendedor para indefinido, e a WDash mostra a pessoa em Desligados.
            </p>
            <p className="mt-2">
              Ela sai do ranking. Na meta e no desafio daquele período, fica só até o dia da saída: a meta fecha proporcional e ela para de dividir a premiação. Quem já estava desligado e não vendeu no período não entra.
            </p>
          </Block>

          <Block title="O que a WDash lê no Millennium">
            <div className="mt-1">
              <Field name="Cargo" detail="Vendedor entra no ranking, na meta e no desafio. Gerência e operador de caixa aparecem na equipe da filial e ficam de fora da disputa." />
              <Field name="Inativo" detail="Marcado, a pessoa fica desligada." />
              <Field name="Afastado" detail="Marcado, a pessoa fica desligada." />
              <Field name="Não mostrar no evento" detail="Marcado, a pessoa fica desligada." />
              <Field name="Gerador" detail="Desativado, a pessoa fica desligada. Ativo, este código amarra a venda à pessoa, mesmo se o nome mudar." />
              <Field name="Data de admissão" detail="Dia em que a pessoa começa a participar da meta e do mínimo do desafio. Vazio, vale o período inteiro." />
              <Field name="Filial" detail="A pessoa só entra na equipe da filial em que está cadastrada." />
            </div>
          </Block>

          <Block title="O que se configura aqui, não no Millennium">
            <ul className="list-disc space-y-1.5 pl-4">
              <Item>Grupo da meta, como manhã ou tarde. Sem grupo, a pessoa fica de fora quando a meta divide por grupo.</Item>
              <Item>Convite de acesso à WDash. Só o vendedor recebe. Gerência e operador de caixa não entram por aqui.</Item>
              <Item>Premiação da gerência na meta e no desafio. É uma regra da loja, não uma pessoa do cadastro.</Item>
            </ul>
          </Block>

          {screen === "goals" && (
            <Block title="Como a meta divide">
              <ul className="list-disc space-y-1.5 pl-4">
                <Item>Individual: a meta da filial, ou do grupo, divide pelas pessoas. Cada uma sobe pelas próprias vendas. Quem chegou ou saiu no meio leva só a parte dos dias em que esteve. A meta de quem ficou o período inteiro não sobe para cobrir a falta.</Item>
                <Item>Grupo: a meta do grupo continua a do período. A premiação pesa pelos dias em que cada pessoa esteve.</Item>
                <Item>Geral: a filial sobe pelo total vendido. Cada dia se divide só entre quem estava naquele dia.</Item>
              </ul>
            </Block>
          )}

          {screen === "challenges" && (
            <Block title="Como o desafio conta">
              <ul className="list-disc space-y-1.5 pl-4">
                <Item>Quem atingir o mínimo: a marca diminui na mesma proporção dos dias em que a pessoa esteve na equipe.</Item>
                <Item>Quem fizer mais: compara a venda de cada um, sem dividir pelo número de dias.</Item>
              </ul>
            </Block>
          )}
        </div>
      </Modal>
    </>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="text-[13px] font-bold text-t0">{title}</h4>
      <div className="text-[13px] leading-relaxed text-t1">{children}</div>
    </section>
  );
}

function Item({ children }: { children: ReactNode }) {
  return <li className="leading-snug">{children}</li>;
}

function Field({ name, detail }: { name: string; detail: string }) {
  return (
    <div className="grid gap-0.5 border-t border-line py-2.5 first:border-t-0 sm:grid-cols-[11.5rem_1fr] sm:gap-4">
      <p className="font-semibold text-t0">{name}</p>
      <p>{detail}</p>
    </div>
  );
}
