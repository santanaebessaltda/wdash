# Como rodar o sync do WeDash (explicação sem jargão)

## O que é isso?

O app WeDash **não fala direto** com o Millennium o tempo todo.  
Um programinha (o **worker**) fica rodando em segundo plano, busca as vendas no Millennium e grava no banco do WeDash.

Sem o worker ligado: os jobs ficam na fila (`QUEUED`) e a Visão Geral fica vazia.

```
Você no app  →  WeDash (Supabase)  ←  worker  →  Millennium
                     ↑
              números do dashboard
```

---

## Opção A — Testar no seu PC (mais fácil)

Serve para validar. Só funciona bem se o Millennium aceitar o IP da sua rede (Brasil).

### 1. Pegar a chave `service_role`

1. Abra https://supabase.com/dashboard/project/gjdslociicdkmjxxznyf/settings/api  
2. Em **Project API keys**, copie a chave **`service_role`** (secret)  
3. **Nunca** coloque essa chave no front / `VITE_*`

### 2. Criar o `.env` do worker

Na pasta `workers/millennium-sync/`:

```bash
copy .env.example .env
```

Edite o `.env` e preencha:

| Campo | De onde vem |
|-------|-------------|
| `SUPABASE_URL` | Igual ao `VITE_SUPABASE_URL` do `.env` da raiz |
| `SUPABASE_SERVICE_ROLE_KEY` | Passo 1 acima |
| `ERP_SECRET_KEY` | Já está no `.env` da raiz (foi gerada no deploy) |
| `MILLENNIUM_API_BASE` | Já vem preenchido no exemplo |

Dica: o worker também lê o `.env` da **raiz** do projeto se não achar o da pasta.

### 3. Instalar e ligar

No PowerShell, na pasta do worker:

```powershell
cd workers\millennium-sync
npm install
npm start
```

Você deve ver algo como:

```
[env] loaded ...
[sync] worker up · poll 45000ms · millennium ...
```

Deixe essa janela **aberta**. Enquanto estiver rodando, ele processa a fila.

### 4. Testar o fluxo

1. Faça (ou refaça) o onboarding de um tenant com ERP  
2. No terminal do worker deve aparecer `[sync] start job=... kind=BACKFILL`  
3. Abra a Visão Geral — faturamento começa a aparecer depois do sync

Para parar: `Ctrl+C` no terminal.

---

## Opção B — Deixar ligado 24h (VPS no Brasil)

Um **VPS** é um computador alugado na nuvem que fica ligado o dia todo.  
Como o Millennium exige IP brasileiro, o VPS precisa ser **no Brasil** (São Paulo).

Exemplos de provedores (você escolhe um e cria a máquina mais barata):

- Hostinger VPS Brasil  
- Contabo / DigitalOcean region São Paulo  
- AWS Lightsail São Paulo  

### Passos resumidos (qualquer VPS Linux)

1. Crie o VPS (Ubuntu 22.04, 1 GB RAM basta no começo)  
2. Anote o IP e a senha/SSH que o provedor mandar  
3. No seu PC, envie o código (ou clone o Git no servidor)  
4. No servidor:

```bash
# Instalar Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

# Ir para a pasta do worker (depois de clonar o repo)
cd wedash/workers/millennium-sync
cp .env.example .env
nano .env          # colar as 4 variáveis
npm install
npm start         # testa se sobe
```

5. Para não cair quando fechar o SSH, use **pm2**:

```bash
sudo npm install -g pm2
pm2 start npm --name wedash-sync -- start
pm2 save
pm2 startup      # siga o comando que ele mostrar
```

Pronto: o sync reinicia sozinho se o servidor reiniciar.

---

## O que você **não** precisa fazer agora

- Não precisa de Docker  
- Não precisa publicar o worker na internet (ele só **sai** para Millennium e Supabase)  
- Não precisa de domínio  

---

## Problemas comuns

| Sintoma | O que checar |
|---------|----------------|
| `Missing SUPABASE_SERVICE_ROLE_KEY` | `.env` sem a chave secret |
| `Missing ERP_SECRET_KEY` | Copiar a mesma do `.env` da raiz |
| Job falha `busy` | Outra sessão Millennium aberta. Libere com `npm run erp -- pause` (ou `logout`), use o ERP, depois `resume` |
| Job falha `password` / status INVALID | Re-salvar senha no onboarding |
| Visão Geral vazia com worker ligado | Olhar o terminal: tem `[sync] start`? Tem lojas em `store`? |
| Millennium `other` / timeout | IP fora do Brasil ou firewall do VPS |

---

## Resumo

1. Hoje: rode `npm start` no seu PC para ver funcionar.  
2. Depois: alugue um VPS barato em SP e deixe o mesmo comando com `pm2`.  

Se quiser, no próximo passo eu te ajudo a preencher o `.env` do worker (sem expor a service_role no chat) e a validar o primeiro BACKFILL.
