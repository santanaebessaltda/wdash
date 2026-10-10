/* Service worker do PWA.
   Regra: navegação NUNCA sai do cache quando há rede. Guardar o index.html
   antigo faz o app inteiro voltar a uma versão anterior, porque o HTML velho
   aponta para pacotes que não existem mais. O cache serve só para abrir
   offline e para os arquivos com hash no nome. Nunca cacheia resposta de erro
   (404 de chunk antigo depois de deploy). */
const VERSAO = "v10";
const CACHE = `wedash-${VERSAO}`;
// Escopo do SW (= base do app). Em dominio proprio fica "/".
const BASE = self.registration.scope;
const INDEX = new URL("index.html", BASE).href;
const OFFLINE = ["index.html", "manifest.webmanifest", "favicon.svg", "icons/icon-192.png", "icons/icon-512.png"].map((arquivo) => new URL(arquivo, BASE).href);

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
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: new URL("icons/icon-192.png", BASE).href,
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", BASE).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((janelas) => {
      const aberta = janelas.find((janela) => janela.url.startsWith(BASE));
      if (aberta) return aberta.focus();
      return self.clients.openWindow(url);
    }),
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
