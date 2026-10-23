import { getSupabase } from "@/lib/supabase";
import { validatePassword, PASSWORD_RULE_TEXT } from "@/lib/password";
import { prepararAvatar } from "@/lib/avatar";
import { companyNameCase, titleName } from "@/lib/format";
import { sessionStoreIds, stores } from "@/data/wedash/stores";
import { userByEmail, type User } from "@/data/wedash/team";
import { sessionFromUser, type Session } from "@/session/session";
import { paths } from "@/router/paths";

export const MESSAGE_LOGIN = "E-mail ou senha incorretos.";
export const GENERIC_PASSWORD_MESSAGE = "Não foi possível salvar sua senha. Tente novamente.";
export const MESSAGE_OTP_INVALID = "Código inválido ou expirado. Solicite um novo código.";
export const MESSAGE_OTP_GENERICA = "Não foi possível verificar o código. Tente novamente.";
export const MESSAGE_SESSAO_EXPIRADA = "Sua sessão expirou. Entre novamente.";
const MESSAGE_PHOTO_ENVIO_WITHOUT_DOT = "Não foi possível enviar a foto. Tente novamente";
const MESSAGE_PHOTO_ENVIO = `${MESSAGE_PHOTO_ENVIO_WITHOUT_DOT}.`;
/** Tamanho do OTP de recovery  -  alinhar com Auth  ->  Providers  ->  Email  ->  OTP length. */
export const RECOVERY_OTP_LENGTH = 6;
/** Aceita letra+numero (A - Z / 0 - 9). Se o Dashboard so gerar digitos, continua valido. */
export const RECOVERY_OTP_PATTERN = new RegExp(`^[A-Z0-9]{${RECOVERY_OTP_LENGTH}$`);

export function normalizeRecoveryOtp(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, RECOVERY_OTP_LENGTH);
}

/** Traduz erros do Supabase Auth (ingles) para copy PT da tela Nova senha. */
export function passwordAuthError(error: { code?: string; message?: string } | null): string {
  if (!error) return GENERIC_PASSWORD_MESSAGE;
  const code = (error.code ?? "").toLowerCase();
  const msg = (error.message ?? "").toLowerCase();

  if (code === "same_password" || msg.includes("different from the old password") || msg.includes("same password")) {
    return "A nova senha precisa ser diferente da senha atual.";
  }
  if (code === "weak_password" || msg.includes("weak password") || msg.includes("password should be")) {
    return PASSWORD_RULE_TEXT;
  }
  if (code === "session_not_found" || (msg.includes("session") && msg.includes("not found"))) {
    return MESSAGE_OTP_INVALID;
  }
  if (msg.includes("rate limit") || code.includes("over_request")) {
    return GENERIC_PASSWORD_MESSAGE;
  }
  // Nunca exibir ingles cru na UI.
  return GENERIC_PASSWORD_MESSAGE;
}

/** Traduz erros do Auth na etapa de OTP (recovery). */
export function otpAuthError(error: { code?: string; message?: string } | null): string {
  if (!error) return MESSAGE_OTP_GENERICA;
  const code = (error.code ?? "").toLowerCase();
  const msg = (error.message ?? "").toLowerCase();

  if (
    code === "otp_expired" ||
    code === "otp_disabled" ||
    msg.includes("token has expired") ||
    msg.includes("otp") ||
    msg.includes("invalid") ||
    code === "session_not_found" ||
    (msg.includes("session") && msg.includes("not found"))
  ) {
    return MESSAGE_OTP_INVALID;
  }
  return MESSAGE_OTP_GENERICA;
}

/** sessionStorage: fluxo de recuperacao ativo (nao hidratar app Session). */
export const ROWKEY_RECOVERY = "wedash-password-recovery";
/** E-mail para o qual o OTP de recovery foi pedido. */
export const ROWKEY_RECOVERY_EMAIL = "wedash-recovery-email";

export type AuthResult =
  | { ok: true; session: Session }
  | { ok: false; error: string };

