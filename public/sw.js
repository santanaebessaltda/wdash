/* Service worker do PWA.
   Regra: navegação NUNCA sai do cache quando há rede. Guardar o index.html
   antigo faz o app inteiro voltar a uma versão anterior, porque o HTML velho
   aponta para pacotes que não existem mais. O cache serve só para abrir
   offline e para os arquivos com hash no nome. Nunca cacheia resposta de erro
   (404 de chunk antigo depois de deploy). */
const VERSAO = "v13";
const CACHE = `wedash-${VERSAO}`;
// Escopo do SW (= base do app). Em dominio proprio fica "/".
const BASE = self.registration.scope;
const INDEX = new URL("index.html", BASE).href;
// Nomes com v4: o Chrome trata a URL do ícone como imutável. Sem trocar o
// endereço, quem já salvou o app continua com o ícone antigo.
const OFFLINE = [
  "index.html",
  "manifest.webmanifest",
  "favicon-v4.png",
  "logo.png",
  "icons/icon-192-v4.png",
  "icons/icon-512-v4.png",
  "icons/icon-512-maskable-v4.png",
  "icons/apple-touch-icon-v4.png",
].map((arquivo) => new URL(arquivo, BASE).href);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(OFFLINE))
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("push", (event) => {
  let data = { title: "WDash", body: "Vendas atualizadas.", url: "/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    /* payload vazio: mostra o texto padrão */
  }
  const opcoes = {
    body: data.body,
    icon: new URL("logo.png?v=4", BASE).href,
    // A mesma tag troca o resumo anterior e volta a avisar. Sem isso o iPhone
    // às vezes engole o seguinte depois que o app foi aberto pelo primeiro.
    tag: data.tag || "wdash-" + Date.now(),
    renotify: true,
    data: { url: data.url || "/" },
  };
  event.waitUntil(
    self.registration.showNotification(data.title, opcoes).catch(() =>
      self.registration.showNotification(data.title, {
        body: opcoes.body,
        icon: opcoes.icon,
        data: opcoes.data,
      }),
    ),
  );
});

self.addEventListener("notificationclick", (event) => {
  const url = new URL(event.notification.data?.url || "/", BASE).href;
  // Mesmo texto de NOTIFICATION_OPEN em src/push/resumeSales.ts.
  const aviso = { type: "wedash:notification-open" };
  event.waitUntil(
    (async () => {
      try {
        const janelas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        const aberta = janelas.find((janela) => janela.url.startsWith(BASE));
        if (aberta) {
          // Só o focus deixa o PWA com o número de antes da rodada: em segundo
          // plano o timer congela e, no iPhone, voltar pelo aviso não dispara
          // visibilitychange. A página escuta esta mensagem e busca de novo.
          await aberta.focus();
          try {
            aberta.postMessage(aviso);
          } catch {
            /* a página também confere ao voltar */
          }
        } else {
          const nova = await self.clients.openWindow(url);
          try {
            nova?.postMessage(aviso);
          } catch {
            /* página nova já busca ao abrir */
          }
        }
      } finally {
        // Fechar antes do focus mata o service worker no iPhone.
        event.notification.close();
      }
    })(),
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const antiga = event.oldSubscription;
        const nova =
          event.newSubscription ||
          (await self.registration.pushManager.subscribe(antiga ? antiga.options : { userVisibleOnly: true }));
        const janelas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        const troca = { type: "wedash:push-subscription", subscription: nova.toJSON() };
        for (const janela of janelas) janela.postMessage(troca);
      } catch {
        /* a página cria outra inscrição ao abrir */
      }
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  // Navegacao: sempre rede. So cai no cache se estiver realmente offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copia = res.clone();
            caches
              .open(CACHE)
              .then((c) => c.put(INDEX, copia))
              .catch(() => undefined);
          }
          return res;
        })
        .catch(() => caches.match(INDEX)),
    );
    return;
  }

  // Demais arquivos: rede primeiro, cache como reserva. Nao grava 404/5xx.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copia = res.clone();
          caches
            .open(CACHE)
            .then((c) => c.put(req, copia))
            .catch(() => undefined);
        }
        return res;
      })
      .catch(() => caches.match(req)),
  );
});
