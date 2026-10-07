import { Button, Modal } from "@/components/ui";

export type DuplicateChoice = "period" | "store";

/** Modal ao clicar em Duplicar meta/desafio: periodo seguinte ou outra loja. */
export function DuplicateChoiceModal({
  open,
  onClose,
  kind,
  name,
  hasOtherStores,
  onChoose,
}: {
  open: boolean;
  onClose: () => void;
  kind: "meta" | "desafio";
  name: string | null;
  hasOtherStores: boolean;
  onChoose: (choice: DuplicateChoice) => void;
}) {
  const artigo = kind === "meta" ? "a" : "o";
  const label = kind === "meta" ? "meta" : "desafio";
  return (
    <Modal open={open} onClose={onClose} title={`Duplicar ${label}?`} size="sm">
      <p className="mb-4 text-[13px] leading-relaxed text-t1">
        {name ? (
          <>
            Como deseja copiar {artigo} <span className="font-bold text-t0">{name}</span>?
          </>
        ) : (
          <>Como deseja copiar {artigo} {label}?</>
        )}
      </p>
      <div className="flex flex-col gap-2.5">
        <button
          type="button"
          onClick={() => onChoose("period")}
          className="rounded-[var(--radius-vela-lg)] border border-line px-4 py-3 text-left transition-colors hover:border-acc hover:bg-acc-soft/40"
        >
          <p className="text-[13.5px] font-bold text-t0">Próximo período</p>
          <p className="mt-0.5 text-[12.5px] leading-snug text-t2">Cria uma cópia no período seguinte nesta loja.</p>
        </button>
        {hasOtherStores && (
          <button
            type="button"
            onClick={() => onChoose("store")}
            className="rounded-[var(--radius-vela-lg)] border border-line px-4 py-3 text-left transition-colors hover:border-acc hover:bg-acc-soft/40"
          >
            <p className="text-[13.5px] font-bold text-t0">Outra loja</p>
            <p className="mt-0.5 text-[12.5px] leading-snug text-t2">
              Copia a mesma configuração e as mesmas datas para outra filial.
            </p>
          </button>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancelar
        </Button>
      </div>
    </Modal>
  );
}