function emailOk(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function markRecovery(): void {
  try {
    sessionStorage.setItem(ROWKEY_RECOVERY, "1");
  } catch {
    /* ignore */
  }
}

export function clearRecovery(): void {
  try {
    sessionStorage.removeItem(ROWKEY_RECOVERY);
    sessionStorage.removeItem(ROWKEY_RECOVERY_EMAIL);
  } catch {
    /* ignore */
  }
}

export function emRecovery(): boolean {
  try {
    return sessionStorage.getItem(ROWKEY_RECOVERY) === "1";
  } catch {
    return false;
  }
}

export function saveRecoveryEmail(email: string): void {
  try {
    sessionStorage.setItem(ROWKEY_RECOVERY_EMAIL, email.trim().toLowerCase());
  } catch {
    /* ignore */
  }
}

export function readRecoveryEmail(): string | null {
  try {
    return sessionStorage.getItem(ROWKEY_RECOVERY_EMAIL);
  } catch {
    return null;
  }
}

/** @deprecated callback de link  -  OTP nao depende disso; mantido por compat. */
export function passwordResetUrl(): string {
  return `${window.location.origin}${paths.access.reset}`;
}

/** Login: Supabase Auth se configurado; senao mock por e-mail (demo). */
export async function loginWithEmail(email: string, password: string): Promise<AuthResult> {
  const e = email.trim().toLowerCase();
  if (!emailOk(e) || !password) return { ok: false, error: MESSAGE_LOGIN };

  const sb = getSupabase();
  if (!sb) {
    await delay(400);
    const u = userByEmail(e);
    if (!u) return { ok: false, error: MESSAGE_LOGIN };
    return { ok: true, session: sessionFromUser(u) };
  }

  clearRecovery();
  const { data, error } = await sb.auth.signInWithPassword({ email: e, password: password });
  if (error || !data.user) return { ok: false, error: MESSAGE_LOGIN };

  const session = await hydrateSessionFromAuth(data.user.id, e);
  if (!session || session === SELLER_SUSPENDED) {
    // Só esta tentativa. O padrão global derrubaria o celular já logado.
    await sb.auth.signOut({ scope: "local" });
    return {
      ok: false,
      error: session === SELLER_SUSPENDED ? "Seu acesso está suspenso. Fale com o responsável pelos acessos da WDash." : MESSAGE_LOGIN,
    };
  }
  return { ok: true, session };
}

/** Sair deste aparelho. Computador e celular são sessões separadas. */
export async function logoutAuth(): Promise<void> {
  clearRecovery();
  const sb = getSupabase();
  if (sb) await sb.auth.signOut({ scope: "local" });
}

/**
 * Pedido de recuperacao por OTP (codigo no e-mail).
 * Sempre resolve OK na UI (anti-enumeration).
 * Demo sem Supabase: grava e-mail + flag para aceitar qualquer codigo de 6 digitos.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const e = email.trim().toLowerCase();
  const sb = getSupabase();
  if (!sb) {
    await delay(600);
    if (emailOk(e)) {
      saveRecoveryEmail(e);
      markRecovery();
    }
    return;
  }
  if (!emailOk(e)) {
    await delay(600);
    return;
  }
  saveRecoveryEmail(e);
  markRecovery();
  // Dispara e-mail de recovery. O template no Dashboard deve mostrar {{ .Token }} (OTP).
  await sb.auth.resetPasswordForEmail(e);
}

/**
 * Valida o OTP de recovery (abre sessao Auth; app Session continua bloqueada por emRecovery).
 */
export async function verifyRecoveryOtp(
  email: string,
  otp: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const e = email.trim().toLowerCase();
  const code = normalizeRecoveryOtp(otp);
  if (!emailOk(e) || !RECOVERY_OTP_PATTERN.test(code)) {
    return { ok: false, error: MESSAGE_OTP_INVALID };
  }

  const sb = getSupabase();
  if (!sb) {
    await delay(400);
    if (!emRecovery()) return { ok: false, error: MESSAGE_OTP_INVALID };
    return { ok: true };
  }

  markRecovery();
  const { error } = await sb.auth.verifyOtp({
    email: e,
    token: code,
    type: "recovery",
  });
  if (error) return { ok: false, error: otpAuthError(error) };
  return { ok: true };
}

/**
 * @deprecated preferir verifyRecoveryOtp + updatePassword (telas separadas).
 * Mantido por compat  -  valida OTP e define senha numa chamada.
 */
export async function resetPasswordWithOtp(
  email: string,
  otp: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const verified = await verifyRecoveryOtp(email, otp);
  if (!verified.ok) return verified;
  const updated = await updatePassword(newPassword);
  if (!updated.ok) return { ok: false, error: updated.error ?? GENERIC_PASSWORD_MESSAGE };
  return { ok: true };
}

/**
 * Ha sessao Auth valida para redefinir senha sem OTP?
 * (compat: link antigo do e-mail ainda pode abrir sessao de recovery)
 */
export async function canResetPassword(): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return emRecovery();
  const { data } = await sb.auth.getSession();
  if (data.session) return true;
  return emRecovery();
}

