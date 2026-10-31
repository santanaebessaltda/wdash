import { startOfMonth } from "@/data/wedash/engine/format";
import {
  type HolidayRule,
  type SchedulePattern,
  type Sex,
} from "@/data/wedash/scheduleGenerate";
import {
  holidaysForStore,
  loadHolidaySeed,
  loadNationalHolidays,
  storePlace,
  type Holiday,
} from "@/data/wedash/scheduleHolidays";
import { fetchStoreSellers, isBranchTeamMember, storesForSession, type Store } from "@/data/wedash/stores";
import {
  matchStoresInText,
  needsStorePickForWrite,
  speakAskWriteStore,
  type JarvisContext,
} from "./context";

export type SchedulePersonRef = { id: string; name: string; sex: Sex };

export type ScheduleDraftForm = {
  storeId: string;
  monthStart: string | null;
  pattern: SchedulePattern;
  replaceManual: boolean;
  people: SchedulePersonRef[];
  sundayMin: number;
  holidayRules: HolidayRule[];
};

export type ScheduleDraft = {
  form: ScheduleDraftForm;
  storeName: string;
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function shiftMonthStart(isoDay: string, delta: number): string {
  const y = Number(isoDay.slice(0, 4));
  const m = Number(isoDay.slice(5, 7));
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`;
}

const MONTH_NAMES: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

export function parseScheduleMonth(text: string, today: string): string | null {
  const p = norm(text);
  if (/proximo mes|mes que vem/.test(p)) return shiftMonthStart(today, 1);
  if (/este mes|esse mes|mes atual/.test(p)) return startOfMonth(today);
  if (/mes passado/.test(p)) return shiftMonthStart(today, -1);
  for (const [name, month] of Object.entries(MONTH_NAMES)) {
    if (!p.includes(name)) continue;
    const yearMatch = p.match(new RegExp(`${name}\\s+(?:de\\s+)?(20\\d{2})`));
    const y = yearMatch ? Number(yearMatch[1]) : Number(today.slice(0, 4));
    return `${y}-${pad(month)}-01`;
  }
  return null;
}

export function parseSchedulePattern(text: string): SchedulePattern | null {
  const p = norm(text);
  if (/12\s*[x×]\s*36|12x36/.test(p)) return "12x36";
  if (/4\s*[x×]\s*3|4x3/.test(p)) return "4x3";
  if (/5\s*[x×]\s*2|5x2|cinco por dois/.test(p)) return "5x2";
  if (/6\s*[x×]\s*1|6x1|seis por um/.test(p)) return "6x1";
  return null;
}

export type ScheduleFormErrors = {
  storeId?: string;
  monthStart?: string;
  people?: string;
};

export function validateScheduleDraft(f: ScheduleDraftForm): ScheduleFormErrors {
  const e: ScheduleFormErrors = {};
  if (!f.storeId) e.storeId = "filial";
  if (!f.monthStart) e.monthStart = "mês";
  if (f.people.length === 0) e.people = "equipe (ninguém ativo na filial)";
  return e;
}

export function missingScheduleLabels(errors: ScheduleFormErrors): string[] {
  return Object.values(errors);
}

export function scheduleDraftReady(f: ScheduleDraftForm): boolean {
  return Object.keys(validateScheduleDraft(f)).length === 0;
}

function patternLabel(p: SchedulePattern): string {
  if (p === "6x1") return "6×1";
  if (p === "5x2") return "5×2";
  if (p === "4x3") return "4×3";
  return "12×36";
}

function monthLabel(iso: string | null): string {
  if (!iso) return "a definir";
  const names = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${names[Number(iso.slice(5, 7)) - 1]}/${iso.slice(2, 4)}`;
}

export function formatScheduleProposal(form: ScheduleDraftForm, storeName: string): string {
  const ready = scheduleDraftReady(form);
  const base =
    `Rascunho de escala: ${storeName || "filial?"} · ${monthLabel(form.monthStart)} · modelo ${patternLabel(form.pattern)} · ` +
    `${form.people.length} pessoa${form.people.length === 1 ? "" : "s"} · ` +
    (form.replaceManual ? "substitui também os dias manuais" : "mantém dias ajustados na mão") +
    ".";
  if (ready) {
    return `${base} Fechado para mim — diga Autorizo ou toque em Autorizar para eu gerar e gravar.`;
  }
  const missing = missingScheduleLabels(validateScheduleDraft(form));
  return `${base} Ainda falta: ${missing.join(", ")}.`;
}

function holidayRulesForMonth(holidays: Holiday[], monthStart: string): HolidayRule[] {
  const prefix = monthStart.slice(0, 7);
  return holidays
    .filter((h) => h.date.startsWith(prefix) && h.kind !== "municipal")
    .map((h) => ({
      date: h.date,
      name: h.name,
      open: true,
      workers: 1,
      pay: "extra_off" as const,
      window: "7_days" as const,
    }));
}

async function loadStoreHolidays(store: Store, monthStart: string): Promise<Holiday[]> {
  const year = Number(monthStart.slice(0, 4));
  const [seed, national] = await Promise.all([loadHolidaySeed(), loadNationalHolidays(year)]);
  const place = storePlace(store);
  const local = holidaysForStore(seed, year, place.uf, place.city, []).filter((row) => row.kind !== "national");
  return [...national, ...local];
}

async function loadPeople(tenantId: string, storeId: string): Promise<SchedulePersonRef[]> {
  const map = await fetchStoreSellers(tenantId, [storeId]);
  const directory = map.get(storeId) ?? [];
  return directory
    .filter((person) => isBranchTeamMember(person))
    .map((person) => ({ id: person.id, name: person.name, sex: "woman" as Sex }));
}

export function emptyScheduleForm(storeId: string): ScheduleDraftForm {
  return {
    storeId,
    monthStart: null,
    pattern: "6x1",
    replaceManual: false,
    people: [],
    sundayMin: 1,
    holidayRules: [],
  };
}

export async function discussSchedule(
  question: string,
  ctx: JarvisContext,
  prev: ScheduleDraft | null,
): Promise<{ reply: string; draft: ScheduleDraft; spokenReply?: string | null }> {
  const p = norm(question);
  const pool = ctx.network.length > 0 ? ctx.network : ctx.stores;
  const matched = matchStoresInText(question, pool);
  let storeId = matched[0]?.id ?? prev?.form.storeId ?? (ctx.stores.length === 1 ? ctx.stores[0]!.id : "");
  // Com Todas as lojas / várias no filtro: não inventa a primeira — o Gestor escolhe.

  if (!storeId && needsStorePickForWrite(ctx)) {
    const form = prev?.form
      ? {
          ...prev.form,
          people: [...prev.form.people],
          holidayRules: [...prev.form.holidayRules],
        }
      : emptyScheduleForm("");
    const ask = speakAskWriteStore(ctx, "escala");
    return {
      reply: `${ask}\n\n(Não invente filial. Espere o Gestor escolher.)`,
      draft: { form, storeName: "" },
      spokenReply: ask,
    };
  }

  const network = storesForSession(
    // session stores = ids; product catalog may have more detail
    ctx.stores.map((s) => s.id),
  );
  const store = network.find((s) => s.id === storeId) ?? null;
  const storeName = ctx.stores.find((s) => s.id === storeId)?.tradeName ?? store?.tradeName ?? "";

  let form: ScheduleDraftForm = prev?.form
    ? {
        ...prev.form,
        people: [...prev.form.people],
        holidayRules: [...prev.form.holidayRules],
      }
    : emptyScheduleForm(storeId);

  if (storeId) form.storeId = storeId;

  const month = parseScheduleMonth(question, ctx.today);
  if (month) form.monthStart = month;
  else if (!form.monthStart) form.monthStart = shiftMonthStart(ctx.today, 1);

  const pattern = parseSchedulePattern(question);
  if (pattern) form.pattern = pattern;

  if (/substitu(i|ir) tudo|apagar manual|nao manter|não manter/.test(p)) form.replaceManual = true;
  if (/manter (o )?manual|manter (os )?dias|preservar/.test(p)) form.replaceManual = false;

  if (form.storeId && (form.people.length === 0 || matched.length > 0 || !prev)) {
    form.people = await loadPeople(ctx.tenantId, form.storeId).catch(() => []);
  }

  if (form.storeId && form.monthStart && store) {
    const holidays = await loadStoreHolidays(store, form.monthStart).catch(() => [] as Holiday[]);
    form.holidayRules = holidayRulesForMonth(holidays, form.monthStart);
  }

  return {
    reply: formatScheduleProposal(form, storeName),
    draft: { form, storeName },
    spokenReply: null,
  };
}
