/**
 * Poll loop  -  claim sync_job  ->  run Millennium sync  ->  enqueue due LIGHT jobs.
 *
 * Run from this folder:
 *   npm install
 *   cp .env.example .env   # fill values
 *   npm start
 *
 * Pausar / liberar usuario do ERP (outro terminal):
 *   npm run erp -- pause | resume | logout | status
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { installAsciiConsole } from "./consoleAscii.ts";
import { createAdminClient, disconnectTenantSessions, enqueueDueAutoRefreshJobs, enqueueDueCloseJobs, enqueueDueDeepHistoryJobs, enqueueDueLightJobs, processOneJob, purgeOldSyncLogs, recoverOnStartup, SYNC_LOG_RETENTION_DAYS, recoverStaleRunningJobs } from "./deps.ts";
import { logoutMillennium } from "./millenniumAuth.ts";
import { closeHour, dailyCloseEnabled, releaseActiveMillenniumSession } from "./runSyncJob.ts";
import { downloadStonePixCsv } from "./stonePix.ts";
import { ingestStonePixCsv } from "./stoneIngest.ts";
import { registerStoneWebhooks, runStoneCloseScan } from "./stoneCloseScan.ts";
import { startStoneWebhook } from "./stoneWebhook.ts";
import { assertSyncConfig, autoRefreshEnabled, deepHistorySpan, describeSpan, onboardingSpan } from "./syncConfig.ts";
import { isWorkerPaused } from "./workerPause.ts";
import { acquireWorkerLock, releaseWorkerLock } from "./workerLock.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Load key=value from workers/millennium-sync/.env (simple, no dependency). */
function loadDotEnv() {
  const candidates = [
    resolve(__dirname, "../.env"),
    resolve(__dirname, "../../../.env"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      const key = t.slice(0, i).trim();
      let val = t.slice(i + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
    // Map Vite names if present
    if (!process.env.SUPABASE_URL && process.env.VITE_SUPABASE_URL) {
      process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL;
    }
    console.log(`Ambiente carregado: ${path}`);
    return;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (process.platform === "win32") installAsciiConsole();
  loadDotEnv();
  acquireWorkerLock();

  const pollMs = Number(process.env.POLL_INTERVAL_MS ?? "5000") || 5_000;
  const erpSecret = process.env.ERP_SECRET_KEY?.trim();
  if (!erpSecret) throw new Error("Missing ERP_SECRET_KEY");
  if (!process.env.SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (Dashboard → Settings → API → service_role)");
  }
  assertSyncConfig();

  const sb = createAdminClient();
  const webhookToken = process.env.STONE_WEBHOOK_TOKEN?.trim() ?? "";
  const webhookUrl = process.env.STONE_WEBHOOK_PUBLIC_URL?.trim() ?? "";
  const webhookPort = Number(process.env.PORT ?? "8080") || 8080;
  const webhook = startStoneWebhook({
    port: webhookPort,
    token: webhookToken,
    onPix: async (notice) => {
      const csv = await downloadStonePixCsv(notice.url);
      const saved = await ingestStonePixCsv(sb, { document: notice.document, day: notice.referenceDate, csv });
      if (!saved) console.warn(`AVISO PIX Stone ${notice.referenceDate}: nenhuma loja para o documento`);
    },
  });
  webhook.on("error", (e) => {
    console.warn(`AVISO PIX Stone: porta ${webhookPort} — ${e instanceof Error ? e.message : String(e)}`);
  });
  console.log(
    webhookToken
      ? `  PIX Stone                : escutando na porta ${webhookPort}`
      : "  PIX Stone                : sem STONE_WEBHOOK_TOKEN — a rota fica fechada",
  );
  if (webhookToken && webhookUrl) {
    void registerStoneWebhooks(sb, erpSecret, webhookUrl).catch((e) => {
      console.warn(`AVISO webhook PIX Stone: ${e instanceof Error ? e.message : String(e)}`);
    });
  }
  await recoverOnStartup(sb);
  console.log("Worker Millennium");
  const onboarding = onboardingSpan();
  const deep = deepHistorySpan();
  console.log(
    `  Carga do onboarding      : ${onboarding === "off" ? "sem vendas — só o cadastro (equipe e produtos)" : describeSpan(onboarding)} (SYNC_ONBOARDING)`,
  );
  console.log(
    `  Atualização automática   : ${autoRefreshEnabled() ? "a cada 30 min, o dia todo" : "desligada — só o Atualizar manual"} (AUTO_REFRESH)`,
  );
  console.log(
    `  Fechamento da madrugada  : ${dailyCloseEnabled() ? `a partir das ${closeHour()}h` : "desligado"} (CLOSE_HOUR)`,
  );
  console.log(
    `  Histórico antigo         : ${deep === "off" ? "desligado" : `${describeSpan(deep)}, até a inauguração, na madrugada`} (DEEP_HISTORY)`,
  );
  console.log("  Dias perdidos            : recuperados no próximo Atualizar ou fechamento da madrugada");
  if (process.env.LIGHT_AUTO === "1") console.log("  Atualização rápida (LIGHT): ligada (LIGHT_AUTO=1)");
  if (isWorkerPaused()) {
    console.log("AVISO Pausado local (.millennium-pause). Retome com: npm run erp -- resume");
  }

  let stopping = false;
  let wasPaused = isWorkerPaused();
  let lastIdleLog = 0;
  let lastLogPurge = 0;
  const purgeLogsIfDue = async () => {
    if (Date.now() - lastLogPurge < 6 * 60 * 60_000) return;
    lastLogPurge = Date.now();
    try {
      const n = await purgeOldSyncLogs(sb);
      if (n > 0) console.log(`Logs: ${n} registro(s) com mais de ${SYNC_LOG_RETENTION_DAYS} dias removidos`);
    } catch (e) {
      console.warn(`Logs: limpeza falhou: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  await purgeLogsIfDue();
  let lastCloseScan = 0;
  const enqueueCloseIfDue = async () => {
    if (!dailyCloseEnabled() || Date.now() - lastCloseScan < 10 * 60_000) return 0;
    lastCloseScan = Date.now();
    try {
      return await enqueueDueCloseJobs(sb);
    } catch (e) {
      console.warn(`Fechamento: varredura falhou: ${e instanceof Error ? e.message : String(e)}`);
      return 0;
    }
  };
  let lastAutoScan = 0;
  const enqueueAutoIfDue = async () => {
    if (Date.now() - lastAutoScan < 60_000) return 0;
    lastAutoScan = Date.now();
    try {
      return await enqueueDueAutoRefreshJobs(sb);
    } catch (e) {
      console.warn(`Atualização automática: varredura falhou: ${e instanceof Error ? e.message : String(e)}`);
      return 0;
    }
  };
  let lastDeepScan = 0;
  const enqueueDeepIfDue = async () => {
    if (deep === "off" || Date.now() - lastDeepScan < 60_000) return 0;
    lastDeepScan = Date.now();
    try {
      return await enqueueDueDeepHistoryJobs(sb);
    } catch (e) {
      console.warn(`Histórico antigo: varredura falhou: ${e instanceof Error ? e.message : String(e)}`);
      return 0;
    }
  };
  let lastStoneScan = 0;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    webhook.close();
    console.log("Encerrando… (token ERP do tenant permanece até pause/logout)");
    void releaseActiveMillenniumSession(logoutMillennium).finally(() => {
      releaseWorkerLock();
    });
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.on("exit", () => {
    releaseWorkerLock();
  });

  while (!stopping) {
    try {
      const paused = isWorkerPaused();
      if (paused && !wasPaused) {
        console.log("Pausa local — liberando sessão Millennium…");
        await releaseActiveMillenniumSession(logoutMillennium);
        const n = await disconnectTenantSessions(sb, logoutMillennium);
        console.log(`Pausado · ${n} sessão(ões) encerrada(s)`);
      }
      if (!paused && wasPaused) {
        console.log("Retomado");
      }
      wasPaused = paused;

      if (!paused) {
        const stale = await recoverStaleRunningJobs(sb);
        if (stale > 0) console.log(`Recuperados ${stale} job(s) travados`);
        await purgeLogsIfDue();
        let worked = false;
        for (let i = 0; i < 5; i++) {
          const did = await processOneJob(sb, erpSecret);
          if (!did) break;
          worked = true;
        }
        if (Date.now() - lastStoneScan >= 10 * 60_000) {
          lastStoneScan = Date.now();
          try {
            const stone = await runStoneCloseScan(sb, erpSecret);
            if (stone > 0) console.log(`Stone: ${stone} arquivo(s) de fechamento`);
          } catch (e) {
            console.warn(`Stone: varredura falhou: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        const closes = await enqueueCloseIfDue();
        if (closes > 0) console.log(`+${closes} fechamento de ontem`);
        const autos = await enqueueAutoIfDue();
        if (autos > 0) console.log(`+${autos} atualização automática`);
        const deeps = await enqueueDeepIfDue();
        if (deeps > 0) console.log(`+${deeps} mês do histórico antigo`);
        const light = await enqueueDueLightJobs(sb);
        if (light > 0) console.log(`+${light} sync do dia (LIGHT)`);
        const n = closes + autos + deeps + light;
        // "Aguardando" so na transicao para ocioso (nao repete a cada poll).
        if (!worked && n === 0) {
          if (lastIdleLog === 0) {
            console.log(`Aguardando sincronizações (desde ${new Date().toLocaleTimeString("pt-BR", { hour12: false })})`);
            lastIdleLog = Date.now();
          }
        } else {
          lastIdleLog = 0;
        }
        if (stopping) break;
        // Acabou de trabalhar  ->  recheca rapido (FORCE nao espera o poll cheio).
        await sleep(worked || n > 0 ? Math.min(1_000, pollMs) : pollMs);
        continue;
      }
    } catch (e) {
      console.error("Erro no ciclo:", e instanceof Error ? e.message : e);
    }
    if (stopping) break;
    await sleep(pollMs);
  }

  releaseWorkerLock();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  releaseWorkerLock();
  process.exit(1);
});
