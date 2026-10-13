import { Button, Checkbox } from "@/components/ui";
import {
  blankWithdrawalRow,
  withdrawalPreview,
  type WithdrawalDraft,
  type WithdrawalPerson,
} from "@/data/wedash/employeeWithdrawal";
import { brlCent } from "@/lib/format";

const campo =
  "h-9 w-full min-w-0 rounded-[9px] border border-line bg-bg-inset px-2 text-[13px] text-t0 outline-none focus:border-acc";

export function EmployeeWithdrawal({
  gestor,
  shortageCents,
  people,
  draft,
  onChange,
  toCents,
}: {
  gestor: boolean;
  shortageCents: number;
  people: WithdrawalPerson[];
  draft: WithdrawalDraft;
  onChange: (next: WithdrawalDraft) => void;
  toCents: (raw: string) => number | null;
}) {
  if (shortageCents <= 0 && !draft.enabled) return null;
  const named = new Map(people.map((person) => [person.id, person.name]));
  if (!gestor) {
    if (!draft.enabled || draft.rows.length === 0) return null;
    return (
      <section className="mt-4 rounded-[var(--radius-vela-lg)] border border-line bg-bg-2 p-3">
        <p className="text-[12.5px] font-bold text-t0">Justificativa da falta</p>
        <p className="mt-2 text-[13px] text-t1">Retirada de funcionários</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-t2">Descontada no holerite do mês seguinte.</p>
        <WithdrawalList rows={draft.rows} named={named} toCents={toCents} />
        <Split shortageCents={shortageCents} rows={draft.rows} toCents={toCents} />
      </section>
    );
  }

  const taken = new Set(draft.rows.map((row) => row.sellerId).filter((id) => id !== ""));
  const room = people.some((person) => !taken.has(person.id));

  return (
    <section className="mt-4 rounded-[var(--radius-vela-lg)] border border-line bg-bg-2 p-3">
      <p className="mb-2 text-[12.5px] font-bold text-t0">Justificativa da falta</p>
      <Checkbox
        checked={draft.enabled}
        onChange={(event) => {
          const enabled = event.target.checked;
          onChange({
            enabled,
            rows: enabled && draft.rows.length === 0 ? [blankWithdrawalRow()] : draft.rows,
          });
        }}
        label="Retirada de funcionários"
      />
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-t2">
        Descontada no holerite do mês seguinte. O que passar da quebra fica como sobra.
      </p>
      {draft.enabled && (
        <div className="mt-3 flex flex-col gap-2">
          {people.length === 0 ? (
            <p className="text-[13px] text-t2">Nenhum funcionário ativo nesta loja.</p>
          ) : (
            draft.rows.map((row) => {
              const options = people.filter((person) => person.id === row.sellerId || !taken.has(person.id));
              return (
                <div key={row.id} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <select
                    value={row.sellerId}
                    aria-label="Funcionário da retirada"
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        rows: draft.rows.map((item) => (item.id === row.id ? { ...item, sellerId: event.target.value } : item)),
                      })
                    }
                    className={campo}
                  >
                    <option value="">Escolher</option>
                    {options.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                  <input
                    value={row.amount}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        rows: draft.rows.map((item) => (item.id === row.id ? { ...item, amount: event.target.value } : item)),
                      })
                    }
                    inputMode="decimal"
                    placeholder="0,00"
                    aria-label="Valor da retirada"
                    className={`${campo} text-right font-mono font-bold sm:w-32`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onChange({ ...draft, rows: draft.rows.filter((item) => item.id !== row.id) })}
                  >
                    Remover
                  </Button>
                </div>
              );
            })
          )}
          {people.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={!room}
              onClick={() => onChange({ ...draft, rows: [...draft.rows, blankWithdrawalRow()] })}
            >
              Adicionar funcionário
            </Button>
          )}
          <Split shortageCents={shortageCents} rows={draft.rows} toCents={toCents} />
        </div>
      )}
    </section>
  );
}

function WithdrawalList({
  rows,
  named,
  toCents,
}: {
  rows: WithdrawalDraft["rows"];
  named: Map<string, string>;
  toCents: (raw: string) => number | null;
}) {
  const visible = rows.flatMap((row) => {
    const cents = toCents(row.amount);
    if (!row.sellerId || cents == null || cents <= 0) return [];
    return [{ id: row.id, name: named.get(row.sellerId) ?? "Funcionário fora do cadastro", cents }];
  });
  if (visible.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {visible.map((row) => (
        <li key={row.id} className="flex items-baseline justify-between gap-3 text-[13px]">
          <span className="text-t0">{row.name}</span>
          <span className="font-mono font-bold text-t0">{brlCent(row.cents / 100)}</span>
        </li>
      ))}
    </ul>
  );
}

function Split({
  shortageCents,
  rows,
  toCents,
}: {
  shortageCents: number;
  rows: WithdrawalDraft["rows"];
  toCents: (raw: string) => number | null;
}) {
  const cents = rows.flatMap((row) => {
    const parsed = toCents(row.amount);
    return parsed != null && parsed > 0 ? [parsed] : [];
  });
  const preview = withdrawalPreview(shortageCents, cents);
  return (
    <p className="mt-2 text-[12.5px] text-t2">
      {preview.surplusCents > 0
        ? `Retirada ${brlCent(preview.withdrawalCents / 100)} · Sobra ${brlCent(preview.surplusCents / 100)}`
        : `Retirada ${brlCent(preview.withdrawalCents / 100)} · Quebra de caixa ${brlCent(preview.breakCents / 100)}`}
    </p>
  );
}
