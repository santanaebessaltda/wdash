import { useEffect, useRef, useState, type FormEvent } from "react";
import { Badge, Button, Card, CardHeader, CardSubtitle, CardTitle, FormField, Input, useToast } from "@/components/ui";
import { CampoSenha, CamposNome, ForcaSenha, nomePessoaValido, type NomePessoa } from "@/pages/access/AccessKit";
import { SAVE_ERROR_MSG } from "@/pages/operation/shared";
import { CheckIcon, PlusIcon } from "@/pages/utility/icons";
import { AVATAR_TIPOS } from "@/lib/avatar";
import { SENHA_REGRA_TEXTO, senhaValida } from "@/lib/password";
import { titleName } from "@/lib/format";
import { changeMyPassword, fetchMyNames, saveMyProfile, saveThemePreference } from "@/session/authApi";
import { accessLabel, useActiveSession, useSession } from "@/session/SessionProvider";
import { useTheme, type ThemePreference } from "@/theme/ThemeProvider";

const THEME_OPTIONS: { value: ThemePreference; label: string; background: string; borderColor: string }[] = [
  { value: "dark", label: "Escuro", background: "#0c0e15", borderColor: "#1e2230" },
  { value: "light", label: "Claro", background: "#f5f6fa", borderColor: "#e2e5ee" },
  { value: "system", label: "Sistema", background: "linear-gradient(135deg,#0c0e15 50%,#f5f6fa 50%)", borderColor: "#1e2230" },
];

function dividirNome(nome: string): NomePessoa {
  const [first = "", ...rest] = nome.trim().split(/\s+/);
  return { nome: first, sobrenome: rest.join(" ") };
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  return `${partes[0]?.charAt(0) ?? ""}${partes.length > 1 ? partes[partes.length - 1]!.charAt(0) : ""}`.toUpperCase();
}

/** Padrao Account > Profile do Vela: foto 88px com "+", nome, e-mail e papel. A foto grava na hora. */
function ProfileSummaryCard({ salvo }: { salvo: NomePessoa }) {
  const session = useActiveSession();
  const { update } = useSession();
  const { show } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);

  async function gravarFoto(photo: File | null) {
    setEnviando(true);
    const r = await saveMyProfile({ firstName: salvo.nome, lastName: salvo.sobrenome, photo, removePhoto: photo === null });
    setEnviando(false);
    if (!r.ok) return show(r.error || SAVE_ERROR_MSG, "danger");
    update({ name: r.name, avatarUrl: r.avatarUrl ?? null });
    show(photo ? "Foto atualizada." : "Foto removida.", "success");
  }

  const escolher = () => !enviando && input.current?.click();

  return (
    <Card className="text-center">
      <div className="relative mx-auto mb-3.5 inline-block">
        <button
          type="button"
          onClick={escolher}
          aria-label={session.avatarUrl ? "Trocar foto de perfil" : "Adicionar foto de perfil"}
          className="flex h-[88px] w-[88px] items-center justify-center overflow-hidden rounded-[24px] text-[32px] font-extrabold text-white disabled:opacity-60"
          style={{ background: "linear-gradient(135deg,#7c5cff,#56a8ff)" }}
          disabled={enviando}
        >
          {session.avatarUrl ? <img src={session.avatarUrl} alt="" className="h-full w-full object-cover" /> : iniciais(session.name)}
        </button>
        <button
          type="button"
          onClick={escolher}
          tabIndex={-1}
          aria-hidden
          className="absolute -bottom-1 -right-1 flex h-[30px] w-[30px] items-center justify-center rounded-full border-[3px] border-bg-2 bg-acc text-white"
        >
          <PlusIcon size={13} />
        </button>
        <input
          ref={input}
          type="file"
          accept={AVATAR_TIPOS}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            e.target.value = "";
            if (f) void gravarFoto(f);
          }}
        />
      </div>
      <h2 className="mb-0.5 truncate text-lg font-extrabold text-t0">{session.name}</h2>
      <p className="mb-3.5 truncate text-[13px] text-t2">{session.email}</p>
      <Badge variant="accent">{accessLabel(session.role, session.isOwner)}</Badge>
      {session.avatarUrl && (
        <div className="mt-3.5">
          <button type="button" onClick={() => void gravarFoto(null)} disabled={enviando} className="text-[12.5px] font-semibold text-t2 hover:text-bad">
            Remover foto
          </button>
        </div>
      )}
    </Card>
  );
}

