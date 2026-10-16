import { useState, type ReactNode } from "react";
import { Button, Modal } from "@/components/ui";

export type SetupGuideScreen = "staff" | "goals" | "challenges";

const SCREEN_LEAD: Record<SetupGuideScreen, string> = {
  staff:
    "A lista mostra a equipe que a WDash leu no Millennium para esta filial. Use Atualizar equipe para buscar alterações feitas no Millennium. O grupo e o acesso à WDash são configurados aqui. O cargo do Millennium não cria acesso.",
  goals:
    "A meta usa a mesma equipe de vendas do ranking. Quem estiver ativo com cargo Vendedor participa automaticamente. Quem entrar ou sair durante o período participa somente nos dias em que fez parte da equipe.",
  challenges:
    "O desafio usa a mesma equipe de vendas. Quem estiver ativo com cargo Vendedor participa automaticamente. A regra para quem entra ou sai durante o período depende do tipo de desafio.",
};

/** Manual de como o funcionário do Millennium entra na equipe, na meta e no desafio. */
export function SetupGuide({ screen }: { screen: SetupGuideScreen }) {
  const [open, setOpen] = useState(false);
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
          <Block title="Para participar na WDash">
            <p>No Millennium, configure a pessoa desta forma:</p>
            <ul className="mt-2 list-disc space-y-1.5 pl-4">
              <Line label="Cargo" value="Vendedor" />
              <Line label="Inativo" value="desmarcado" />
              <Line label="Afastado" value="desmarcado" />
              <Line label="Não mostrar no evento" value="desmarcado" />
              <Line label="Gerador" value="ativo" />
              <Line label="Data de admissão" value="preenchida" />
              <Line label="Filial" value="a filial correta" />
            </ul>
            <p className="mt-2">Depois, use Atualizar equipe para a WDash buscar as alterações no Millennium.</p>
            <Sub title="Gerador">
              <p>O gerador é o código que vincula as vendas à pessoa. Mesmo que o nome mude no Millennium, as vendas continuam ligadas ao mesmo código.</p>
            </Sub>
            <Sub title="Data de admissão">
              <p>Define quando a pessoa começa a participar das metas e dos desafios. Se estiver vazia, a WDash considera o período inteiro.</p>
            </Sub>
          </Block>

          <Block title="Para desligar">
            <p>Desative a pessoa no Millennium. Qualquer uma destas condições faz a WDash considerá-la desligada:</p>
            <ul className="mt-2 list-disc space-y-1.5 pl-4">
              <Line label="Inativo" value="marcado" />
              <Line label="Afastado" value="marcado" />
              <Line label="Não mostrar no evento" value="marcado" />
              <Line label="Gerador" value="desativado" />
            </ul>
            <p className="mt-2">
              Se o Millennium trocar o cargo de Vendedor para Indefinido, a pessoa também passa a aparecer em Desligados. Depois, use Atualizar equipe.
            </p>
            <Sub title="O que acontece depois">
              <ul className="list-disc space-y-1.5 pl-4">
                <Item>A pessoa deixa de participar do ranking.</Item>
                <Item>Em metas e desafios de um período já iniciado, ela participa somente até o dia da saída.</Item>
                <Item>Quem já estava desligado antes do período e não teve vendas não entra na disputa.</Item>
              </ul>
            </Sub>
          </Block>

          <Block title="O que a WDash lê no Millennium">
            <div className="mt-1">
              <Field name="Cargo">
                <Role name="Vendedor" detail="Participa do ranking, das metas e dos desafios." />
                <Role name="Gerência" detail="Aparece na equipe, mas não participa da disputa." />
                <Role name="Operador de caixa" detail="Aparece na equipe, mas não participa da disputa." />
                <Role name="Usuário da filial" detail="Aparece na equipe quando é o usuário geral da operação, mas não participa da disputa." />
              </Field>
              <Field name="Inativo">Quando marcado, a pessoa fica desligada na WDash.</Field>
              <Field name="Afastado">Quando marcado, a pessoa fica desligada na WDash.</Field>
              <Field name="Não mostrar no evento">Quando marcado, a pessoa fica desligada na WDash.</Field>
              <Field name="Gerador">Desativado, a pessoa fica desligada. Ativo, o código vincula as vendas à pessoa.</Field>
              <Field name="Data de admissão">Primeiro dia em que a pessoa participa da meta e do mínimo dos desafios. Vazio, vale o período inteiro.</Field>
              <Field name="Filial">A pessoa pertence à filial em que está cadastrada no Millennium.</Field>
            </div>
          </Block>

          <Block title="O que é configurado na WDash">
            <p>Estas informações não vêm do Millennium.</p>
            <Sub title="Grupo">
              <p>Define o grupo do vendedor, como Manhã ou Tarde. Sem grupo, o vendedor fica de fora das regras que dependem da divisão por grupo.</p>
            </Sub>
            <Sub title="Acesso à WDash">
              <p>Somente vendedores recebem convite por esta tela. Gerência, operador de caixa e usuário da filial não recebem acesso por este fluxo.</p>
            </Sub>
            <Sub title="Premiação da gerência">
              <p>A premiação da gerência em metas e desafios é uma regra da filial. Não depende de uma pessoa cadastrada no Millennium.</p>
            </Sub>
          </Block>

          <Block title="Nesta tela">
            <p>{SCREEN_LEAD[screen]}</p>
          </Block>

          {screen === "goals" && (
            <Block title="Como a meta é dividida">
              <Sub title="Individual">
                <p>
                  A meta da filial ou do grupo é dividida entre os vendedores participantes. Cada um avança com as próprias vendas. Quem entrar ou sair no meio do período recebe somente a parcela dos dias em que participou. A meta dos demais não aumenta para compensar essa diferença.
                </p>
              </Sub>
              <Sub title="Grupo">
                <p>A meta total do grupo permanece a mesma durante o período. A premiação de cada vendedor considera os dias em que ele fez parte do grupo.</p>
              </Sub>
              <Sub title="Geral">
                <p>A filial avança pelo total vendido. A parcela de cada dia considera somente os vendedores que faziam parte da equipe naquele dia.</p>
              </Sub>
            </Block>
          )}

          {screen === "challenges" && (
            <Block title="Como o desafio conta">
              <Sub title="Quem atingir o mínimo">
                <p>O mínimo é ajustado proporcionalmente aos dias em que o vendedor participou da equipe.</p>
              </Sub>
              <Sub title="Quem fizer mais">
                <p>Compara o resultado de cada vendedor no período. Não há ajuste pelo número de dias em que a pessoa participou.</p>
              </Sub>
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

function Sub({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-3 flex flex-col gap-1">
      <h5 className="font-semibold text-t0">{title}</h5>
      {children}
    </div>
  );
}

function Item({ children }: { children: ReactNode }) {
  return <li className="leading-snug">{children}</li>;
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <li className="leading-snug">
      <span className="font-semibold text-t0">{label}:</span> {value}
    </li>
  );
}

function Role({ name, detail }: { name: string; detail: string }) {
  return (
    <p className="leading-snug">
      <span className="font-semibold text-t0">{name}.</span> {detail}
    </p>
  );
}

function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-line py-2.5 first:border-t-0 sm:grid-cols-[11.5rem_1fr] sm:gap-4">
      <p className="font-semibold text-t0">{name}</p>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}
