# Plano: várias lojas (tenants), postos e instalação

Estado verificado a 2026-10-23 com testes reais (`backend/test/tenantIsolation.test.js`) e leitura do código.

## 1. O que já está bem (provado)
- **Isolamento de dados:** os utilizadores, máquinas, preços, cartões, definições, interfaces, periféricos, transações, auditoria, cupões, etc. de uma loja **não aparecem** nas listagens de outra, e uma loja **não consegue ler, alterar nem apagar** registos de outra pelo id. O `kiosk` de uma loja só sincroniza os dados dessa loja. Um cabeçalho `X-Tenant-Id` não faz um utilizador autenticado agir como outra loja.
- **Posto = utilizador KIOSK + chave** (a chave identifica a loja). Rotação de chave sem corte já existe.
- **Assistente de criação** no servidor (`POST /admin/setup/tenant-complete`: loja + admin + posto) — mas **sem ecrã** e sem instalador.

## 2. Problemas encontrados (a corrigir)
| # | Problema | Efeito hoje |
|---|---|---|
| P1 | Com **2 lojas** o servidor deixa de ter "loja por defeito". Os endereços públicos sem login ficam vazios | **Criar a 2.ª loja parte a página de login (marca/logótipo), a página inicial pública e a lista pública de máquinas** (provado: marca passa de "Loja A" a vazio, máquinas 1 → 0) |
| P2 | O **seletor de loja do superadmin não funciona**: o servidor ignora o cabeçalho para quem tem sessão | O superadmin só vê a sua própria loja; não consegue gerir outra |
| P3 | **Login ambíguo:** o nome de utilizador só é único *dentro* da loja, mas o login procura-o sem a loja | Dois "dono" em lojas diferentes: um deles não consegue entrar. O mesmo na recuperação de palavra-passe por email |
| P4 | A **associação utilizador↔loja** é só `User.tenantId` (definido ao criar). A tabela de associações (`TenantUser`) não é usada para autorizar; "atribuir utilizador a loja" cria um registo sem efeito | Não dá para criar um utilizador noutra loja a partir do admin (só pelo assistente) |
| P5 | Sem ecrã para criar lojas/postos, sem instalador gerado, e uma loja nova **começa vazia** (sem preços nem definições) | Tudo manual |
| P6 | Apagar um id de **outra loja** responde 200 ("success") sem apagar nada | Enganador (não é fuga de dados) |
| P7 | Encontrados na verificação e **já corrigidos**: a edição de cartão no admin **não gravava** nome/email/telefone/NIF; um arredondamento novo no saldo podia falhar numa atualização sem saldo | — |

## 3. Plano por fases

### Fase 1 — Base segura (antes de criar a 2.ª loja)
1.1 **Loja pública por defeito**: definição `PUBLIC_TENANT_SLUG` (e, mais tarde, domínio → loja). Usada pelo site público, branding do login, página inicial e máquinas públicas. Resolve P1.
1.2 **Superadmin "a atuar como a loja X"**: o servidor aceita `X-Tenant-Id` **só** de SUPERADMIN (valida que a loja existe; qualquer outro papel ignora o cabeçalho), com registo na auditoria. O seletor passa a funcionar e a barra do admin mostra "A ver: Loja X". Resolve P2.
1.3 **Login sem ambiguidade**: nome de utilizador **único em todo o sistema** (sem distinguir maiúsculas), com verificação/migração de duplicados antes do índice. O login devolve também a loja (`tenant {id, nome, slug}`). Resolve P3.
1.4 Apagar/alterar id de outra loja → **404** em todas as rotas. Resolve P6.
1.5 Ampliar `tenantIsolation.test.js` (superadmin muda de loja, login, site público com 2 lojas).

### Fase 2 — Utilizadores e lojas no admin
2.1 **Regra**: cada utilizador pertence a **uma** loja; o SUPERADMIN é global. Um ADMIN só gere utilizadores da sua loja (já é assim). `TenantUser` deixa de ser usado para autorizar (ou é removido).
2.2 **Ecrã "Lojas" (só superadmin)**: lista com nome, estado do posto (online/offline pelo último contacto), receita de hoje e nº de máquinas; **Criar loja** (assistente: nome, identificador, administrador inicial com palavra-passe gerada, posto) e **Gerir esta loja** (entra no painel dessa loja).
2.3 **Utilizadores**: o superadmin escolhe a **Loja** ao criar e a lista mostra a coluna Loja.
2.4 **Aterragem após o login**: ADMIN/STAFF/TECHNICIAN → painel da sua loja; OPERATOR → Operações (já); SUPERADMIN → ecrã "Lojas" (visão geral de todas), e daí entra numa loja.

### Fase 3 — O botão "instalar um posto"
3.1 Em **Lojas → loja → Gerar instalação do posto**: cria (ou roda) o utilizador KIOSK da loja com uma **chave nova pendente** e descarrega `washbubbles-<loja>.json` (endereço do servidor, chave, nome e identificador da loja) + mostra o comando de uma linha para o PC.
3.2 `install-windows.ps1` aceita `-ConfigFile` (ou `-ServerUrl -Key`): escreve `SYNC_SERVER_URL` e `SYNC_API_KEY` no `.env`, gera a chave local, e o primeiro arranque puxa a configuração. Alternativa sem ficheiro: o ecrã "Chave do servidor" do quiosque (PIN) também aceita o endereço do servidor.
3.3 **Segurança do ficheiro:** só SUPERADMIN, mostrado/descarregado uma vez, auditado, a chave expira se nunca for usada (X dias) e há "Revogar posto".
3.4 **Loja nova com dados iniciais:** "Copiar de…" (preços, definições base, textos legais) a partir de uma loja modelo. As máquinas/interfaces/periféricos configuram-se por loja (cada loja tem o seu hardware).

### Fase 4 — Vários postos na mesma loja (só se fizer falta)
Hoje as máquinas, interfaces e preços pertencem à **loja**, não ao posto: dois PCs na mesma loja iam puxar as máquinas um do outro. Solução: conceito de **posto** (`siteId`) em Máquina/Interface/Periférico, e cada quiosque só vê o seu; cartões e preços partilhados na loja. Até lá: **uma loja por espaço físico**.

## 4. Ordem e riscos
- **Fase 1 tem de vir antes de criar a 2.ª loja** (P1).
- 1.3 exige migração: verificar utilizadores duplicados antes de criar o índice único (hoje: marcio, tatiane, kiosk — sem duplicados).
- Cada fase termina com testes automáticos + passos no `GO-LIVE-TESTS.md`.

## 5. Decisões necessárias
1. Nomes de utilizador **únicos globalmente** (recomendado) ou login com "loja/utilizador"?
2. Qual é a **loja do site público** (freshbubbles.pt)? (a atual)
3. Cada loja com o seu **domínio e marca** públicos, ou só admin/quiosque para as outras?
4. **Email** (recibos, alertas): a mesma caixa para todas as lojas ou uma por loja?
5. Existe uma **loja modelo** para copiar preços e definições?
6. **Vários postos** por loja: agora ou mais tarde?
