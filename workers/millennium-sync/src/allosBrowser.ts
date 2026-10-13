import puppeteer from "puppeteer-core";

/** Chrome do servidor. No Windows de desenvolvimento, o Chrome instalado. */
export function chromePath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ALLOS_CHROME_PATH?.trim()) return env.ALLOS_CHROME_PATH.trim();
  if (process.platform === "win32") return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  return "/usr/bin/chromium";
}

/**
 * Abre o login da Allos e espera a verificação do navegador.
 * Devolve os cookies da sessão. Sem isso o POST da senha é recusado.
 */
export async function allosBrowserCookies(input: {
  baseUrl: string;
  username: string;
  password: string;
  executablePath: string;
}): Promise<{ ok: true; cookie: string; userAgent: string } | { ok: false }> {
  const browser = await puppeteer.launch({
    executablePath: input.executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  try {
    const page = await browser.newPage();
    const base = input.baseUrl.replace(/\/$/, "");
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const ready = await page
      .waitForFunction(() => {
        const button = document.querySelector("#btnEntrar");
        return button instanceof HTMLButtonElement && !button.disabled;
      }, { timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    if (!ready) return { ok: false };
    await page.type("input[type=text]", input.username);
    await page.type("input[type=password]", input.password);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 25_000 }).catch(() => null),
      page.click("#btnEntrar"),
    ]);
    const landed = await page
      .waitForFunction(
        () => location.pathname.includes("/loja") || location.search.includes("ne=r"),
        { timeout: 20_000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!landed) return { ok: false };
    const rejected = await page.evaluate(
      () => /n[aã]o foi poss[ií]vel efetuar o seu login/i.test(document.body?.innerText ?? "") || location.search.includes("ne=r"),
    );
    if (rejected) return { ok: false };
    const cookies = await page.cookies();
    const cookie = cookies.map((item) => `${item.name}=${item.value}`).join("; ");
    if (!cookie) return { ok: false };
    return { ok: true, cookie, userAgent: await browser.userAgent() };
  } finally {
    await browser.close();
  }
}