/** Redefine senha quando ja existe sessao de recovery (OTP ou link legado). */
export async function updatePassword(newPassword: string): Promise<{ ok: boolean; error?: string }> {
  const check = validatePassword(newPassword);
  if (!check.ok) return { ok: false, error: check.error };
  const sb = getSupabase();
  if (!sb) {
    await delay(500);
    clearRecovery();
    return { ok: true };
  }
  const { error } = await sb.auth.updateUser({ password: newPassword });
  if (error) return { ok: false, error: passwordAuthError(error) };

  // Recovery define senha definitiva  -  limpa a flag de provisoria antes do signOut.
  const { error: flagErr } = await sb.rpc("clear_own_temporary_password");
  if (flagErr) console.warn("updatePassword temporary_password:", flagErr.message);

  clearRecovery();
  await sb.auth.signOut();
  return { ok: true };
}

/** Restaura Session a partir da session Supabase (reload). Ignora se em recovery. */
export async function sessionFromPersistedAuth(): Promise<Session | null> {
  if (emRecovery()) return null;
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  const user = data.session?.user;
  if (!user?.email) return null;
  const session = await hydrateSessionFromAuth(user.id, user.email);
  if (session === SELLER_SUSPENDED) {
    await sb.auth.signOut();
    return null;
  }
  return session;
}

/** Acesso suspenso: a sessao do Auth e encerrada e o login mostra o aviso. */
export const SELLER_SUSPENDED = "seller_suspended";

async function hydrateSessionFromAuth(authUserId: string, email: string): Promise<Session | typeof SELLER_SUSPENDED | null> {
  const sb = getSupabase();
  if (!sb) return null;

  const { data: ident } = await sb
    .from("identity")
    .select("id, name, email, cpf, avatar_url, status, temporary_password")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (!ident || ident.status !== "ACTIVE") return null;

  const { data: memb } = await sb
    .from("membership")
    .select("id, role, is_owner, onboarding_step, status, tenant_id")
    .eq("identity_id", ident.id)
    .eq("status", "ACTIVE")
    .maybeSingle();

  if (!memb) {
    const { data: suspended } = await sb
      .from("membership")
      .select("role")
      .eq("identity_id", ident.id)
      .eq("status", "SUSPENDED")
      .eq("role", "SELLER")
      .limit(1)
      .maybeSingle();
    if (suspended) return SELLER_SUSPENDED;
    const u = userByEmail(email);
    return u ? sessionFromUser(u) : null;
  }

  const { data: ten } = await sb
    .from("tenant")
    .select("name")
    .eq("id", memb.tenant_id)
    .maybeSingle();

  const { data: storeRows } = await sb.from("membership_store").select("store_id").eq("membership_id", memb.id);
  const linkedIds = (storeRows ?? []).map((r) => r.store_id as string);
  const { data: tenantStores } = await sb.from("store").select("id, active").eq("tenant_id", memb.tenant_id);
  const catalog = (tenantStores ?? []).map((r) => ({ id: r.id as string, active: r.active !== false }));
  // Sem lojas vinculadas = todas as ativas. Desativada fica fora mesmo com vinculo.
  let storeIds = sessionStoreIds({ linkedIds, tenantStores: catalog, role: memb.role });
  if (storeIds.length === 0 && catalog.length === 0 && memb.role !== "SELLER") storeIds = stores.map((f) => f.id);

  return {
    membershipId: memb.id,
    name: titleName(ident.name),
    cpf: ident.cpf ?? "",
    email: ident.email,
    avatarUrl: ident.avatar_url ?? null,
    role: memb.role as Session["role"],
    isOwner: memb.is_owner,
    stores: storeIds,
    collaboratorId: null,
    onboardingStep: memb.onboarding_step,
    temporaryPassword: Boolean(ident.temporary_password),
    tenantId: memb.tenant_id,
    companyName: companyNameCase(ten?.name ?? ""),
    appInstalled: false,
  };
}

/**
 * Sobe a foto de perfil (ja reduzida) para `avatars/{auth.uid}/...` e devolve a URL publica.
 * Nome unico por envio: evita cache antigo do navegador/CDN ao trocar de foto.
 */
