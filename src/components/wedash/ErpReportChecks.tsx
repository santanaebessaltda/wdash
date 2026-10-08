import { Alert } from "@/components/ui";
import type { ErpReportCheck } from "@/data/wedash/erp";

/** Resultado do teste de acesso aos relatorios personalizados do Millennium (onboarding + Integracoes). */
export function ErpReportChecks({ reports, username }: { reports: ErpReportCheck[]; username: string }) {
  return (
    <Alert
      variant="danger"
      title="Faltam acessos no Millennium"
      footer={
        <ul className="mt-2.5 space-y-1.5">
          {reports.map((r) => (
            <li key={r.key} className="flex items-start gap-2 text-[12.5px]">
              <span className={`mt-px font-bold ${r.ok ? "text-ok" : "text-bad"}`}>{r.ok ? "✓" : "✕"}</span>
              <span className="min-w-0">
                <span className={r.ok ? "text-t2" : "font-semibold text-t0"}>{r.name}</span>
                {!r.ok && r.error && <span className="block text-[11.5px] text-t2">{r.error}</span>}
              </span>
            </li>
          ))}
        </ul>
      }
    >
      Peça ao administrador do Millennium para liberar os relatórios abaixo para o usuário{" "}
      <span className="font-bold">{username || "informado"}</span>. Depois, teste a conexão novamente.
    </Alert>
  );
}
