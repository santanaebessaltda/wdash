import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardSubtitle,
  CardTitle,
  Checkbox,
  DataTable,
  type DataTableColumn,
  Dropdown,
  EmptyState,
  FormField,
  Input,
  Modal,
  Segmented,
  Tooltip,
  useToast,
} from "@/components/ui";
import { UsersTableSkeleton } from "@/components/wedash/LoadingSkeletons";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { Icon, icons } from "@/pages/users/Icons";
import { accessLabel, roleLabel } from "@/session/session";
import {
  copySystemUserInviteLink,
  fetchSystemUsers,
  inviteSystemUser,
  systemUserAction,
  updateSystemUser,
  type SystemRole,
  type SystemUser,
  type SystemUserStore,
} from "@/data/wedash/systemUsers";

const ROLE_OPTIONS: { value: SystemRole; label: string }[] = [
  { value: "OWNER", label: roleLabel.OWNER },
  { value: "MANAGER", label: roleLabel.MANAGER },
];

const ROLE_HINT: Record<SystemRole, string> = {
  OWNER:
    "Acessa todas as áreas das lojas selecionadas, inclusive Financeiro, e pode gerenciar usuários e integrações. Indicado para sócios e administrativo.",
  MANAGER:
    "Acessa o Dashboard das lojas selecionadas, exceto Financeiro, além de Gestão e dos horários de funcionamento.",
};

/** A Edge devolve o mesmo codigo para o Gestor principal e para o proprio acesso; a tela sabe qual dos dois e. */
function errorMessage(r: { message: string; code?: string }, user: SystemUser | null): string {
  if (r.code === "protected_member" && user?.isSelf) return "Seu próprio acesso não pode ser alterado aqui.";
  return r.message;
}

