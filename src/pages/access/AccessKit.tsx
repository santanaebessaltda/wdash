import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { padTopoEBase } from "@/lib/safeArea";
import { cn } from "@/lib/cn";
import { SENHA_MIN, dicaForcaSenha, senhaTemEspecial } from "@/lib/password";
import { Alert, Checkbox, FormField, Input } from "@/components/ui";
import { AuthGlow, BrandMark } from "@/pages/auth/authKit";
import { PRODUCT_NAME } from "@/data/wedash/tenant";
import { mascararCpf } from "@/lib/cpf";
import { AVATAR_TIPOS } from "@/lib/avatar";

/**
 * Complementos das telas de acesso.
 * Labels/inputs = FormField + Input do Vela (`FormElementsPage`).
 */
export { AuthGlow } from "@/pages/auth/authKit";
export { Checkbox, FormField, Input };

/** Escala tipografica unificada com o Login. */
export const acessoTitulo = "mb-2 text-[26px] font-extrabold tracking-tight text-t0";
export const acessoSubtitulo = "mb-6 text-sm leading-relaxed text-t1";
export const acessoBotao =
  "h-[46px] w-full rounded-xl bg-acc text-sm font-bold text-white transition-colors hover:bg-acc-2 disabled:opacity-60";
export const acessoLink = "text-[13px] font-bold text-acc";
export const acessoRodape = "text-[13px] text-t2";

/** Moldura das telas de acesso, no mesmo formato de ForgotPassword/ResetPassword do template. */
export function AcessoPagina({ children, rodape, largura = 420, marca = true }: { children: ReactNode; rodape?: ReactNode; largura?: number; marca?: boolean }) {
  return (
    <div
      className="tela-cheia pad-topo pad-base relative flex w-full items-center justify-center overflow-hidden bg-bg-0 px-4"
      style={padTopoEBase("2.5rem", "2.5rem")}
    >
      <AuthGlow />
      <div className="relative w-full" style={{ maxWidth: largura }}>
        {marca && (
          <div className="mb-6 flex flex-col items-center gap-3">
            <BrandMark size={56} />
            <p className="text-[17px] font-extrabold tracking-tight text-t0">
              {PRODUCT_NAME}
              <span className="text-acc">.</span>
            </p>
          </div>
        )}
        <div className="rounded-[22px] border border-line bg-bg-2 p-7 sm:p-9" style={{ boxShadow: "0 20px 60px -20px rgba(0,0,0,.6)" }}>
          {children}
        </div>
        {rodape && <div className="mt-5">{rodape}</div>}
      </div>
    </div>
  );
}

const inputErro = "!border-2 !border-bad bg-bad-soft";

const olhoBtn =
  "absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-t2 hover:bg-bg-3 hover:text-t0";

function BotaoRevelarSenha({ mostrar, onToggle }: { mostrar: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} aria-label={mostrar ? "Ocultar senha" : "Mostrar senha"} className={olhoBtn}>
      {mostrar ? (
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
  );
}

/**
 * Ao aceitar a sugestao, o Chrome deixa o valor inteiro selecionado, as vezes
 * depois do evento de input. So reage a mudanca que nao veio do teclado
 * (preenchimento do navegador nao tem inputType de digitacao/colagem).
 */
function useSoltarSelecaoDoAutofill() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let mudouEm = -Infinity;
    const timers: number[] = [];
    const soltar = () => {
      const fim = el.value.length;
      if (fim > 0 && document.activeElement === el && el.selectionStart === 0 && el.selectionEnd === fim) {
        el.setSelectionRange(fim, fim);
      }
    };
    const aoMudar = (e: Event) => {
      const tipo = (e as InputEvent).inputType;
      if (tipo && tipo !== "insertReplacementText") return;
      mudouEm = performance.now();
      requestAnimationFrame(soltar);
      timers.push(window.setTimeout(soltar, 60), window.setTimeout(soltar, 250));
    };
    const aoSelecionar = () => {
      if (performance.now() - mudouEm < 1500) soltar();
    };
    el.addEventListener("input", aoMudar);
    el.addEventListener("select", aoSelecionar);
    return () => {
      el.removeEventListener("input", aoMudar);
      el.removeEventListener("select", aoSelecionar);
      timers.forEach(clearTimeout);
    };
  }, []);
  return ref;
}

const CAMPOS_DE_TEXTO = new Set(["text", "email", "password", "tel", "search", "url"]);

