import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { padTopAndBottom } from "@/lib/safeArea";
import { cn } from "@/lib/cn";
import { PASSWORD_MIN, passwordStrengthHint, passwordHasSpecial } from "@/lib/password";
import { Alert, Checkbox, FormField, Input } from "@/components/ui";
import { AuthGlow, BrandMark } from "@/pages/auth/authKit";
import { PRODUCT_NAME } from "@/data/wedash/tenant";
import { mascararCpf } from "@/lib/cpf";
import { AVATAR_KINDS } from "@/lib/avatar";

/**
 * Complementos das telas de acesso.
 * Labels/inputs = FormField + Input do Vela (`FormElementsPage`).
 */
export { AuthGlow } from "@/pages/auth/authKit";
export { Checkbox, FormField, Input };

/** Escala tipografica unificada com o Login. */
export const accessTitle = "mb-2 text-[26px] font-extrabold tracking-tight text-t0";
export const accessSubtitle = "mb-6 text-sm leading-relaxed text-t1";
export const accessButton =
  "h-[46px] w-full rounded-xl bg-acc text-sm font-bold text-white transition-colors hover:bg-acc-2 disabled:opacity-60";
export const accessLink = "text-[13px] font-bold text-acc";
export const accessFooter = "text-[13px] text-t2";