function fmtAgo(iso: string | null): string {
  if (!iso) return "Nunca";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `há ${d} dia${d > 1 ? "s" : ""}`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

function storesLabel(ids: string[], stores: SystemUserStore[]): { text: string; title?: string } {
  if (ids.length === 0) return { text: "Todas as lojas" };
  const names = ids.map((id) => stores.find((s) => s.id === id)?.name ?? "Loja removida");
  if (names.length <= 2) return { text: names.join(", ") };
  return { text: `${names.length} lojas`, title: names.join(" · ") };
}

/** Convite ainda nao aceito nao tem nome: mostra o e-mail. */
function displayName(u: SystemUser): string {
  return u.name || u.email;
}

type Editing = { mode: "invite" } | { mode: "edit"; user: SystemUser };
type Confirming = { action: "suspend" | "revoke"; user: SystemUser };

/** Configuracoes > Usuarios  -  gestores e gerentes com acesso ao WDash (so o Gestor gerencia). */
export function SystemUsersPage() {
  const { show } = useToast();
  const [members, setMembers] = useState<SystemUser[]>([]);
  const [stores, setStores] = useState<SystemUserStore[]>([]);
  const [loading, setLoading] = useState(true);
  const showSkeleton = useMinSkeleton(loading);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"people" | "invites">("people");

  const load = useCallback(async () => {
    const r = await fetchSystemUsers();
    if (r.ok) {
      setMembers(r.data.members);
      setStores(r.data.stores);
      setLoadError(null);
    } else {
      setLoadError(r.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const people = useMemo(() => members.filter((m) => m.status !== "PENDING"), [members]);
  const invites = useMemo(() => members.filter((m) => m.status === "PENDING"), [members]);

  async function run(action: "resend" | "suspend" | "reactivate" | "revoke", user: SystemUser) {
    setBusy(true);
    const r = await systemUserAction(action, user.membershipId);
    setBusy(false);
    setConfirming(null);
    if (!r.ok) {
      show(errorMessage(r, user), "danger");
      return;
    }
    const done = {
      resend: `Convite reenviado para ${user.email}.`,
      suspend: `Acesso de ${displayName(user)} suspenso.`,
      reactivate: `Acesso de ${displayName(user)} reativado.`,
      revoke: "Convite cancelado.",
    }[action];
    show(done, "success");
    await load();
  }

  async function copyLink(user: SystemUser) {
    const r = await copySystemUserInviteLink(user.membershipId);
    if (!r.ok) return show(r.message, "danger");
    try {
      await navigator.clipboard.writeText(r.token);
      show("Link copiado.", "success");
    } catch {
      show("Não foi possível copiar o link. Tente novamente.", "danger");
    }
  }

  const nameColumn: DataTableColumn<SystemUser> = {
    key: "name",
    header: "Nome",
    sortable: true,
    sortValue: (u) => displayName(u).toLowerCase(),
    render: (u) => (
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={displayName(u)} size="sm" />
        <div className="min-w-0">
          <p className="flex items-center gap-2 truncate text-[13px] font-bold text-t0">
            <span className="truncate">{displayName(u)}</span>
            {u.isSelf && <Badge variant="neutral">Você</Badge>}
          </p>
          {u.name && <p className="truncate text-xs text-t2">{u.email}</p>}
        </div>
      </div>
    ),
  };
  const roleColumn: DataTableColumn<SystemUser> = {
    key: "role",
    header: "Tipo de acesso",
    render: (u) =>
      u.isOwner ? (
        <Tooltip label="Criou a conta da empresa e não pode ter o acesso alterado aqui.">
          <Badge variant="accent" className="cursor-help">
            {accessLabel(u.role, true)}
          </Badge>
        </Tooltip>
      ) : (
        <Badge variant={u.role === "OWNER" ? "accent" : "info"}>{roleLabel[u.role]}</Badge>
      ),
  };
  const emailColumn: DataTableColumn<SystemUser> = {
    key: "email",
    header: "E-mail",
    sortable: true,
    sortValue: (u) => u.email.toLowerCase(),
    render: (u) => (
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={u.email} size="sm" />
        <span className="truncate text-[13px] font-bold text-t0">{u.email}</span>
      </div>
    ),
  };
  const storesColumn: DataTableColumn<SystemUser> = {
    key: "stores",
    header: "Lojas",
    hideBelow: "md",
    render: (u) => {
      const l = storesLabel(u.storeIds, stores);
      return (
        <span className="text-[13px] text-t1" title={l.title}>
          {l.text}
        </span>
      );
    },
  };

  const peopleColumns: DataTableColumn<SystemUser>[] = [
    nameColumn,
    roleColumn,
    storesColumn,
    {
      key: "status",
      header: "Status",
      render: (u) => <Badge variant={u.status === "ACTIVE" ? "success" : "danger"}>{u.status === "ACTIVE" ? "Ativo" : "Suspenso"}</Badge>,
    },
    {
      key: "last",
      header: "Último acesso",
      hideBelow: "lg",
      render: (u) => <span className="text-xs text-t2">{fmtAgo(u.lastSignInAt)}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (u) =>
        u.isOwner || u.isSelf ? null : (
          <RowMenu
            items={[
              { label: "Editar acesso", onClick: () => setEditing({ mode: "edit", user: u }) },
              u.status === "ACTIVE"
                ? { label: "Suspender acesso", danger: true, onClick: () => setConfirming({ action: "suspend", user: u }) }
                : { label: "Reativar acesso", onClick: () => void run("reactivate", u) },
            ]}
          />
        ),
    },
  ];

  const inviteColumns: DataTableColumn<SystemUser>[] = [
    emailColumn,
    roleColumn,
    storesColumn,
    {
      key: "sent",
      header: "Enviado em",
      hideBelow: "sm",
      render: (u) => <span className="text-xs text-t2">{fmtAgo(u.invitedAt)}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (u) => (
        <RowMenu
          items={[
            { label: "Copiar link", onClick: () => void copyLink(u) },
            { label: "Reenviar convite", onClick: () => void run("resend", u) },
            { label: "Editar acesso", onClick: () => setEditing({ mode: "edit", user: u }) },
            { label: "Cancelar convite", danger: true, onClick: () => setConfirming({ action: "revoke", user: u }) },
          ]}
        />
      ),
    },
  ];

  const inviteButton = (
    <Button size="sm" icon={<Icon d={icons.plus} size={14} />} onClick={() => setEditing({ mode: "invite" })}>
      Convidar usuário
    </Button>
  );

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Usuários</CardTitle>
          <CardSubtitle>Acessos ativos, suspensos e convites pendentes.</CardSubtitle>
        </div>
        <Button icon={<Icon d={icons.plus} size={14} />} onClick={() => setEditing({ mode: "invite" })}>
          Convidar usuário
        </Button>
      </div>

      {showSkeleton ? (
        <UsersTableSkeleton />
      ) : loadError ? (
        <span className="block py-6 text-center text-[12px] text-t2">{loadError}</span>
      ) : (
        <>
          <Segmented
            className="mb-4"
            options={[
              { value: "people", label: `Usuários (${people.length})` },
              { value: "invites", label: `Convites pendentes (${invites.length})` },
            ]}
            value={tab}
            onChange={(v) => v && setTab(v)}
          />
          {tab === "people" ? (
            <DataTable
              columns={peopleColumns}
              data={people}
              rowKey={(u) => u.membershipId}
              paginate="usuários"
              empty={
                <EmptyState
                  framed={false}
                  icon="👤"
                  title="Nenhum usuário cadastrado"
                  description="Convide gestores e gerentes para acessar a WDash."
                  action={inviteButton}
                />
              }
            />
          ) : (
            <DataTable
              columns={inviteColumns}
              data={invites}
              rowKey={(u) => u.membershipId}
              paginate="convites"
              empty={
                <EmptyState
                  framed={false}
                  icon="✉️"
                  title="Nenhum convite pendente"
                  description="Os convites aparecem aqui até a pessoa criar o acesso."
                  action={inviteButton}
                />
              }
            />
          )}
        </>
      )}

      {editing && (
        <UserModal
          editing={editing}
          stores={stores}
          onClose={() => setEditing(null)}
          onDone={async (msg, toInvites) => {
            setEditing(null);
            show(msg, "success");
            if (toInvites) setTab("invites");
            await load();
          }}
        />
      )}

      <Modal
        open={confirming != null}
        onClose={() => !busy && setConfirming(null)}
        size="sm"
        title={confirming?.action === "revoke" ? "Cancelar convite?" : "Suspender acesso?"}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirming(null)} disabled={busy}>
              Voltar
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => confirming && void run(confirming.action, confirming.user)}>
              {confirming?.action === "revoke"
                ? busy
                  ? "Cancelando…"
                  : "Cancelar convite"
                : busy
                  ? "Suspendendo…"
                  : "Suspender acesso"}
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-t1">
          {confirming?.action === "revoke"
            ? `O link enviado para ${confirming.user.email} deixará de funcionar.`
            : `${confirming ? displayName(confirming.user) : ""} não poderá mais entrar na WDash. O acesso poderá ser reativado depois.`}
        </p>
      </Modal>
    </Card>
  );
}

function RowMenu({ items }: { items: { label: string; danger?: boolean; onClick: () => void }[] }) {
  return (
    <Dropdown
      align="right"
      portal
      items={items}
      trigger={
        <button
          type="button"
          aria-label="Ações"
          className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] text-t1 hover:bg-bg-3"
        >
          <Icon d={icons.dots} size={16} />
        </button>
      }
    />
  );
}

function UserModal({
  editing,
  stores,
  onClose,
  onDone,
}: {
  editing: Editing;
  stores: SystemUserStore[];
  onClose: () => void;
  onDone: (message: string, toInvites: boolean) => void | Promise<void>;
}) {
  const user = editing.mode === "edit" ? editing.user : null;
  const isInvite = user?.status === "PENDING";
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState<SystemRole>(user?.role ?? "MANAGER");
  const [allStores, setAllStores] = useState(user ? user.storeIds.length === 0 : false);
  const [picked, setPicked] = useState<Set<string>>(new Set(user?.storeIds ?? []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const storeIds = allStores ? [] : [...picked];
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && (allStores || picked.size > 0);

  function toggleAll(checked: boolean) {
    setAllStores(checked);
    setPicked(new Set());
  }

  function toggle(id: string) {
    if (allStores) {
      setAllStores(false);
      setPicked(new Set(stores.map((s) => s.id).filter((sid) => sid !== id)));
      return;
    }
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    const r = user
      ? await updateSystemUser(user.membershipId, role, storeIds)
      : await inviteSystemUser({ email: email.trim(), role, storeIds });
    setSaving(false);
    if (!r.ok) {
      setError(errorMessage(r, user));
      return;
    }
    await onDone(
      !user
        ? `Convite enviado para ${email.trim().toLowerCase()}.`
        : isInvite
          ? "Convite atualizado."
          : "Acesso atualizado.",
      !user,
    );
  }

  return (
    <Modal
      open
      onClose={() => !saving && onClose()}
      title={
        !user ? "Convidar usuário" : isInvite ? `Editar convite · ${user.email}` : `Editar acesso · ${displayName(user)}`
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} disabled={!valid || saving}>
            {user ? (saving ? "Salvando…" : "Salvar alterações") : saving ? "Enviando…" : "Enviar convite"}
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        {!user && (
          <FormField
            label="E-mail"
            required
            hint="O convite será enviado para este e-mail. Ao abrir o link, a pessoa informa o nome e cria a senha."
          >
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@empresa.com" autoFocus />
          </FormField>
        )}
        <FormField label="Tipo de acesso" required hint={ROLE_HINT[role]}>
          <Segmented options={ROLE_OPTIONS} value={role} onChange={(v) => v && setRole(v)} />
        </FormField>
        <FormField label="Lojas" required hint={!allStores && picked.size === 0 ? "Escolha pelo menos uma loja." : undefined}>
          <div className="overflow-hidden rounded-[var(--radius-vela-md)] border border-line">
            <Checkbox
              className="flex w-full cursor-pointer px-3.5 py-3"
              label={
                <span className="min-w-0">
                  <span className="block font-semibold">Todas as lojas</span>
                  <span className="block text-[11.5px] text-t2">Inclui automaticamente as lojas adicionadas no futuro.</span>
                </span>
              }
              checked={allStores}
              onChange={(e) => toggleAll(e.target.checked)}
            />
            <div className="max-h-[240px] divide-y divide-line overflow-y-auto border-t border-line">
              {stores.length === 0 && <p className="px-3.5 py-3 text-[12.5px] text-t2">Nenhuma loja cadastrada.</p>}
              {stores.map((s) => (
                <Checkbox
                  key={s.id}
                  className="flex w-full cursor-pointer px-3.5 py-2.5 hover:bg-bg-3"
                  label={
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate" title={s.name}>
                        {s.name}
                      </span>
                      {s.code && <span className="shrink-0 text-[11.5px] text-t2">Filial {s.code}</span>}
                    </span>
                  }
                  checked={allStores || picked.has(s.id)}
                  onChange={() => toggle(s.id)}
                />
              ))}
            </div>
          </div>
        </FormField>
        {error && <p className="text-[12.5px] font-medium text-bad">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export default SystemUsersPage;
