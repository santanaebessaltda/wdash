import { Card } from "@/components/ui";
import { SectionHeader, useScopedStores } from "@/pages/operation/shared";
import { BoardShareLinks } from "./BoardShareLinks";

/** Performance > Placar — copia o link público da(s) filial(is) do seletor. */
export default function BoardLinksPage() {
  const { storeRows } = useScopedStores();

  return (
    <div>
      <SectionHeader
        section="Performance"
        title="Placar"
        subtitle="Copie o link para abrir o placar da loja em uma TV ou em outro aparelho, sem login."
      />
      <div className="mt-6">
        <Card className="p-4 sm:p-5">
          <BoardShareLinks
            stores={storeRows.map((store) => ({ id: store.id, tradeName: store.tradeName }))}
          />
        </Card>
      </div>
    </div>
  );
}
