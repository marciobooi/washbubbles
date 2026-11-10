# Suporte às lojas — guia curto

**Onde está tudo:** Admin → **Lojas** (só superadmin). Botão **Plataforma**: email de suporte e conta de envio de email.

| Situação | O que fazer |
|---|---|
| Cliente não recebeu o email de boas-vindas | Lojas → loja → **Reenviar email**. Se falhar, ver Plataforma (servidor/palavra-passe do email) |
| "O site não abre" no domínio novo | **Verificar DNS**: mostra o que está mal (registo A errado, AAAA, CNAME). Corrigir com o cliente; o sistema repete sozinho. Passadas 5 tentativas falhadas chega um email de alerta ao email de suporte |
| Posto "offline" | Ver há quanto tempo. Abrir via Tailscale (PC) e ver `logs\backend.log`. Não reiniciar tudo: só o backend |
| Instalação falhou no cliente | Ver a auditoria da loja: `installer.failed` com o fim do registo; o cliente também tem `Diagnostico-<loja>.zip` no Ambiente de trabalho |
| Trocar o PC de uma loja | Lojas → **Gerar instalação do posto** outra vez: a chave nova fica pendente; o PC antigo continua até o novo ligar |
| Loja deixou de pagar / encerrou | **Suspender** (admins não entram, posto deixa de sincronizar, site "indisponível"; os dados ficam). **Reativar** volta ao normal |
| Entrar numa loja para ajudar | **Gerir** (fica na auditoria: `tenant.act_as`) |
| Backups | `/root/backups` no Hetzner, diário às 23:00, 7 dias (`backup.log`); mais as cópias por loja, ver "Cópias de segurança diárias". Restauro: `mongorestore --gzip --archive=<ficheiro> --nsInclude 'washstore.*'` num Mongo à parte primeiro |

**Contactos / acessos:** Hetzner `ssh root@128.140.118.209` (`/opt/washbubbles`); PCs por Tailscale. Registos do servidor: `/var/log/washbubbles-deploy.log`, `-release.log`, `-domains.log`.

## Cópias de segurança diárias (23:00)

Todos os dias às 23:00 (hora de Lisboa) o PC da loja faz uma cópia da sua base de dados, envia-a para o servidor central e vai buscar a cópia do que o central guarda dessa loja. Ficam as duas cópias nos dois sítios:

- PC da loja: `C:\washbubbles\backups\shop-AAAAMMDD.json.gz` e `central-AAAAMMDD.json.gz`
- Servidor central: `/opt/washbubbles/backups/<id da loja>/` com os mesmos dois ficheiros

Guardam-se as cópias dos últimos 7 dias de cada uma; as mais antigas só são apagadas depois de a nova estar escrita e conferida (lida de volta e contada). Um PC que estava desligado às 23:00 faz a cópia quando voltar a arrancar. Se falhar, tenta de 30 em 30 minutos e envia um e-mail de alerta ("Cópia de segurança falhou"). O resultado fica em `backups\last.json` e na auditoria (`backup.done`).

À mesma hora o servidor central faz também a cópia completa de todas as lojas (`scripts/backup-mongo.sh`, em `/root/backups`), que nunca sai do servidor.

Repor uma cópia (com o backend parado, numa base vazia; `--drop` substitui o que lá estiver):

    cd backend
    node scripts/restore-backup.mjs C:\washbubbles\backups\shop-AAAAMMDD.json.gz mongodb://localhost:27017/washstore

## MongoDB do servidor central com utilizador e password

No Hetzner o `.env.docker` tem `MONGO_AUTH=--auth`, o administrador (`MONGO_ROOT_USER` / `MONGO_ROOT_PASS`, usado pelos scripts de cópia e de domínios) e o `MONGODB_URL` da aplicação (utilizador `wbapp`, só a base `washstore`). Sem `MONGO_AUTH` a base corre aberta, como antes. O ficheiro anterior à mudança ficou em `/root/env.docker.before-mongo-auth`.
