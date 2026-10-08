// Copia o motor da meta (src/data/wedash/engine, sem os testes) para supabase/functions/_shared/engine.
// As Edge Functions importam a copia; engineCopy.test.ts falha se ela divergir da fonte.
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src/data/wedash/engine");
const dest = join(root, "supabase/functions/_shared/engine");

const files = readdirSync(src).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
mkdirSync(dest, { recursive: true });
for (const f of readdirSync(dest)) if (!files.includes(f)) rmSync(join(dest, f));
for (const f of files) copyFileSync(join(src, f), join(dest, f));
console.log(`engine: ${files.length} arquivos copiados para supabase/functions/_shared/engine`);
