# SFTP Cielo (`wdash-cielo-sftp`)

Dropbox SFTP para o Extrato Eletrônico da Cielo (**fluxo PUT**). A Cielo envia os arquivos; a WDash ainda não ingere deste volume (o fechamento continua pela API `link/generate`).

## Formulário Cielo (TI/Infra)

| Campo | Valor |
| --- | --- |
| Protocolo | SFTP |
| IP / Host | IPv4 dedicado (`fly ips list -a wdash-cielo-sftp`) |
| Porta SFTP | `2222` |
| Tipo de autenticação | Senha |
| Usuário | `cielo` |
| Senha | secret `SFTP_USERS` (não vai no git) |
| Chave SSH | vazio |
| Diretório | `inbox` |
| Observações | Origem Cielo `54.232.53.112`. Porta externa 2222. |

OAuth callback (já no formulário): `https://wdash-millennium-sync.fly.dev/hooks/cielo/oauth` — rota no worker Millennium (`CIELO_OAUTH_CLIENT_*` para trocar o code).

## Deploy atual

A rede corporativa (VALID) bloqueia o builder remoto do Fly. Por isso o app sobe com a **imagem pública** `atmoz/sftp:alpine` (sem `Dockerfile` no deploy):

```bash
cd workers/cielo-sftp
fly apps create wdash-cielo-sftp   # uma vez
fly volumes create cielo_inbox --region gru --size 1 -a wdash-cielo-sftp --yes
fly ips allocate-v4 -a wdash-cielo-sftp --yes
fly secrets set 'SFTP_USERS=cielo:SENHA_SEM_DOIS_PONTOS:1001:100:inbox' -a wdash-cielo-sftp
fly deploy --image atmoz/sftp:alpine --ha=false
```

`Dockerfile` + `entrypoint.sh` ficam no repo para um dia publicar via GitHub Actions (host keys no volume, `SFTP_USER`/`SFTP_PASSWORD` separados).

Custo aproximado: IPv4 dedicado ~US$2/mês + VM shared 256 MB + 1 GB volume.

## Teste

```bash
sftp -P 2222 cielo@<IP_DEDICADO>
# cd inbox
# put arquivo.txt
```

## Secrets

| Secret | Obrigatório | Notas |
| --- | --- | --- |
| `SFTP_USERS` | sim | Formato atmoz: `cielo:senha:1001:100:inbox` (senha **sem** `:`) |

O log do atmoz imprime a linha do usuário no boot — depois de trocar a senha, confira se o valor novo não ficou exposto em tela compartilhada.

## Nota de rede

O Fly Proxy não entrega o IP de origem ao `sshd`. Não dá para restringir login só a `54.232.53.112` no container; use senha forte.