function PersonalDataCard({ salvo, onSaved }: { salvo: NomePessoa; onSaved: (n: NomePessoa) => void }) {
  const session = useActiveSession();
  const { update } = useSession();
  const { show } = useToast();
  const [nome, setNome] = useState<NomePessoa>(salvo);
  const [saving, setSaving] = useState(false);

  useEffect(() => setNome(salvo), [salvo]);

  const dirty = nome.nome.trim() !== salvo.nome || nome.sobrenome.trim() !== salvo.sobrenome;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!dirty || saving) return;
    if (!nomePessoaValido(nome)) return show("Informe nome e sobrenome com pelo menos 2 letras cada.", "danger");
    setSaving(true);
    const r = await saveMyProfile({ firstName: nome.nome, lastName: nome.sobrenome, photo: null, removePhoto: false });
    setSaving(false);
    if (!r.ok) return show(r.error || SAVE_ERROR_MSG, "danger");
    update({ name: r.name });
    onSaved({ nome: titleName(nome.nome), sobrenome: titleName(nome.sobrenome) });
    show("Alterações salvas.", "success");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dados pessoais</CardTitle>
      </CardHeader>
      <form onSubmit={salvar} noValidate>
        <div className="flex flex-col gap-4">
          <CamposNome valor={nome} onChange={(p) => setNome((n) => ({ ...n, ...p }))} />
          <FormField label="E-mail" hint="O e-mail é usado para entrar na WDash e não pode ser alterado aqui.">
            <Input value={session.email} readOnly disabled />
          </FormField>
        </div>
        <div className="mt-4.5 flex justify-end gap-2.5">
          <Button variant="outline" type="button" onClick={() => setNome(salvo)} disabled={!dirty || saving}>
            Desfazer alterações
          </Button>
          <Button type="submit" disabled={!dirty || saving}>
            {saving ? "Salvando…" : "Salvar alterações"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Padrao Account > Security > Change password do Vela. */
function PasswordCard() {
  const session = useActiveSession();
  const { show } = useToast();
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirma, setConfirma] = useState("");
  const [saving, setSaving] = useState(false);

  const erroConfirma = confirma.length > 0 && confirma !== nova ? "As senhas não coincidem." : null;
  const pode = atual.length > 0 && senhaValida(nova) && confirma === nova && !saving;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!pode) return;
    setSaving(true);
    const r = await changeMyPassword(session.email, atual, nova);
    setSaving(false);
    if (!r.ok) return show(r.error ?? SAVE_ERROR_MSG, "danger");
    setAtual("");
    setNova("");
    setConfirma("");
    show("Senha alterada.", "success");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Alterar senha</CardTitle>
      </CardHeader>
      <form onSubmit={salvar} className="flex flex-col gap-3.5" noValidate>
        {/* Escondido: gerenciador de senhas associa a senha nova a este login. */}
        <input type="email" name="username" autoComplete="username" value={session.email} readOnly tabIndex={-1} aria-hidden className="sr-only" />
        <CampoSenha label="Senha atual" value={atual} onChange={setAtual} placeholder="Digite sua senha atual" autoComplete="current-password" />
        <CampoSenha label="Nova senha" value={nova} onChange={setNova} placeholder={SENHA_REGRA_TEXTO} autoComplete="new-password" />
        <CampoSenha
          label="Confirme a nova senha"
          value={confirma}
          onChange={setConfirma}
          placeholder="Digite novamente"
          autoComplete="new-password"
          erro={erroConfirma}
        />
        <ForcaSenha senha={nova} />
        <div className="mt-4.5 flex justify-end">
          <Button type="submit" disabled={!pode}>
            {saving ? "Alterando…" : "Alterar senha"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ThemeCard() {
  const { preference, setPreference } = useTheme();
  const { show } = useToast();
  const [saved, setSaved] = useState(preference);
  const [draft, setDraft] = useState(preference);
  const [saving, setSaving] = useState(false);
  const dirty = draft !== saved;

  useEffect(() => {
    if (draft !== saved) return;
    setSaved(preference);
    setDraft(preference);
  }, [preference, draft, saved]);

  function escolher(value: ThemePreference) {
    setDraft(value);
    setPreference(value);
  }

  function desfazer() {
    setDraft(saved);
    setPreference(saved);
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    const ok = await saveThemePreference(draft);
    setSaving(false);
    if (!ok) return show(SAVE_ERROR_MSG, "danger");
    setPreference(draft);
    setSaved(draft);
    show("Alterações salvas.", "success");
  }

  return (
    <Card>
      <form onSubmit={salvar} noValidate>
        <div className="mb-4">
          <CardTitle>Aparência</CardTitle>
          <CardSubtitle>Escolha como a WDash aparece para você em todos os aparelhos. No modo Sistema, seguimos a configuração do sistema de cada aparelho.</CardSubtitle>
        </div>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          {THEME_OPTIONS.map((m) => {
            const selected = draft === m.value;
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => escolher(m.value)}
                className={`rounded-[14px] border-2 p-3.5 text-left ${selected ? "border-acc" : "border-line hover:border-line-2"}`}
              >
                <div className="mb-2.5 h-16 rounded-[9px] border" style={{ background: m.background, borderColor: m.borderColor }} />
                <div className="flex items-center gap-1.5">
                  {selected && (
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-acc">
                      <CheckIcon size={10} className="text-white" />
                    </span>
                  )}
                  <span className="text-[12.5px] font-bold text-t0">{m.label}</span>
                </div>
              </button>
            );
          })}
        </div>
        <div className="mt-4.5 flex justify-end gap-2.5">
          <Button variant="outline" type="button" onClick={desfazer} disabled={!dirty || saving}>
            Desfazer alterações
          </Button>
          <Button type="submit" disabled={!dirty || saving}>
            {saving ? "Salvando…" : "Salvar alterações"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Conta > Meu perfil  -  layout Account > Profile do Vela (resumo a esquerda, formularios a direita). */
export function MyProfilePage() {
  const session = useActiveSession();
  const [salvo, setSalvo] = useState<NomePessoa>(() => dividirNome(session.name));

  useEffect(() => {
    let vivo = true;
    void fetchMyNames(session.name).then((n) => {
      if (vivo) setSalvo({ nome: n.firstName, sobrenome: n.lastName });
    });
    return () => {
      vivo = false;
    };
    // So na abertura: depois de salvar, `salvo` ja vem do formulario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_1fr] lg:items-start">
      <ProfileSummaryCard salvo={salvo} />
      <div className="flex min-w-0 flex-col gap-5">
        <PersonalDataCard salvo={salvo} onSaved={setSalvo} />
        <PasswordCard />
        <ThemeCard />
      </div>
    </div>
  );
}
