import { describe, expect, it } from "vitest";
import { accountSyncView, type ErpSyncJobRow } from "./erpAccountSync";
import { initialSyncFromJobs } from "./initialSync";

const NOW = Date.parse("2026-10-19T16:00:00Z");

function job(partial: Partial<ErpSyncJobRow> & Pick<ErpSyncJobRow, "credentialId" | "kind" | "status" | "createdAt">): ErpSyncJobRow {
  return {
    error: null,
    to: null,
    fillUntil: null,
    progressDay: null,
    deep: false,
    ...partial,
  };
}

describe("accountSyncView", () => {
  it("SEED na fila enquanto outra conta roda fica esperando, sem parecer sincronizador parado", () => {
    const view = accountSyncView("b", [
      job({ credentialId: "a", kind: "CLOSE", status: "RUNNING", createdAt: "2026-10-19T15:00:00Z" }),
      job({ credentialId: "b", kind: "SEED", status: "QUEUED", createdAt: "2026-10-19T15:50:00Z" }),
    ], NOW);
    expect(view.seed).toBe("waiting");
    expect(view.fill).toBeNull();
  });

  it("SEED parado na fila, sem outra carga, vira aviso de sincronizador", () => {
    const view = accountSyncView(
      "b",
      [job({ credentialId: "b", kind: "SEED", status: "QUEUED", createdAt: "2026-10-19T15:00:00Z" })],
      NOW,
    );
    expect(view.seed).toBe("stuck");
  });

  it("histórico aberto traz o dia já gravado e o início da carga", () => {
    const view = accountSyncView("a", [
      job({
        credentialId: "a",
        kind: "CLOSE",
        status: "RUNNING",
        createdAt: "2026-10-19T15:00:00Z",
        to: "2026-10-18",
        fillUntil: "2026-10-01",
        progressDay: "2026-10-10",
      }),
    ]);
    expect(view.seed).toBeNull();
    expect(view.fill).toEqual({ currentDay: "2026-10-09", fillUntil: "2026-10-01" });
  });

  it("Atualizar posterior esconde a falha da carga inicial", () => {
    const view = accountSyncView("a", [
      job({ credentialId: "a", kind: "SEED", status: "FAILED", createdAt: "2026-10-19T14:00:00Z", error: "timeout" }),
      job({ credentialId: "a", kind: "FORCE", status: "SUCCEEDED", createdAt: "2026-10-19T15:00:00Z" }),
    ]);
    expect(view.seed).toBeNull();
  });
});

describe("initialSyncFromJobs", () => {
  it("SEED rodando de outra conta aparece mesmo com um Atualizar mais novo", () => {
    expect(
      initialSyncFromJobs([
        { kind: "FORCE", status: "SUCCEEDED", error: null, createdAt: "2026-10-19T15:10:00Z" },
        { kind: "SEED", status: "RUNNING", error: null, createdAt: "2026-10-19T15:00:00Z" },
      ]),
    ).toEqual({ phase: "running" });
  });

  it("SEED na fila atrás de uma carga em andamento não vira sincronizador parado", () => {
    expect(
      initialSyncFromJobs(
        [
          { kind: "CLOSE", status: "RUNNING", error: null, createdAt: "2026-10-19T12:00:00Z" },
          { kind: "SEED", status: "QUEUED", error: null, createdAt: "2026-10-19T12:30:00Z" },
        ],
        NOW,
      ),
    ).toEqual({ phase: "waiting" });
  });

  it("fila recente, sem outra carga, continua sem aviso", () => {
    expect(
      initialSyncFromJobs([{ kind: "SEED", status: "QUEUED", error: null, createdAt: "2026-10-19T15:59:30Z" }], NOW),
    ).toEqual({ phase: "queued" });
  });
});