export async function uploadAvatar(photo: File): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: true, url: URL.createObjectURL(photo) };
  const { data: userData } = await sb.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return { ok: false, error: MESSAGE_SESSAO_EXPIRADA };
  let blob: Blob;
  try {
    blob = await prepararAvatar(photo);
  } catch {
    return { ok: false, error: "Não foi possível abrir essa imagem. Tente outra foto." };
  }
  const path = `${uid}/${Date.now()}.jpg`;
  const { error } = await sb.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg" });
  if (error) {
    console.warn("uploadAvatar:", error.message);
    return { ok: false, error: MESSAGE_PHOTO_ENVIO };
  }
  return { ok: true, url: sb.storage.from("avatars").getPublicUrl(path).data.publicUrl };
}

export type CreateAccessInput = { firstName: string; lastName: string; password: string; photo: File | null };

/**
 * "Crie seu acesso" (primeiro acesso): sobe a foto (opcional), grava nome, sobrenome e foto na
 * identity, troca a senha temporaria no Auth e desliga a flag. Sessao permanece (diferente do
 * recovery, que faz signOut).
 */
export async function createAccess(
  input: CreateAccessInput,
): Promise<{ ok: true; name: string; avatarUrl: string | null } | { ok: false; error: string }> {
  const check = validatePassword(input.password);
  if (!check.ok) return { ok: false, error: check.error };

  const firstName = titleName(input.firstName);
  const lastName = titleName(input.lastName);
  const name = titleName(`${firstName} ${lastName}`);

  const sb = getSupabase();
  if (!sb) {
    await delay(400);
    return { ok: true, name, avatarUrl: input.photo ? URL.createObjectURL(input.photo) : null };
  }

  const { data: userData } = await sb.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return { ok: false, error: "Sua sessão expirou. Entre novamente com a senha temporária." };

  let avatarUrl: string | null = null;
  if (input.photo) {
    const up = await uploadAvatar(input.photo);
    if (!up.ok) {
      return { ok: false, error: up.error === MESSAGE_PHOTO_ENVIO ? `${MESSAGE_PHOTO_ENVIO_WITHOUT_DOT} ou continue sem foto.` : up.error };
    }
    avatarUrl = up.url;
  }

  // Nome e foto antes da senha: se a troca falhar, tentar de novo nao esbarra em "senha igual a anterior".
  const { error: idErr } = await sb
    .from("identity")
    .update({ first_name: firstName, last_name: lastName, name, ...(avatarUrl ? { avatar_url: avatarUrl } : {}) })
    .eq("auth_user_id", uid);
  if (idErr) {
    console.warn("createAccess identity:", idErr.message);
    return { ok: false, error: "Não foi possível salvar seus dados. Tente novamente." };
  }

  const { error } = await sb.auth.updateUser({ password: input.password });
  if (error) return { ok: false, error: passwordAuthError(error) };

  const { error: flagErr } = await sb.rpc("clear_own_temporary_password");
  if (flagErr) console.warn("createAccess temporary_password:", flagErr.message);
  return { ok: true, name, avatarUrl };
}

/** Nome e sobrenome gravados na identity (Meu perfil). Sem os campos separados, divide o nome. */
export async function fetchMyNames(fallbackName: string): Promise<{ firstName: string; lastName: string }> {
  const dividir = () => {
    const [first = "", ...rest] = fallbackName.trim().split(/\s+/);
    return { firstName: first, lastName: rest.join(" ") };
  };
  const sb = getSupabase();
  if (!sb) return dividir();
  const { data: userData } = await sb.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return dividir();
  const { data } = await sb.from("identity").select("first_name, last_name").eq("auth_user_id", uid).maybeSingle();
  if (!data?.first_name) return dividir();
  return { firstName: titleName(data.first_name), lastName: titleName(data.last_name ?? "") };
}

export type SaveProfileInput = { firstName: string; lastName: string; photo: File | null; removePhoto: boolean };

