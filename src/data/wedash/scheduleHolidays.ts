/** Feriados do card. Nacionais e Carnaval são calculados. Estadual e municipal de 2026 vêm do seed MIT. */

export type HolidayKind = "national" | "state" | "municipal";

export type Holiday = {
  date: string;
  name: string;
  kind: HolidayKind;
};

type Seed = {
  state: { d: string; n: string; u: string }[];
  municipal: { d: string; n: string; i: number }[];
  cities: { i: number; u: string; n: string }[];
};

let seedPromise: Promise<Seed | null> | null = null;

export function loadHolidaySeed(): Promise<Seed | null> {
  if (!seedPromise) {
    seedPromise = fetch("/holiday-seed-2026.json")
      .then((response) => (response.ok ? (response.json() as Promise<Seed>) : null))
      .catch(() => null);
  }
  return seedPromise;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dateIso(date: Date): string {
  return iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** Páscoa gregoriana. */
export function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

export function nationalHolidays(year: number): Holiday[] {
  const pascoa = easter(year);
  const rows: Holiday[] = [
    { date: iso(year, 1, 1), name: "Ano Novo", kind: "national" },
    { date: dateIso(addDays(pascoa, -48)), name: "Carnaval", kind: "national" },
    { date: dateIso(addDays(pascoa, -47)), name: "Carnaval", kind: "national" },
    { date: dateIso(addDays(pascoa, -2)), name: "Sexta-feira Santa", kind: "national" },
    { date: iso(year, 4, 21), name: "Tiradentes", kind: "national" },
    { date: iso(year, 5, 1), name: "Dia do Trabalho", kind: "national" },
    { date: iso(year, 9, 7), name: "Independência do Brasil", kind: "national" },
    { date: iso(year, 10, 12), name: "Nossa Senhora Aparecida", kind: "national" },
    { date: iso(year, 11, 2), name: "Finados", kind: "national" },
    { date: iso(year, 11, 15), name: "Proclamação da República", kind: "national" },
    { date: iso(year, 11, 20), name: "Consciência Negra", kind: "national" },
    { date: iso(year, 12, 25), name: "Natal", kind: "national" },
  ];
  return rows;
}

export function foldPlace(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/** Cidade e UF da filial. O cadastro ao vivo ainda não grava cidade; o nome da loja cobre Campo Grande e Três Lagoas. */
export function storePlace(store: { city: string; uf: string; name: string; tradeName: string }): { city: string; uf: string } {
  if (store.city.trim() && store.uf.trim()) return { city: store.city.trim(), uf: store.uf.trim() };
  const folded = ` ${foldPlace(`${store.name} ${store.tradeName}`)} `;
  if (folded.includes(" tres lagoas ")) return { city: "Três Lagoas", uf: "MS" };
  if (folded.includes(" campo grande ") || folded.includes(" cg ")) return { city: "Campo Grande", uf: "MS" };
  return { city: store.city.trim(), uf: store.uf.trim() };
}

export function holidaysForStore(
  seed: Seed | null,
  year: number,
  uf: string,
  city: string,
  extra: { date: string; name: string }[],
): Holiday[] {
  const rows = nationalHolidays(year);
  if (seed && year === 2026) {
    const state = seed.state.filter((row) => row.u.toUpperCase() === uf.toUpperCase()).map((row) => ({ date: row.d, name: row.n, kind: "state" as const }));
    const key = `${uf.toUpperCase()}|${foldPlace(city)}`;
    const match = seed.cities.find((row) => `${row.u.toUpperCase()}|${foldPlace(row.n)}` === key);
    const municipal = match
      ? seed.municipal.filter((row) => row.i === match.i).map((row) => ({ date: row.d, name: row.n, kind: "municipal" as const }))
      : [];
    rows.push(...state, ...municipal);
  }
  for (const row of extra) rows.push({ date: row.date, name: row.name, kind: "municipal" });
  return rows;
}

export function holidayLabel(rows: Holiday[], date: string): string | null {
  const names = rows.filter((row) => row.date === date).map((row) => row.name);
  const unique = [...new Set(names)];
  return unique.length > 0 ? unique.join(" · ") : null;
}
