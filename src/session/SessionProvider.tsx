import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { User } from "@/data/wedash/team";
import { getSupabase } from "@/lib/supabase";
import { companyNameCase, titleName } from "@/lib/format";
import { paths } from "@/router/paths";
import {
  emRecovery,
  clearRecovery,
  logoutAuth,
  markRecovery,
  sessionFromPersistedAuth,
} from "@/session/authApi";
import { accessLabel, roleLabel, sessionFromUser, storesKey, type Session } from "@/session/session";
import { clearAllPendingForce } from "@/data/wedash/syncUi";
import { clearSavedPeriod } from "@/session/periodStorage";
import { requestPermissionAfterLogin, watchSalesPush } from "@/push/salesPush";

export type { Session };
export { accessLabel, roleLabel, sessionFromUser };

interface SessionContextValue {
  session: Session | null;
  ready: boolean;
  signIn: (username: User) => Session;
  applySession: (s: Session) => void;
  signOut: () => void;
  update: (patch: Partial<Session>) => void;
}

const ROWKEY = "wedash-session";
const ROWKEY_LEGACY = "wedash-sessao";

const Contexto = createContext<SessionContextValue | null>(null);

function migrateLegacySession(raw: Record<string, unknown>): Session {
  return {
    membershipId: (raw.membershipId ?? raw.vinculoId) as string,
    name: titleName((raw.name ?? raw.name) as string),
    cpf: raw.cpf as string,
    email: raw.email as string,
    avatarUrl: (raw.avatarUrl as string | null | undefined) ?? null,
    role: raw.role as Session["role"],
    isOwner: Boolean(raw.isOwner ?? raw.proprietario),
    stores: (raw.stores as string[]) ?? [],
    collaboratorId: (raw.collaboratorId ?? raw.employeeId ?? null) as string | null,
    onboardingStep: (raw.onboardingStep ?? raw.onboardingEtapa ?? null) as number | null,
    temporaryPassword: Boolean(raw.temporaryPassword ?? raw.temporaryPassword),
    tenantId: raw.tenantId as string,
    companyName: companyNameCase((raw.companyName ?? raw.empresaName ?? raw.name ?? raw.name ?? "") as string),
    appInstalled: Boolean(raw.appInstalled ?? raw.appInstalado),
  };
}

function ler(): Session | null {
  try {
    let raw = window.localStorage.getItem(ROWKEY);
    if (!raw) {
      raw = window.localStorage.getItem(ROWKEY_LEGACY);
      if (raw) {
        window.localStorage.removeItem(ROWKEY_LEGACY);
      }
    }
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return migrateLegacySession(parsed);
  } catch {
    return null;
  }
}

function save(s: Session | null) {
  try {
    if (s) window.localStorage.setItem(ROWKEY, JSON.stringify(s));
    else window.localStorage.removeItem(ROWKEY);
    window.localStorage.removeItem(ROWKEY_LEGACY);
  } catch {
    /* armazenamento indisponivel */
  }
}

/** JWT do Supabase ainda no localStorage? (race PWA: getSession null com token presente) */
function hasStoredAuthToken(): boolean {
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || !k.startsWith("sb-") || !k.endsWith("-auth-token")) continue;
      const v = window.localStorage.getItem(k);
      if (v && v !== "null" && v.includes("access_token")) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function mergeWithCache(fromAuth: Session, cached: Session | null): Session {
  if (!cached || cached.membershipId !== fromAuth.membershipId) return fromAuth;
  return {
    ...fromAuth,
    onboardingStep:
      cached.onboardingStep === null
        ? null
        : fromAuth.onboardingStep === null
          ? null
          : Math.max(cached.onboardingStep, fromAuth.onboardingStep),
    // Flag de senha provisoria sempre do Auth/DB — cache nunca engole um reset admin.
    temporaryPassword: fromAuth.temporaryPassword,
    companyName:
      cached.companyName && cached.onboardingStep === null ? cached.companyName : fromAuth.companyName,
    appInstalled: cached.appInstalled || fromAuth.appInstalled,
  };
}

/**
 * O supabase-js emite SIGNED_IN de novo toda vez que a aba volta a ficar visivel. Sessao igual
 * mantem o mesmo objeto (e o mesmo array de lojas)  -  senao as telas recarregam com skeleton.
 */
