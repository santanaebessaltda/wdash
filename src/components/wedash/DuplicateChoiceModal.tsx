import { Button, Modal } from "@/components/ui";
import { PickerRow } from "@/components/wedash/ConnectionList";

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
  const article = kind === "meta" ? "a" : "o";
  const label = kind === "meta" ? "meta" : "desafio";
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Duplicar ${label}?`}
      footer={
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
      }
    >
      <p className="mb-3 text-[13.5px] leading-relaxed text-t1">
        {name ? (
          <>
            Como deseja copiar {article} <span className="font-bold text-t0">{name}</span>?
          </>
        ) : (
          <>Como deseja copiar {article} {label}?</>
        )}
      </p>
      <div className="flex flex-col gap-2.5">
        <PickerRow name="Próximo período" detail="Cria uma cópia no período seguinte nesta loja." onClick={() => onChoose("period")} />
        {hasOtherStores ? (
          <PickerRow
            name="Outra loja"
            detail="Copia a mesma configuração e as mesmas datas para outra filial."
            onClick={() => onChoose("store")}
          />
        ) : null}
      </div>
    </Modal>
  );
}
