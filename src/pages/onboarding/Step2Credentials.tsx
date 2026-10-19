import { useState } from "react";
import { FormField, Input, useToast } from "@/components/ui";
import { logoutErp, testErpLogin, type ErpLoginResult, type ErpReportCheck } from "@/data/wedash/erp";
import { ErpReportChecks } from "@/components/wedash/ErpReportChecks";
import { writeErpPassword, readErpPassword } from "./draft";
import { noAutofill, secretStyle } from "@/lib/noAutofill";

const toastError: Record<Exclude<ErpLoginResult, { ok: true }>["reason"], string> = {
  password: "Usuário ou senha incorretos. Confira os dados e tente novamente.",
  busy: "Este usuário do Millennium está conectado em outro local. Encerre a outra sessão e tente novamente.",
  stores: "O acesso ao Millennium foi confirmado, mas não foi possível identificar as filiais deste usuário. Tente novamente.",
  other: "Não foi possível conectar ao Millennium. Tente novamente em alguns minutos.",
  reports: "Este usuário não tem acesso a todos os relatórios necessários no Millennium.",
};

const btnPrimario =
  "h-[46px] w-full rounded-xl bg-acc text-sm font-bold text-white transition-colors hover:bg-acc-2 disabled:cursor-not-allowed disabled:opacity-50";

export type ErpDraft = {
  username: string;
  dedicada: boolean;
  aceite: boolean;
};

/**
 * Etapa 2 (ultima)  -  um clique testa o Millennium (login, lojas, relatorios) e, se passou, conecta
 * com todas as lojas do usuario. As vendas de hoje chegam depois, ja no board.
 */
export function Step2Credentials({
  membershipId,
  inicial,
  onErpChange,
  onConectar,
  conectando = false,
}: {
  membershipId: string;
  inicial: ErpDraft;
  onErpChange: (erp: ErpDraft) => void;
  onConectar: (r: Extract<ErpLoginResult, { ok: true }>) => void;
  conectando?: boolean;
}) {
  const { show } = useToast();
  const [username, setUsername] = useState(inicial.username);
  const [password, setPassword] = useState(() => readErpPassword(membershipId));
  const [dedicada, setDedicada] = useState(inicial.dedicada);
  const [aceite, setAceite] = useState(inicial.aceite);
  const [testando, setTestando] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [relatorios, setRelatorios] = useState<ErpReportCheck[] | null>(null);
  const [falhou, setFalhou] = useState(false);

  function syncErp(next: Partial<ErpDraft> & { username?: string; dedicada?: boolean; aceite?: boolean }) {
    const erp = {
      username: next.username ?? username,
      dedicada: next.dedicada ?? dedicada,
      aceite: next.aceite ?? aceite,
    };
    onErpChange(erp);
  }

  const busy = testando || conectando;
  const can = username.trim().length > 0 && password.length > 0 && aceite && !busy;

  async function testar() {
    if (!can) return;
    setTestando(true);
    setRelatorios(null);
    const r = await testErpLogin(username, password);
    if (r.ok && r.stores.length === 0) {
      await logoutErp(r.session);
      setTestando(false);
      setFalhou(true);
      show("Este usuário não possui filiais vinculadas no Millennium. Verifique os vínculos no Millennium e tente novamente.", "danger");
      return;
    }
    setTestando(false);
    setFalhou(!r.ok);
    if (!r.ok) {
      if (r.reason === "reports" && r.reports) setRelatorios(r.reports);
      show(toastError[r.reason], "danger");
      return;
    }
    onConectar(r);
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-extrabold tracking-tight text-t0">Conecte o Millennium</h1>
      <p className="mb-7 text-sm text-t2">
        Conecte o Millennium para trazer vendas, custos, lojas e vendedores para a WDash. As lojas disponíveis para este
        usuário serão adicionadas automaticamente.
      </p>

      <div className="flex flex-col gap-3.5">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <FormField label="Usuário do Millennium" required>
            <Input
              value={username}
              onChange={(e) => {
                const v = e.target.value.toUpperCase();
                setUsername(v);
                syncErp({ username: v });
              }}
              placeholder="Ex.: ESSENCIA.INTEGRACAO"
              {...noAutofill}
              autoFocus
              className="uppercase"
            />
          </FormField>
          <FormField label="Senha do Millennium" required>
            <div className="relative">
              <Input
                type="text"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  writeErpPassword(membershipId, e.target.value);
                }}
                placeholder="Digite a senha"
                {...noAutofill}
                style={secretStyle(showPassword)}
                className="pr-12"
              />
              <button
                type="button"
                onClick={() => setShowPassword((m) => !m)}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-t2 hover:bg-bg-3 hover:text-t0"
              >
                {showPassword ? (
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22" />
                  </svg>
                ) : (
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </FormField>
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-normal text-t1">
          <input
            type="checkbox"
            checked={dedicada}
            onChange={(e) => {
              setDedicada(e.target.checked);
              syncErp({ dedicada: e.target.checked });
            }}
            className="mt-0.5"
            style={{ accentColor: "var(--acc)" }}
          />
          <span>
            Este usuário será usado somente pela WDash
            <span className="mt-0.5 block text-t2">
              O Millennium permite apenas uma sessão por usuário. Use um usuário exclusivo para evitar interrupções na
              sincronização e permitir que a WDash se reconecte automaticamente se a sessão cair.
            </span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-normal text-t1">
          <input
            type="checkbox"
            checked={aceite}
            onChange={(e) => {
              setAceite(e.target.checked);
              syncErp({ aceite: e.target.checked });
            }}
            className="mt-0.5"
            style={{ accentColor: "var(--acc)" }}
          />
          Autorizo a WDash a usar este acesso para realizar a sincronização.
        </label>

        {relatorios && <ErpReportChecks reports={relatorios} username={username.trim()} />}

        <button type="button" disabled={!can} onClick={testar} className={btnPrimario} style={{ boxShadow: "0 8px 24px -8px var(--acc)" }}>
          {conectando ? "Conectando…" : testando ? "Testando conexão…" : falhou ? "Testar novamente" : "Testar e conectar"}
        </button>
      </div>
    </div>
  );
}
