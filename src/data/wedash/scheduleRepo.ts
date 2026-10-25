import type { DayStatus, OffMode, SchedulePattern } from "./scheduleGenerate";
import { endOfMonth, startOfMonth } from "./engine/format";

export type ExtraHoliday = { day: number; name: string };

export type StoredSchedule = {
  id: string;
  pattern: SchedulePattern;
  offMode: OffMode;
  sundayMin: number;
  extraHolidays: ExtraHoliday[];
  people: { sellerId: string; fixedOffDow: number | null }[];
};

export type StoredDay = {
  sellerId: string;
  day: string;
  status: DayStatus;
  origin: "generated" | "manual";
};

type ScheduleRecord = {
  id: string;
  pattern: SchedulePattern;
  off_mode: OffMode;
  sunday_min: number;
  extra_holidays: ExtraHoliday[] | null;
  store_schedule_person: { seller_id: string; fixed_off_dow: number | null }[] | null;
};

function asSchedule(row: ScheduleRecord): StoredSchedule {
  return {
    id: row.id,
    pattern: row.pattern,
    offMode: row.off_mode,
    sundayMin: row.sunday_min,
    extraHolidays: Array.isArray(row.extra_holidays) ? row.extra_holidays : [],
    people: (row.store_schedule_person ?? []).map((person) => ({
      sellerId: person.seller_id,
      fixedOffDow: person.fixed_off_dow,
    })),
  };
}

async function client() {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase não configurado");
  return sb;
}

export async function fetchSchedule(storeId: string, monthStart: string): Promise<{ schedule: StoredSchedule | null; days: StoredDay[] }> {
  const sb = await client();
  const monthEnd = endOfMonth(monthStart);
  const [scheduleResult, dayResult] = await Promise.all([
    sb
      .from("store_schedule")
      .select("id, pattern, off_mode, sunday_min, extra_holidays, store_schedule_person(seller_id, fixed_off_dow)")
      .eq("store_id", storeId)
      .eq("month_start", startOfMonth(monthStart))
      .maybeSingle(),
    sb
      .from("store_schedule_day")
      .select("seller_id, day, status, origin")
      .eq("store_id", storeId)
      .gte("day", startOfMonth(monthStart))
      .lte("day", monthEnd),
  ]);
  if (scheduleResult.error) throw new Error(scheduleResult.error.message);
  if (dayResult.error) throw new Error(dayResult.error.message);
  return {
    schedule: scheduleResult.data ? asSchedule(scheduleResult.data as ScheduleRecord) : null,
    days: (dayResult.data ?? []).map((row) => ({
      sellerId: String(row.seller_id),
      day: String(row.day).slice(0, 10),
      status: row.status as DayStatus,
      origin: row.origin as StoredDay["origin"],
    })),
  };
}

export async function saveSchedule(input: {
  tenantId: string;
  storeId: string;
  monthStart: string;
  pattern: SchedulePattern;
  offMode: OffMode;
  sundayMin: number;
  extraHolidays: ExtraHoliday[];
  people: { sellerId: string; fixedOffDow: number | null }[];
  days: { sellerId: string; day: string; status: DayStatus }[];
  keepManual: boolean;
}): Promise<{ keptManualDays: number }> {
  const sb = await client();
  const monthStart = startOfMonth(input.monthStart);
  const monthEnd = endOfMonth(monthStart);
  const existing = input.keepManual
    ? await sb
        .from("store_schedule_day")
        .select("day, seller_id")
        .eq("store_id", input.storeId)
        .gte("day", monthStart)
        .lte("day", monthEnd)
        .eq("origin", "manual")
    : { data: [], error: null };
  if (existing.error) throw new Error(existing.error.message);
  const manual = new Set((existing.data ?? []).map((row) => `${String(row.day).slice(0, 10)}|${row.seller_id}`));

  const upsert = await sb
    .from("store_schedule")
    .upsert(
      {
        tenant_id: input.tenantId,
        store_id: input.storeId,
        month_start: monthStart,
        pattern: input.pattern,
        off_mode: input.offMode,
        sunday_min: input.sundayMin,
        extra_holidays: input.extraHolidays,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "store_id,month_start" },
    )
    .select("id")
    .single();
  if (upsert.error) throw new Error(upsert.error.message);
  const scheduleId = String(upsert.data.id);

  const cleared = await sb.from("store_schedule_person").delete().eq("schedule_id", scheduleId);
  if (cleared.error) throw new Error(cleared.error.message);
  if (input.people.length > 0) {
    const people = await sb.from("store_schedule_person").insert(
      input.people.map((person) => ({
        tenant_id: input.tenantId,
        store_id: input.storeId,
        schedule_id: scheduleId,
        seller_id: person.sellerId,
        fixed_off_dow: person.fixedOffDow,
      })),
    );
    if (people.error) throw new Error(people.error.message);
  }

  const dropGenerated = input.keepManual
    ? sb.from("store_schedule_day").delete().eq("store_id", input.storeId).gte("day", monthStart).lte("day", monthEnd).eq("origin", "generated")
    : sb.from("store_schedule_day").delete().eq("store_id", input.storeId).gte("day", monthStart).lte("day", monthEnd);
  const dropped = await dropGenerated;
  if (dropped.error) throw new Error(dropped.error.message);

  const fresh = input.days
    .filter((day) => !manual.has(`${day.day}|${day.sellerId}`))
    .map((day) => ({
      tenant_id: input.tenantId,
      store_id: input.storeId,
      day: day.day,
      seller_id: day.sellerId,
      status: day.status,
      origin: "generated" as const,
    }));
  for (let index = 0; index < fresh.length; index += 400) {
    const chunk = await sb.from("store_schedule_day").insert(fresh.slice(index, index + 400));
    if (chunk.error) throw new Error(chunk.error.message);
  }
  return { keptManualDays: new Set([...manual].map((key) => key.split("|")[0])).size };
}

export async function saveManualDay(input: {
  tenantId: string;
  storeId: string;
  day: string;
  rows: { sellerId: string; status: DayStatus; origin: "generated" | "manual" }[];
}): Promise<void> {
  const sb = await client();
  const removed = await sb.from("store_schedule_day").delete().eq("store_id", input.storeId).eq("day", input.day);
  if (removed.error) throw new Error(removed.error.message);
  if (input.rows.length === 0) return;
  const inserted = await sb.from("store_schedule_day").insert(
    input.rows.map((row) => ({
      tenant_id: input.tenantId,
      store_id: input.storeId,
      day: input.day,
      seller_id: row.sellerId,
      status: row.status,
      origin: row.origin,
    })),
  );
  if (inserted.error) throw new Error(inserted.error.message);
}

export async function deleteSchedule(storeId: string, monthStart: string): Promise<void> {
  const sb = await client();
  const start = startOfMonth(monthStart);
  const removedDays = await sb.from("store_schedule_day").delete().eq("store_id", storeId).gte("day", start).lte("day", endOfMonth(start));
  if (removedDays.error) throw new Error(removedDays.error.message);
  const removed = await sb.from("store_schedule").delete().eq("store_id", storeId).eq("month_start", start);
  if (removed.error) throw new Error(removed.error.message);
}
