import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import {
  blankWithdrawalRow,
  type WithdrawalDraft,
  type WithdrawalPerson,
} from "@/data/wedash/employeeWithdrawal";
import { cn } from "@/lib/cn";
import { brlCent } from "@/lib/format";
import { NumberInput } from "@/pages/operation/shared";

const field =
  "h-9 w-full min-w-0 rounded-[9px] border border-line bg-bg-inset px-2 text-[13px] text-t0 outline-none focus:border-acc";

const money = (cents: number) => brlCent(cents / 100);

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("pt-BR");

function PersonSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: WithdrawalPerson[];
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const selected = options.find((person) => person.id === value);
  const q = fold(query.trim());
  const list = options.filter((person) => !q || fold(person.name).includes(q));

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={boxRef} className="relative mt-1 min-w-0 w-full">
      <button
        type="button"
        aria-label="Funcionário da retirada"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => (open ? close() : setOpen(true))}
        className={cn(field, "flex cursor-pointer items-center justify-between gap-2 text-left", open && "border-acc")}
      >
        <span className={cn("truncate", selected ? "text-t0" : "text-t2")}>{selected?.name ?? "Escolher"}</span>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn("shrink-0 text-t2", open && "rotate-180")}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="mt-1 overflow-hidden rounded-[11px] border border-acc bg-bg-inset">
          <div className="flex h-9 items-center gap-2 border-b border-line px-2.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--t2)" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  close();
                }
              }}
              placeholder="Buscar funcionário"
              aria-label="Buscar funcionário"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-t0 outline-none placeholder:text-t2"
            />
          </div>
          <div role="listbox" aria-label="Funcionários" className="max-h-[132px] overflow-y-auto">
            {list.length === 0 ? (
              <p className="px-3.5 py-2.5 text-[13px] text-t2">Nenhum funcionário com esse nome.</p>
            ) : (
              list.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  role="option"
                  aria-selected={person.id === value}
                  onClick={() => {
                    onChange(person.id);
                    close();
                  }}
                  className={cn(
                    "block w-full cursor-pointer px-3.5 py-2.5 text-left text-[13px] hover:bg-bg-3",
                    person.id === value ? "bg-acc-soft font-bold text-acc" : "text-t1",
                  )}
                >
                  {person.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function EmployeeWithdrawal({
  owner,
  typedCents,
  people,
  names,
  canonicalId,
  draft,
  onChange,
  toCents,
}: {
  owner: boolean;
  typedCents: number;
  people: WithdrawalPerson[];
  names: Map<string, string>;
  canonicalId: (id: string) => string;
  draft: WithdrawalDraft;
  onChange: (next: WithdrawalDraft) => void;
  toCents: (raw: string) => number | null;
}) {
  const named = names;
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

  const taken = new Set(draft.rows.map((row) => canonicalId(row.sellerId)).filter((id) => id !== ""));
  const room = people.some((person) => !taken.has(person.id));

  return (
    <section className="mt-4 rounded-[var(--radius-vela-lg)] border border-line bg-bg-2 p-3">
      <p className="text-[12.5px] font-bold text-t0">Retirada de funcionário</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-t2">Venda para colaborador lançada em dinheiro. Soma no total real do dinheiro.</p>
      <div className="mt-3 flex flex-col gap-2">
        {owner ? (
          people.length === 0 ? (
            <p className="text-[13px] text-t2">Nenhum funcionário ativo.</p>
          ) : (
            draft.rows.map((row) => {
              const selectedId = canonicalId(row.sellerId);
              const options = people.filter((person) => person.id === selectedId || !taken.has(person.id));
              return (
                <div key={row.id} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <label className="min-w-0 flex-1 text-[12.5px] font-bold text-t0">
                    Funcionário<span className="text-bad"> *</span>
                    <PersonSelect
                      value={selectedId}
                      options={options}
                      onChange={(sellerId) =>
                        onChange({
                          ...draft,
                          rows: draft.rows.map((item) => (item.id === row.id ? { ...item, sellerId } : item)),
                        })
                      }
                    />
                  </label>
                  <label className="text-[12.5px] font-bold text-t0 sm:w-36">
                    Valor<span className="text-bad"> *</span>
                    <NumberInput
                      className="mt-1"
                      compact
                      unit="R$"
                      value={row.amount}
                      onChange={(amount) =>
                        onChange({
                          ...draft,
                          rows: draft.rows.map((item) => (item.id === row.id ? { ...item, amount } : item)),
                        })
                      }
                      aria-label="Valor da retirada"
                    />
                  </label>
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
