import { Button } from "@/components/ui";
import {
  blankOnlinePixRow,
  onlinePixPreviewCents,
  type OnlinePixDraftRow,
} from "@/data/wedash/onlinePix";
import { brlCent } from "@/lib/format";
import { NumberInput } from "@/pages/operation/shared";

const field =
  "h-9 w-full min-w-0 rounded-[9px] border border-line bg-bg-inset px-2 text-[13px] text-t0 outline-none focus:border-acc";

const money = (cents: number | null) => (cents == null ? "—" : brlCent(cents / 100));

export function OnlinePix({
  owner,
  rows,
  acquirerText,
  acquirerCents,
  pixPending,
  onRows,
  onAcquirer,
  toCents,
}: {
  owner: boolean;
  rows: OnlinePixDraftRow[];
  acquirerText: string;
  acquirerCents: number | null;
  pixPending: boolean;
  onRows: (rows: OnlinePixDraftRow[]) => void;
  onAcquirer: (value: string) => void;
  toCents: (raw: string) => number | null;
}) {
  const online = onlinePixPreviewCents(rows, toCents);
  if (!owner && rows.length === 0) return null;
  if (owner && rows.length === 0) {
    return (
      <div className="mt-4">
        <Button type="button" variant="outline" size="sm" onClick={() => onRows([blankOnlinePixRow()])}>
          Adicionar PIX online
        </Button>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-t2">Transferência que só aparece no extrato. Soma com o valor da adquirente.</p>
      </div>
    );
  }

  return (
    <section className="mt-4 rounded-[var(--radius-vela-lg)] border border-line bg-bg-2 p-3">
      <p className="text-[12.5px] font-bold text-t0">PIX online</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-t2">Transferência que só aparece no extrato. Soma com o valor da adquirente.</p>
      <div className="mt-3 flex flex-col gap-2">
        {owner && !(pixPending && acquirerCents == null) ? (
          <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <span className="text-[12.5px] text-t2 sm:w-28">Adquirente</span>
            <NumberInput
              className="sm:w-36"
              compact
              unit="R$"
              value={acquirerText}
              onChange={onAcquirer}
              aria-label="Valor da adquirente no Pix"
            />
          </label>
        ) : (
          <p className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="text-t2">Adquirente</span>
            <span className="font-mono font-bold text-t0">{money(acquirerCents)}</span>
          </p>
        )}
        {owner
          ? rows.map((row) => (
              <div key={row.id} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="min-w-0 flex-1 text-[12.5px] font-bold text-t0">
                  Descrição<span className="font-normal text-t2"> (opcional)</span>
                  <input
                    value={row.note}
                    onChange={(event) => onRows(rows.map((item) => (item.id === row.id ? { ...item, note: event.target.value } : item)))}
                    placeholder="Descrição"
                    aria-label="Descrição do PIX online"
                    maxLength={80}
                    className={`${field} mt-1`}
                  />
                </label>
                <label className="text-[12.5px] font-bold text-t0 sm:w-36">
                  Valor<span className="text-bad"> *</span>
                  <NumberInput
                    className="mt-1"
                    compact
                    unit="R$"
                    value={row.amount}
                    onChange={(amount) => onRows(rows.map((item) => (item.id === row.id ? { ...item, amount } : item)))}
                    aria-label="Valor do PIX online"
                  />
                </label>
                <Button type="button" variant="ghost" size="sm" onClick={() => onRows(rows.filter((item) => item.id !== row.id))}>
                  Remover
                </Button>
              </div>
            ))
          : (
            <ul className="flex flex-col gap-1">
              {rows.map((row) => {
                const cents = toCents(row.amount);
                if (cents == null || cents <= 0) return null;
                return (
                  <li key={row.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="text-t0">{row.note.trim() || "PIX online"}</span>
                    <span className="font-mono font-bold text-t0">{brlCent(cents / 100)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        {owner && (
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => onRows([...rows, blankOnlinePixRow()])}>
            Adicionar PIX online
          </Button>
        )}
        <p className="text-[12.5px] text-t2">
          {acquirerCents == null
            ? pixPending
              ? `PIX online ${money(online)}. Soma com a adquirente quando o arquivo chegar.`
              : `PIX online ${money(online)}. Informe a adquirente, ou 0,00 se o Pix deste dia veio só do extrato.`
            : `Adquirente ${money(acquirerCents)} · PIX online ${money(online)} · Total real ${money(acquirerCents + online)}`}
        </p>
      </div>
    </section>
  );
}