function keepIfSame(current: Session | null, isNew: Session): Session {
  if (!current) return isNew;
  // Lojas vem do banco sem ordem garantida: mesma lista em outra ordem = mesmas lojas.
  const sameStores = storesKey(current.stores) === storesKey(isNew.stores);
  const candidata = sameStores ? { ...isNew, stores: current.stores } : isNew;
  return JSON.stringify(current) === JSON.stringify(candidata) ? current : candidata;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  // PWA: restaurar cache na 1 paint  -  senao / e RequireSession bounce pro login.
  const [session, setSession] = useState<Session | null>(() =>
    typeof window !== "undefined" ? ler() : null,
  );
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!session) return;
    void requestPermissionAfterLogin(session.tenantId, session.membershipId);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    return watchSalesPush(session.tenantId);
  }, [session]);

  useEffect(() => {
    let cancel = false;
    let unsub: (() => void) | undefined;
    let bootDone = false;

    const finishBoot = () => {
      if (bootDone || cancel) return;
      bootDone = true;
      setReady(true);
    };

    (async () => {
      const sb = getSupabase();
      if (!sb) {
        if (!cancel) {
          setSession(ler());
          setReady(true);
        }
        return;
      }

      const cached = ler();
      if (cached) setSession(cached);

      // Fonte de verdade no boot = onAuthStateChange (INITIAL_SESSION).
      // NAO chamar getSession antes do listener: no PWA costuma vir null e
      // apagar wedash-session / mandar pro login.
      const { data } = sb.auth.onAuthStateChange(async (event, authSession) => {
        if (cancel) return;

        if (event === "PASSWORD_RECOVERY") {
          markRecovery();
          setSession(null);
          save(null);
          finishBoot();
          navigate(paths.access.reset, { replace: true });
          return;
        }

        if (event === "SIGNED_OUT") {
          clearRecovery();
          setSession(null);
          save(null);
          finishBoot();
          return;
        }

        if (event === "TOKEN_REFRESHED") {
          // So JWT  -  nao reidrata (preserva onboarding local).
          return;
        }

        if (
          event === "INITIAL_SESSION" ||
          event === "SIGNED_IN" ||
          event === "USER_UPDATED"
        ) {
          if (emRecovery()) {
            setSession(null);
            save(null);
            finishBoot();
            return;
          }

          if (!authSession?.user) {
            // INITIAL_SESSION null: race comum no PWA / tab resume.
            // Se ainda ha token ou cache, NAO desloga.
            if (event === "INITIAL_SESSION") {
              if (hasStoredAuthToken() || cached) {
                const retry = await sb.auth.getSession();
                if (cancel) return;
                if (retry.data.session?.user) {
                  const s = await sessionFromPersistedAuth();
                  if (cancel) return;
                  if (s) {
                    const merged = mergeWithCache(s, cached);
                    setSession((current) => keepIfSame(current, merged));
                    save(merged);
                  } else {
                    setSession(cached);
                  }
                } else if (cached && hasStoredAuthToken()) {
                  setSession(cached);
                } else if (!hasStoredAuthToken()) {
                  setSession(null);
                  save(null);
                } else {
                  setSession(cached);
                }
              } else {
                setSession(null);
              }
              finishBoot();
            }
            return;
          }

          const s = await sessionFromPersistedAuth();
          if (cancel) return;
          if (s) {
            setSession((current) => {
              const merged = keepIfSame(current, mergeWithCache(s, current ?? cached));
              if (merged !== current) save(merged);
              return merged;
            });
          } else {
            // JWT ok, hydrate falhou (rede)  -  manter cache.
            setSession((current) => current ?? cached ?? ler());
          }
          finishBoot();
        }
      });
      unsub = () => data.subscription.unsubscribe();

      // Safety: se INITIAL_SESSION nunca vier, nao trava a UI.
      window.setTimeout(() => {
        if (!cancel) finishBoot();
      }, 2500);
    })();

    return () => {
      cancel = true;
      unsub?.();
    };
  }, [navigate]);

  const signIn = useCallback((u: User) => {
    const s = sessionFromUser(u);
    setSession(s);
    save(s);
    return s;
  }, []);

  const applySession = useCallback((s: Session) => {
    setSession(s);
    save(s);
  }, []);

  const signOut = useCallback(() => {
    // Nao desconecta Millennium  -  so Configuracoes > Integracao ERP.
    clearSavedPeriod();
    clearAllPendingForce();
    setSession(null);
    save(null);
    void logoutAuth();
  }, []);

  const update = useCallback((patch: Partial<Session>) => {
    setSession((current) => {
      if (!current) return current;
      const isNew = { ...current, ...patch };
      save(isNew);
      return isNew;
    });
  }, []);

  const amount = useMemo(
    () => ({ session, ready, signIn, applySession, signOut, update }),
    [session, ready, signIn, applySession, signOut, update],
  );
  return <Contexto.Provider value={amount}>{children}</Contexto.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error("useSession precisa estar dentro de SessionProvider");
  return ctx;
}

export function useActiveSession(): Session {
  const { session } = useSession();
  if (!session) throw new Error("Sem sessão ativa");
  return session;
}