/** Meu perfil: grava nome e sobrenome de gestor e gerente, e a foto. O vendedor só troca a foto; o nome fica o do Millennium. */
export async function saveMyProfile(
  input: SaveProfileInput,
): Promise<{ ok: true; name: string; avatarUrl: string | null | undefined } | { ok: false; error: string }> {
  const firstName = titleName(input.firstName);
  const lastName = titleName(input.lastName);
  const name = titleName(`${firstName} ${lastName}`);

  const sb = getSupabase();
  if (!sb) {
    await delay(300);
    const avatarUrl = input.photo ? URL.createObjectURL(input.photo) : input.removePhoto ? null : undefined;
    return { ok: true, name, avatarUrl };
  }

  const { data: userData } = await sb.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return { ok: false, error: MESSAGE_SESSAO_EXPIRADA };

  const { data: ident } = await sb.from("identity").select("id, name").eq("auth_user_id", uid).maybeSingle();
  if (!ident) return { ok: false, error: MESSAGE_SESSAO_EXPIRADA };
  const { data: memb } = await sb
    .from("membership")
    .select("role")
    .eq("identity_id", ident.id)
    .eq("status", "ACTIVE")
    .limit(1)
    .maybeSingle();
  const keepsErpName = memb?.role === "SELLER";

  let avatarUrl: string | null | undefined;
  if (input.photo) {
    const up = await uploadAvatar(input.photo);
    if (!up.ok) return up;
    avatarUrl = up.url;
  } else if (input.removePhoto) {
    avatarUrl = null;
  }

  const patch: { first_name?: string; last_name?: string; name?: string; avatar_url?: string | null } = keepsErpName
    ? {}
    : { first_name: firstName, last_name: lastName, name };
  if (avatarUrl !== undefined) patch.avatar_url = avatarUrl;
  if (Object.keys(patch).length > 0) {
    const { error } = await sb.from("identity").update(patch).eq("auth_user_id", uid);
    if (error) {
      console.warn("saveMyProfile:", error.message);
      return { ok: false, error: "Não foi possível salvar as alterações. Tente novamente." };
    }
  }
  return { ok: true, name: keepsErpName ? titleName(ident.name) : name, avatarUrl };
}

/** Meu perfil: confere a senha atual (novo login) e troca a senha sem encerrar a sessao. */
export async function changeMyPassword(email: string, current: string, isNew: string): Promise<{ ok: boolean; error?: string }> {
  const check = validatePassword(isNew);
  if (!check.ok) return { ok: false, error: check.error };
  const sb = getSupabase();
  if (!sb) {
    await delay(400);
    return { ok: true };
  }
  const { error: loginErr } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: current });
  if (loginErr) return { ok: false, error: "Senha atual incorreta." };
  const { error } = await sb.auth.updateUser({ password: isNew });
  if (error) {
    const msg = passwordAuthError(error);
    if (msg === MESSAGE_OTP_INVALID) return { ok: false, error: MESSAGE_SESSAO_EXPIRADA };
    if (msg === GENERIC_PASSWORD_MESSAGE) return { ok: false, error: "Não foi possível alterar sua senha. Tente novamente." };
    return { ok: false, error: msg };
  }
  return { ok: true };
}

/** Destino apos login / troca de senha / raiz. */
export function destinationAfterAuth(s: Session, from?: string | null): string {
  if (s.temporaryPassword) return paths.access.createAccess;
  if (s.onboardingStep !== null) return paths.onboarding;
  // Pos-onboarding: nao manda pro Dash enquanto a carga inicial nao terminou.
  try {
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem("wedash.awaitingInitialSync") === "1") {
      return paths.syncing;
    }
  } catch {
    /* ignore */
  }
  if (from && from !== "/" && !from.startsWith(paths.access.login)) return from;
  if (s.role === "SELLER") return paths.seller.home;
  return paths.overview;
}

/** Persiste progresso/conclusao do onboarding no membership (null = concluido). */
export async function saveOnboardingStep(membershipId: string, step: number | null): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("membership").update({ onboarding_step: step }).eq("id", membershipId);
  if (error) console.warn("saveOnboardingStep:", error.message);
}

/** Substitui o escopo de lojas do membership (ids do catalogo local, ex.: f1 / erp-8). */
export async function saveMembershipStores(membershipId: string, storeIds: string[]): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error: delErr } = await sb.from("membership_store").delete().eq("membership_id", membershipId);
  if (delErr) {
    console.warn("saveMembershipStores delete:", delErr.message);
    return;
  }
  if (storeIds.length === 0) return;
  const rows = storeIds.map((store_id) => ({ membership_id: membershipId, store_id }));
  const { error } = await sb.from("membership_store").insert(rows);
  if (error) console.warn("saveMembershipStores insert:", error.message);
}