/** Moldura das telas de acesso, no mesmo formato de ForgotPassword/ResetPassword do template. */
export function AccessShell({ children, footer, width = 420, brand = true }: { children: ReactNode; footer?: ReactNode; width?: number; brand?: boolean }) {
  return (
    <div
      className="tela-cheia pad-topo pad-base relative w-full overflow-y-auto bg-bg-0"
      style={padTopAndBottom("2.5rem", "2.5rem")}
    >
      <AuthGlow />
      <div className="relative flex min-h-full w-full items-center justify-center px-4">
        <div className="w-full py-8" style={{ maxWidth: width }}>
        {brand && (
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
        {footer && <div className="mt-5">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

const inputError = "!border-2 !border-bad bg-bad-soft";

const eyeBtn =
  "absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-t2 hover:bg-bg-3 hover:text-t0";

function RevealPasswordButton({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} aria-label={show ? "Ocultar senha" : "Mostrar senha"} className={eyeBtn}>
      {show ? (
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
function useReleaseAutofillSelection() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let changedEm = -Infinity;
    const timers: number[] = [];
    const release = () => {
      const end = el.value.length;
      if (end > 0 && document.activeElement === el && el.selectionStart === 0 && el.selectionEnd === end) {
        el.setSelectionRange(end, end);
      }
    };
    const aoMudar = (e: Event) => {
      const kind = (e as InputEvent).inputType;
      if (kind && kind !== "insertReplacementText") return;
      changedEm = performance.now();
      requestAnimationFrame(release);
      timers.push(window.setTimeout(release, 60), window.setTimeout(release, 250));
    };
    const aoSelect = () => {
      if (performance.now() - changedEm < 1500) release();
    };
    el.addEventListener("input", aoMudar);
    el.addEventListener("select", aoSelect);
    return () => {
      el.removeEventListener("input", aoMudar);
      el.removeEventListener("select", aoSelect);
      timers.forEach(clearTimeout);
    };
  }, []);
  return ref;
}

const TEXT_FIELDS = new Set(["text", "email", "password", "tel", "search", "url"]);

/**
 * Sugestao do navegador que deixa o formulario completo  ->  foco no botao de envio (Enter/toque envia).
 * Nunca envia sozinho: conta errada escolhida, ou "Enviar codigo" para o e-mail errado, seriam irreversiveis.
 * Digitacao e colagem nao contam (tem inputType); preenchimento do navegador nao tem.
 * No celular (PWA) a senha pode chegar depois do e-mail e as vezes so vem `change`  -  por isso tenta
 * de novo por ~1,5s e aceita `change` de campo que nao foi digitado.
 */
export function useFocusSubmitAfterAutofill() {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const form = ref.current;
    if (!form) return;
    const timers: number[] = [];
    const typed = new WeakSet<EventTarget>();
    const cancel = () => {
      timers.forEach(clearTimeout);
      timers.length = 0;
    };
    const focar = () => {
      const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (!button || button.disabled) return;
      const active = document.activeElement;
      if (active === button) return cancel();
      if (active && active !== document.body && !form.contains(active)) return;
      const fields = Array.from(form.querySelectorAll<HTMLInputElement>("input")).filter(
        (i) => TEXT_FIELDS.has(i.type) && !i.readOnly && !i.disabled,
      );
      if (fields.some((i) => i.value.trim() === "")) return;
      cancel();
      if (active instanceof HTMLInputElement) {
        const end = active.value.length;
        try {
          active.setSelectionRange(end, end);
        } catch {
          // type="email" nao aceita selecao programatica em alguns navegadores
        }
        active.blur();
      }
      button.focus();
    };
    const agendar = () => {
      cancel();
      for (const ms of [120, 350, 800, 1500]) timers.push(window.setTimeout(focar, ms));
    };
    const aoDigitar = (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (!TEXT_FIELDS.has(target.type)) return;
      const kind = (e as InputEvent).inputType;
      if (kind && kind !== "insertReplacementText") {
        typed.add(target);
        cancel();
        return;
      }
      agendar();
    };
    const aoConfirm = (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (!TEXT_FIELDS.has(target.type) || typed.has(target)) return;
      agendar();
    };
    form.addEventListener("input", aoDigitar);
    form.addEventListener("change", aoConfirm);
    return () => {
      form.removeEventListener("input", aoDigitar);
      form.removeEventListener("change", aoConfirm);
      cancel();
    };
  }, []);
  return ref;
}

/** E-mail  -  FormField + Input (Vela). */
export function EmailField({
  label = "E-mail",
  value,
  onChange,
  error,
  className,
  ...props
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const ref = useReleaseAutofillSelection();
  return (
    <FormField label={label} error={error ?? undefined}>
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
        className={cn(error && inputError, className)}
      />
    </FormField>
  );
}

/** CPF com mascara  -  FormField + Input (Vela). */
export function CpfField({
  label = "CPF",
  value,
  onChange,
  error,
  className,
  ...props
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <FormField label={label} error={error ?? undefined}>
      <Input
        {...props}
        value={value}
        onChange={(e) => onChange(mascararCpf(e.target.value))}
        inputMode="numeric"
        autoComplete={props.autoComplete ?? "username"}
        placeholder={props.placeholder ?? "000.000.000-00"}
        className={cn("font-mono tracking-wide", error && inputError, className)}
      />
    </FormField>
  );
}

/** Senha com revelar  -  FormField + Input (Vela). */
export function PasswordField({
  label = "Senha",
  value,
  onChange,
  placeholder = "Digite sua senha",
  autoComplete = "current-password",
  error,
  className,
  ...props
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const [show, setShow] = useState(false);
  return (
    <FormField label={label} error={error ?? undefined}>
      <div className="relative">
        <Input
          {...props}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className={cn("pr-12", error && inputError, className)}
        />
        <RevealPasswordButton show={show} onToggle={() => setShow((m) => !m)} />
      </div>
    </FormField>
  );
}

export type PersonName = { name: string; lastName: string };

export function personNameIsValid(n: PersonName): boolean {
  return n.name.trim().length >= 2 && n.lastName.trim().length >= 2;
}

/** Nome  |  Sobrenome do "Crie seu acesso" (sempre em branco: o convite so traz o e-mail). */
export function NameFields({
  amount,
  onChange,
  autoFocus,
}: {
  amount: PersonName;
  onChange: (patch: Partial<PersonName>) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <FormField label="Nome">
        <Input
          value={amount.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Seu nome"
          autoComplete="given-name"
          autoFocus={autoFocus}
          maxLength={40}
        />
      </FormField>
      <FormField label="Sobrenome">
        <Input
          value={amount.lastName}
          onChange={(e) => onChange({ lastName: e.target.value })}
          placeholder="Seu sobrenome"
          autoComplete="family-name"
          maxLength={60}
        />
      </FormField>
    </div>
  );
}

/** Foto de perfil opcional (padrao da aba Profile do template: quadrado com iniciais + botao "+"). */
export function PhotoField({
  name,
  photo,
  onChange,
}: {
  name: PersonName;
  photo: File | null;
  onChange: (photo: File | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!photo) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const iniciais = `${name.name.trim().charAt(0)}${name.lastName.trim().charAt(0)}`.toUpperCase();
  const escolher = () => input.current?.click();

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <button
          type="button"
          onClick={escolher}
          aria-label={photo ? "Trocar foto de perfil" : "Adicionar foto de perfil"}
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
      {photo ? (
        <button type="button" onClick={() => onChange(null)} className={cn(accessLink, "mt-2.5")}>
          Remover foto
        </button>
      ) : (
        <p className="mt-2.5 text-xs text-t2">Foto de perfil (opcional)</p>
      )}
      <input
        ref={input}
        type="file"
        accept={AVATAR_KINDS}
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
export function NoticeCard({ tone = "info", title, children }: { tone?: "info" | "ok" | "bad" | "warn"; title?: ReactNode; children: ReactNode }) {
  const variant = { info: "info", ok: "success", bad: "danger", warn: "warning" } as const;
  return (
    <Alert variant={variant[tone]} title={title}>
      {children}
    </Alert>
  );
}

/** Icone redondo no topo do card, como em ForgotPassword/ResetPassword do template. */
export function IconCard({ tone = "acc", centered = false, children }: { tone?: "acc" | "ok" | "bad" | "warn" | "info"; centered?: boolean; children: ReactNode }) {
  const bg = { acc: "bg-acc-soft", ok: "bg-ok-soft", bad: "bg-bad-soft", warn: "bg-warn-soft", info: "bg-info-soft" }[tone];
  const color = { acc: "var(--acc)", ok: "var(--ok)", bad: "var(--bad)", warn: "var(--warn)", info: "var(--info)" }[tone];
  return (
    <div className={cn("mb-5 flex h-16 w-16 items-center justify-center rounded-[18px]", bg, centered && "mx-auto")} style={{ color: color }}>
      {children}
    </div>
  );
}

/** Medidor de forca da senha (barras Vela). */
export function PasswordStrength({ password }: { password: string }) {
  const n = password.length;
  const hasEspecial = passwordHasSpecial(password);
  const level = n === 0 ? 0 : n < PASSWORD_MIN ? 1 : !hasEspecial ? 2 : n < 12 ? 3 : 4;
  const color = level <= 1 ? "bg-bad" : level === 2 ? "bg-warn" : "bg-ok";
  return (
    <div>
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={cn("h-[5px] flex-1 rounded-sm", i <= level ? color : "bg-bg-inset")} />
        ))}
      </div>
      <p className="mt-1.5 text-[11.5px] text-t2">{passwordStrengthHint(password)}</p>
    </div>
  );
}
