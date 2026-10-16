import { useCallback, useEffect, useRef, useState } from "react";
import { useScope } from "@/pages/dashboard/useScope";
import { useActiveSession } from "@/session/SessionProvider";
import { loadDocuments, type BatchRow, type DocumentRow, type PersonRow } from "@/data/wedash/documentsRepo";
import { documentPeople, type BranchUser, type SignerContact } from "@/data/wedash/documentSplit";
import { fetchSystemUsers, type SystemUser } from "@/data/wedash/systemUsers";

export function useDocuments() {
  const session = useActiveSession();
  const { scope } = useScope();
  const storeId = scope.storeIds.length === 1 ? scope.storeIds[0] : null;
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [history, setHistory] = useState<SignerContact[]>([]);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const gen = ++generation.current;
    try {
      const [data, users] = await Promise.all([loadDocuments(session.tenantId, storeId), fetchSystemUsers()]);
      if (gen !== generation.current) return;
      setBatches(data.batches);
      setDocuments(data.documents);
      setPeople(documentPeople(data.people, users.ok ? branchUsers(users.data.members) : [], data.stores.map((store) => store.id)));
      setStores(data.stores);
      setHistory(data.history);
    } catch {
      /* a próxima leitura substitui; a tela não fica presa no skeleton */
    } finally {
      if (gen === generation.current) setLoading(false);
    }
  }, [session.tenantId, storeId]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  return { storeId, allStores: storeId == null, batches, documents, people, stores, history, loading, reload };
}

function branchUsers(members: SystemUser[]): BranchUser[] {
  return members.flatMap((member) => {
    if (member.role !== "OWNER" && member.role !== "MANAGER") return [];
    if (member.status !== "ACTIVE" && member.status !== "SUSPENDED") return [];
    if (!member.identityId || !member.name.trim()) return [];
    return [{
      membershipId: member.membershipId,
      identityId: member.identityId,
      name: member.name,
      email: member.email,
      cpf: member.cpf ?? null,
      whatsapp: member.whatsapp ?? null,
      role: member.role,
      status: member.status,
      storeIds: member.storeIds,
    }];
  });
}
