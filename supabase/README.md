# Supabase — Auth WeDash

## Env

Create `.env` at the repo root (see `.env.example`):

```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

Where to find them: **Project Settings → API**  
- Project URL → `VITE_SUPABASE_URL`  
- `anon` `public` → `VITE_SUPABASE_ANON_KEY`  

**Never** put `service_role` in the front end. Restart `npm run dev` after saving `.env`.

## Schema (English)

| Table | Purpose |
|-------|---------|
| `tenant` | Company account (name, active, …) — no white label: no slug / logo / display name |
| `identity` | Person 1:1 with `auth.users` |
| `membership` | identity ↔ tenant (role, is_owner, onboarding_step) |
| `membership_store` | Store scope for a membership |

Roles: `ADMIN_GLOBAL` | `OWNER` | `MANAGER` | `SELLER`  
Status: `PENDING` | `ACTIVE` | `SUSPENDED` | `DECLINED`

## SQL

### Fresh project

Run migrations in order (or `supabase db push`):

1. `20260919120000_auth_core.sql` — tenant / identity / membership + RLS  
2. `20260919130000_senha_temporaria.sql` — `temporary_password`  
3. `20260919140000_vinculo_onboarding_update.sql` — onboarding_step write  
4. `20260919150000_vinculo_filial_write.sql` — membership_store write  
5. `20260919160000_tenant_marca_update.sql` — tenant brand update  
6. `20260921120000_auth_schema_english.sql` — **no-op** if schema is already English  

Then seed:

7. `supabase/seed_user_santana.sql` — link Auth user → identity/membership (adjust email)

### Existing DB that still has Portuguese tables (`identidade`, `vinculo`, …)

1. Keep history as-is  
2. Run **only** `20260921120000_auth_schema_english.sql` (renames tables/columns + maps role/status values)  
3. Re-seed if needed  

If migration checksums conflict after the English rewrite of early files, prefer **reset** the remote DB and push fresh (auth is still early-stage).

## Recuperação de senha (OTP)

O app usa **código de 6 dígitos** (não depende de link/redirect).

Fluxo:

1. `/forgot` → `resetPasswordForEmail`  
2. Usuário digita o código + nova senha em `/reset`  
3. `verifyOtp({ type: "recovery" })` → `updateUser` → `signOut` → `/login`  

### Template de e-mail no Dashboard (obrigatório)

**Authentication → Emails → Reset password**

Troque o corpo para mostrar o código, por exemplo:

```html
<h2>Redefinir senha</h2>
<p>Use este código no app WeDash (válido por poucos minutos):</p>
<p style="font-size:24px;letter-spacing:4px;"><strong>{{ .Token }}</strong></p>
<p>Se você não pediu isso, ignore este e-mail.</p>
```

Sem `{{ .Token }}` no template, o e-mail só traz link e o OTP no app não funciona.

**Site URL** (Authentication → URL Configuration) = `https://wdash.app`.
É esse valor que vira `{{ .SiteURL }}` no e-mail de convite.

Redirect URLs: `https://wdash.app/**`, `https://wdash.app/invite/**`, `https://wdash.app/invite/link`
(e `http://localhost:5173/**` só em desenvolvimento).

### Franqueado novo (Invite do painel Supabase)

**Authentication → Users → Invite user** (só o e-mail) provisiona automaticamente:

- empresa nova (`tenant`; nome provisório = parte local do e-mail em caixa alta)
- gestor dono (`OWNER`, `is_owner`, `onboarding_step = 2`)
- identity/membership `PENDING` até aceitar o link

O franqueado abre o e-mail → Continuar → cria senha → conecta o Millennium.

Convites pela WDash (Configurações → Usuários / Vendedores) mandam `wdash: "member"` nos metadados e **não** abrem empresa nova.

## Edge Function — `millennium-onboarding`

Connects ERP during onboarding: credentials step = **login + FILIAIS.Lista**; stores step confirms and **logout**.

The browser talks only to the Edge Function, never to Millennium directly.

### Deploy

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase secrets set MILLENNIUM_API_BASE=http://177.85.160.35:6017/api
npx supabase functions deploy millennium-onboarding
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are already in the Edge runtime.

### Contract

`POST /functions/v1/millennium-onboarding` (JWT required)

**Connect (credentials step)**

```json
{ "username": "ESSENCIA.INTEGRACAO", "password": "...", "includeStores": true, "keepSession": true }
```

```json
{ "ok": true, "session": "...", "stores": [ { "storeId": 8, "code": "00008", "tradeName": "...", ... } ] }
```

or `{ "ok": false, "reason": "password" | "busy" | "other" | "stores" }`

Legacy PT body keys (`usuario`, `senha`, `incluirFiliais`, `manterSessao`) are still accepted during transition.

**Logout (back or confirm stores)**

```json
{ "action": "logout", "session": "..." }
```

### Note — Brazil IP

Millennium blocks requests from outside Brazil. Supabase Edge often exits from international IPs; if credentials are correct and you get `other`, next step is a BR proxy/region or a backend in Brazil.

### Curl equivalent (server / function only)

```bash
# Login
curl -s -X POST "http://177.85.160.35:6017/api/login" \
  -H "Content-Type: application/json" \
  -H "WTS-Authorization: USER/PASSWORD" \
  -H "WTS-AppName: millenium" \
  -H "WTS-LicenceType: retag"

# Stores (GET — Millennium client pattern)
curl -s "http://177.85.160.35:6017/api/millenium.filiais.lista?\$format=json&\$dateformat=iso&\$top=0" \
  -H "Accept: application/json" \
  -H "WTS-Session: TOKEN"

# Logout — ALWAYS at the end
curl -s -X POST "http://177.85.160.35:6017/api/logout" \
  -H "Content-Type: application/json" \
  -H "WTS-Session: TOKEN"
```
