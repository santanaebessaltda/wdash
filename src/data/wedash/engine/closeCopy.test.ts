import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = fileURLToPath(new URL("..", import.meta.url));
const copy = fileURLToPath(new URL("../../../../supabase/functions/_shared/close/", import.meta.url));

function text(path: string): string {
  return readFileSync(path, "utf8").replace(/from "(\.\/[^"]+)\.ts"/g, 'from "$1"');
}

describe("supabase/functions/_shared/close", () => {
  it("matches the cash close helpers the wallet edge imports", () => {
    for (const file of ["employeeWithdrawal.ts", "onlinePix.ts", "cashCloseView.ts", "shortageAssign.ts"]) {
      expect(text(copy + file), file).toBe(text(src + file));
    }
  });
});