/**
 * Sugestao do navegador que deixa o formulario completo  ->  foco no botao de envio (Enter/toque envia).
 * Nunca envia sozinho: conta errada escolhida, ou "Enviar codigo" para o e-mail errado, seriam irreversiveis.
 * Digitacao e colagem nao contam (tem inputType); preenchimento do navegador nao tem.
 * No celular (PWA) a senha pode chegar depois do e-mail e as vezes so vem `change`  -  por isso tenta
 * de novo por ~1,5s e aceita `change` de campo que nao foi digitado.
 */
export function useFocoNoEnvioAposAutofill() {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const form = ref.current;
    if (!form) return;
    const timers: number[] = [];
    const digitados = new WeakSet<EventTarget>();
    const cancelar = () => {
      timers.forEach(clearTimeout);
      timers.length = 0;
    };
    const focar = () => {
      const botao = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (!botao || botao.disabled) return;
      const ativo = document.activeElement;
      if (ativo === botao) return cancelar();
      if (ativo && ativo !== document.body && !form.contains(ativo)) return;
      const campos = Array.from(form.querySelectorAll<HTMLInputElement>("input")).filter(
        (i) => CAMPOS_DE_TEXTO.has(i.type) && !i.readOnly && !i.disabled,
      );
      if (campos.some((i) => i.value.trim() === "")) return;
      cancelar();
      if (ativo instanceof HTMLInputElement) {
        const fim = ativo.value.length;
        try {
          ativo.setSelectionRange(fim, fim);
        } catch {
          // type="email" nao aceita selecao programatica em alguns navegadores
        }
        ativo.blur();
      }
      botao.focus();
    };
    const agendar = () => {
      cancelar();
      for (const ms of [120, 350, 800, 1500]) timers.push(window.setTimeout(focar, ms));
    };
    const aoDigitar = (e: Event) => {
      const alvo = e.target as HTMLInputElement;
      if (!CAMPOS_DE_TEXTO.has(alvo.type)) return;
      const tipo = (e as InputEvent).inputType;
      if (tipo && tipo !== "insertReplacementText") {
        digitados.add(alvo);
        cancelar();
        return;
      }
      agendar();
    };
    const aoConfirmar = (e: Event) => {
      const alvo = e.target as HTMLInputElement;
      if (!CAMPOS_DE_TEXTO.has(alvo.type) || digitados.has(alvo)) return;
      agendar();
    };
    form.addEventListener("input", aoDigitar);
    form.addEventListener("change", aoConfirmar);
    return () => {
      form.removeEventListener("input", aoDigitar);
      form.removeEventListener("change", aoConfirmar);
      cancelar();
    };
  }, []);
  return ref;
}

