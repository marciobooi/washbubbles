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
| Backups | `/root/backups` no Hetzner, diário 03:20, 14 dias (`backup.log`). Restauro: `mongorestore --gzip --archive=<ficheiro> --nsInclude 'washstore.*'` num Mongo à parte primeiro |

**Contactos / acessos:** Hetzner `ssh root@128.140.118.209` (`/opt/washbubbles`); PCs por Tailscale. Registos do servidor: `/var/log/washbubbles-deploy.log`, `-release.log`, `-domains.log`.
