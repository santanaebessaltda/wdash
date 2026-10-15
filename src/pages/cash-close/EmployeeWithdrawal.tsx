import { Button } from "@/components/ui";
import {
  blankWithdrawalRow,
  type WithdrawalDraft,
  type WithdrawalPerson,
} from "@/data/wedash/employeeWithdrawal";
import { brlCent } from "@/lib/format";

const field =
  "h-9 w-full min-w-0 rounded-[9px] border border-line bg-bg-inset px-2 text-[13px] text-t0 outline-none focus:border-acc";

const money = (cents: number) => brlCent(cents / 100);

export function EmployeeWithdrawal({
  owner,
  typedCents,
  people,
  draft,
  onChange,
  toCents,
}: {
  owner: boolean;
  typedCents: number;
  people: WithdrawalPerson[];
  draft: WithdrawalDraft;
  onChange: (next: WithdrawalDraft) => void;
  toCents: (raw: string) => number | null;
}) {
  const named = new Map(people.map((person) => [person.id, person.name]));
  const retirada = draft.rows.reduce((sum, row) => {
    const cents = toCents(row.amount);
    return cents != null && cents > 0 ? sum + cents : sum;
  }, 0);
  if (!owner && (!draft.enabled || draft.rows.length === 0)) return null;
  if (owner && !draft.enabled) {
    return (
      <div className="mt-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange({ enabled: true, rows: draft.rows.length > 0 ? draft.rows : [blankWithdrawalRow()] })}
        >
          Adicionar retirada de funcionário
        </Button>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-t2">Venda para colaborador lançada em dinheiro. Soma no total real do dinheiro.</p>
      </div>
    );
  }

  const taken = new Set(draft.rows.map((row) => row.sellerId).filter((id) => id !== ""));
  const room = people.some((person) => !taken.has(person.id));

  return (
    <section className="mt-4 rounded-[var(--radius-vela-lg)] border border-line bg-bg-2 p-3">
      <p className="text-[12.5px] font-bold text-t0">Retirada de funcionário</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-t2">Venda para colaborador lançada em dinheiro. Soma no total real do dinheiro.</p>
      <div className="mt-3 flex flex-col gap-2">
        {owner ? (
          people.length === 0 ? (
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
                    className={field}
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
                    className={`${field} text-right font-mono font-bold sm:w-32`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const rows = draft.rows.filter((item) => item.id !== row.id);
                      onChange({ enabled: rows.length > 0, rows });
                    }}
                  >
                    Remover
                  </Button>
                </div>
              );
            })
          )
        ) : (
          <ul className="flex flex-col gap-1">
            {draft.rows.map((row) => {
              const cents = toCents(row.amount);
              if (!row.sellerId || cents == null || cents <= 0) return null;
              return (
                <li key={row.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="text-t0">{named.get(row.sellerId) ?? "Funcionário fora do cadastro"}</span>
                  <span className="font-mono font-bold text-t0">{money(cents)}</span>
                </li>
              );
            })}
          </ul>
        )}
        {owner && people.length > 0 && (
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
        <p className="text-[12.5px] text-t2">
          Digitado {money(typedCents)} · Retirada {money(retirada)} · Total real {money(typedCents + retirada)}
        </p>
      </div>
    </section>
  );
}