export type PersistErpInput = {
  tenantId: string;
  membershipId: string;
  username: string;
  password: string;
  dedicated: boolean;
  /** Sessao Millennium ja aberta no Step2  -  grava p/ o worker reusar. */
  millenniumSession?: string;
  /** Troca de usuario mantendo dados: remove so as lojas que o usuario novo nao enxerga. */
  userChange?: { mode: "keep"; removeMillenniumStoreIds: number[] };
  /** Conta adicional: não apaga as outras. Filial já existente fica onde está. */
  mode?: "add";
  /** Vazio no Step2 (so credencial); preenchido ao concluir lojas. */
  stores?: Array<{
    storeId: number;
    code?: string;
    name?: string;
    tradeName?: string;
    taxId?: string;
    openedAt?: string;
    hasWpink?: boolean;
  }>;
};

export type PersistErpResult =
  | {
      ok: true;
      storeIds: string[];
      addedStoreIds: string[];
      skipped: { storeId: number; name: string }[];
      lightIntervalMin: number;
    }
  | { ok: false; error: string; skipped?: { storeId: number; name: string }[] };

/**
 * Persiste erp_credential (senha cifrada no Edge) + store rows e remapeia membership_store.
 * light_interval_min = 5 (mesmo ritmo do botao Atualizar / FORCE).
 */
export async function persistErpCredentialAndStores(
  input: PersistErpInput,
): Promise<PersistErpResult> {
  const sb = getSupabase();
  if (!sb) {
    const storeIds = (input.stores ?? []).map((s) => `erp-${s.storeId}`);
    return {
      ok: true,
      storeIds,
      addedStoreIds: storeIds,
      skipped: [],
      lightIntervalMin: 5,
    };
  }

  const { data, error } = await sb.functions.invoke("erp-credential-persist", {
    body: {
      tenantId: input.tenantId,
      membershipId: input.membershipId,
      username: input.username,
      password: input.password,
      dedicated: input.dedicated,
      stores: input.stores ?? [],
      ...(input.millenniumSession
        ? { millenniumSession: input.millenniumSession }
        : {}),
      ...(input.userChange ? { userChange: input.userChange } : {}),
      ...(input.mode ? { mode: input.mode } : {}),
    },
  });

  if (error) {
    console.warn("erp-credential-persist:", error.message);
    return { ok: false, error: error.message };
  }

  const body = data as {
    ok?: boolean;
    storeIds?: string[];
    addedStoreIds?: string[];
    skipped?: { storeId: number; name: string }[];
    lightIntervalMin?: number;
    error?: string;
  } | null;

  if (!body?.ok || !Array.isArray(body.storeIds)) {
    return { ok: false, error: body?.error ?? "persist_failed", skipped: body?.skipped };
  }

  return {
    ok: true,
    storeIds: body.storeIds,
    addedStoreIds: body.addedStoreIds ?? [],
    skipped: body.skipped ?? [],
    lightIntervalMin: body.lightIntervalMin ?? 5,
  };
}

/** Marca o usuario logado como ativo (coluna Ultimo acesso em Configuracoes > Usuarios). */
export async function touchLastSeen(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.rpc("touch_last_seen");
  if (error) console.warn("touch_last_seen:", error.message);
}

export type ThemeChoice = "light" | "dark" | "system";

/** Aparencia salva na conta (Meu perfil). `null` = nunca escolheu, sem banco ou falha. */
export async function fetchThemePreference(): Promise<ThemeChoice | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: auth } = await sb.auth.getSession();
  const user = auth.session?.user;
  if (!user) return null;
  const { data, error } = await sb
    .from("identity")
    .select("theme_preference")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (error) {
    console.warn("fetchThemePreference:", error.message);
    return null;
  }
  const p = data?.theme_preference;
  return p === "light" || p === "dark" || p === "system" ? p : null;
}

export async function saveThemePreference(p: ThemeChoice): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { data: auth } = await sb.auth.getSession();
  const user = auth.session?.user;
  if (!user) return false;
  const { error } = await sb.from("identity").update({ theme_preference: p }).eq("auth_user_id", user.id);
  if (error) {
    console.warn("saveThemePreference:", error.message);
    return false;
  }
  return true;
}

/** Para seed/manual: monta Session a partir de User fixture. */
export function mockSessionFromUser(u: User): Session {
  return sessionFromUser(u);
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
