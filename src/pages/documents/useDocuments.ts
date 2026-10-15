import { useCallback, useEffect, useState } from "react";
import { useScope } from "@/pages/dashboard/useScope";
import { useActiveSession } from "@/session/SessionProvider";
import { loadDocuments, type BatchRow, type DocumentRow, type PersonRow } from "@/data/wedash/documentsRepo";
import type { SignerContact } from "@/data/wedash/documentSplit";

export function useDocuments() {
  const session = useActiveSession();
  const { scope } = useScope();
  const storeId = scope.storeIds.length === 1 ? scope.storeIds[0] : null;
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [history, setHistory] = useState<SignerContact[]>([]);

  const reload = useCallback(async () => {
    const data = await loadDocuments(session.tenantId, storeId);
    setBatches(data.batches);
    setDocuments(data.documents);
    setPeople(data.people);
    setStores(data.stores);
    setHistory(data.history);
  }, [session.tenantId, storeId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { storeId, allStores: storeId == null, batches, documents, people, stores, history, reload };
}