/** E-mail  -  FormField + Input (Vela). */
export function CampoEmail({
  label = "E-mail",
  value,
  onChange,
  erro,
  className,
  ...props
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  erro?: string | null;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const ref = useSoltarSelecaoDoAutofill();
  return (
    <FormField label={label} error={erro ?? undefined}>
      <Input
        {...props}
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        autoComplete={props.autoComplete ?? "username"}
        placeholder={props.placeholder ?? "seu@email.com"}
        className={cn(erro && inputErro, className)}
      />
    </FormField>
  );
}

/** CPF com mascara  -  FormField + Input (Vela). */
export function CampoCpf({
  label = "CPF",
  value,
  onChange,
  erro,
  className,
  ...props
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  erro?: string | null;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <FormField label={label} error={erro ?? undefined}>
      <Input
        {...props}
        value={value}
        onChange={(e) => onChange(mascararCpf(e.target.value))}
        inputMode="numeric"
        autoComplete={props.autoComplete ?? "username"}
        placeholder={props.placeholder ?? "000.000.000-00"}
        className={cn("font-mono tracking-wide", erro && inputErro, className)}
      />
    </FormField>
  );
}

/** Senha com revelar  -  FormField + Input (Vela). */
export function CampoSenha({
  label = "Senha",
  value,
  onChange,
  placeholder = "Digite sua senha",
  autoComplete = "current-password",
  erro,
  className,
  ...props
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  erro?: string | null;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const [mostrar, setMostrar] = useState(false);
  return (
    <FormField label={label} error={erro ?? undefined}>
      <div className="relative">
        <Input
          {...props}
          type={mostrar ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className={cn("pr-12", erro && inputErro, className)}
        />
        <BotaoRevelarSenha mostrar={mostrar} onToggle={() => setMostrar((m) => !m)} />
      </div>
    </FormField>
  );
}

export type NomePessoa = { nome: string; sobrenome: string };

export function nomePessoaValido(n: NomePessoa): boolean {
  return n.nome.trim().length >= 2 && n.sobrenome.trim().length >= 2;
}

/** Nome  |  Sobrenome do "Crie seu acesso" (sempre em branco: o convite so traz o e-mail). */
export function CamposNome({
  valor,
  onChange,
  autoFocus,
}: {
  valor: NomePessoa;
  onChange: (patch: Partial<NomePessoa>) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <FormField label="Nome">
        <Input
          value={valor.nome}
          onChange={(e) => onChange({ nome: e.target.value })}
          placeholder="Seu nome"
          autoComplete="given-name"
          autoFocus={autoFocus}
          maxLength={40}
        />
      </FormField>
      <FormField label="Sobrenome">
        <Input
          value={valor.sobrenome}
          onChange={(e) => onChange({ sobrenome: e.target.value })}
          placeholder="Seu sobrenome"
          autoComplete="family-name"
          maxLength={60}
        />
      </FormField>
    </div>
  );
}

/** Foto de perfil opcional (padrao da aba Profile do template: quadrado com iniciais + botao "+"). */
export function CampoFoto({
  nome,
  foto,
  onChange,
}: {
  nome: NomePessoa;
  foto: File | null;
  onChange: (foto: File | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!foto) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(foto);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [foto]);

  const iniciais = `${nome.nome.trim().charAt(0)}${nome.sobrenome.trim().charAt(0)}`.toUpperCase();
  const escolher = () => input.current?.click();

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <button
          type="button"
          onClick={escolher}
          aria-label={foto ? "Trocar foto de perfil" : "Adicionar foto de perfil"}
          className="flex h-[88px] w-[88px] items-center justify-center overflow-hidden rounded-[24px] text-[32px] font-extrabold text-white"
          style={{ background: "linear-gradient(135deg,#7c5cff,#56a8ff)" }}
        >
          {preview ? (
            <img src={preview} alt="" className="h-full w-full object-cover" />
          ) : iniciais ? (
            iniciais
          ) : (
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={escolher}
          tabIndex={-1}
          aria-hidden
          className="absolute -bottom-1 -right-1 flex h-[30px] w-[30px] items-center justify-center rounded-full border-[3px] border-bg-0 bg-acc text-white"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
      {foto ? (
        <button type="button" onClick={() => onChange(null)} className={cn(acessoLink, "mt-2.5")}>
          Remover foto
        </button>
      ) : (
        <p className="mt-2.5 text-xs text-t2">Foto de perfil (opcional)</p>
      )}
      <input
        ref={input}
        type="file"
        accept={AVATAR_TIPOS}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          e.target.value = "";
          if (f) onChange(f);
        }}
      />
    </div>
  );
}

/** Aviso dentro do card (Alert do Vela). */
export function AvisoCard({ tom = "info", titulo, children }: { tom?: "info" | "ok" | "bad" | "warn"; titulo?: ReactNode; children: ReactNode }) {
  const variant = { info: "info", ok: "success", bad: "danger", warn: "warning" } as const;
  return (
    <Alert variant={variant[tom]} title={titulo}>
      {children}
    </Alert>
  );
}

/** Icone redondo no topo do card, como em ForgotPassword/ResetPassword do template. */
export function IconeCard({ tom = "acc", centralizado = false, children }: { tom?: "acc" | "ok" | "bad" | "warn" | "info"; centralizado?: boolean; children: ReactNode }) {
  const bg = { acc: "bg-acc-soft", ok: "bg-ok-soft", bad: "bg-bad-soft", warn: "bg-warn-soft", info: "bg-info-soft" }[tom];
  const cor = { acc: "var(--acc)", ok: "var(--ok)", bad: "var(--bad)", warn: "var(--warn)", info: "var(--info)" }[tom];
  return (
    <div className={cn("mb-5 flex h-16 w-16 items-center justify-center rounded-[18px]", bg, centralizado && "mx-auto")} style={{ color: cor }}>
      {children}
    </div>
  );
}

/** Medidor de forca da senha (barras Vela). */
export function ForcaSenha({ senha }: { senha: string }) {
  const n = senha.length;
  const temEspecial = senhaTemEspecial(senha);
  const nivel = n === 0 ? 0 : n < SENHA_MIN ? 1 : !temEspecial ? 2 : n < 12 ? 3 : 4;
  const cor = nivel <= 1 ? "bg-bad" : nivel === 2 ? "bg-warn" : "bg-ok";
  return (
    <div>
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={cn("h-[5px] flex-1 rounded-sm", i <= nivel ? cor : "bg-bg-inset")} />
        ))}
      </div>
      <p className="mt-1.5 text-[11.5px] text-t2">{dicaForcaSenha(senha)}</p>
    </div>
  );
}
