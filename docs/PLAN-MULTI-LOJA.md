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
1.1 **Loja pelo endereço do site**: cada loja tem uma lista de endereços (`marcioslvinc.ro`, `www.marcioslvinc.ro`); o servidor decide a loja pelo endereço que o visitante abriu (`freshbubbles.pt` → FreshBubbles, que mantém tudo o que está configurado). Endereço desconhecido → 404. `PUBLIC_TENANT_SLUG` só para desenvolvimento / acesso por IP. Usado pelo site público, marca do login, página inicial e máquinas públicas. Resolve P1.
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
3.4 **Loja nova: começa VAZIA, nada é copiado de outra loja (decisão do dono: nada se mistura).** Preços, máquinas, interfaces, periféricos, cartões, cupões, textos e definições criam-se de raiz na loja nova. Para não ficar perdido, o admin mostra uma **lista de arranque** ("Defina os preços · Crie as interfaces · Crie as máquinas · Defina o PIN · Defina o email de alertas") que vai ficando riscada. A rede do posto (IP do PC, IP e porta do controlador, placa de rede) vai no ficheiro de instalação, com os valores por defeito editáveis.

3.5 **O cliente não é técnico (requisito do dono).** O que se entrega é UM ficheiro que se executa com duplo clique (`Instalar-<loja>.exe` ou `.bat` que se auto-eleva), sem abrir PowerShell, sem escrever comandos, sem editar ficheiros. Faz tudo sozinho: pede administrador (UAC), instala Node/MongoDB/serviços em falta (offline-safe: dependências incluídas ou descarregadas com verificação), escreve a configuração (chave, servidor, rede), cria o arranque automático do quiosque e do ecrã inteiro, abre as portas necessárias, testa a ligação ao servidor e ao controlador e termina com um ecrã grande "Instalação concluída" ou, se algo falhar, uma mensagem em português simples com o que fazer (e um ficheiro de diagnóstico que o cliente nos envia por um clique). Idempotente: pode ser corrido outra vez sem estragar nada. Teste obrigatório: instalar num Windows limpo (máquina virtual) sem intervenção além do duplo clique.

### Fase 4 — Vários postos na mesma loja (só se fizer falta)
Hoje as máquinas, interfaces e preços pertencem à **loja**, não ao posto: dois PCs na mesma loja iam puxar as máquinas um do outro. Solução: conceito de **posto** (`siteId`) em Máquina/Interface/Periférico, e cada quiosque só vê o seu; cartões e preços partilhados na loja. Até lá: **uma loja por espaço físico**.

### Fase 1b — Site público por loja (o cliente novo compra o pacote completo: quiosque + admin + site)
**Feito (backend + editor):** cada endereço mostra o site da SUA loja, editado no admin da loja ("Página Inicial"); cache por loja; loja nova começa com uma página NEUTRA (nome da loja, sem morada/telefone/avaliações/serviços da FreshBubbles; blocos vazios não aparecem); canonical, sitemap, robots e páginas legais usam o endereço da loja; o editor do admin começa dos valores da própria loja. **Falta:** rótulo do cartão e textos do `buycard`, emails e página MB WAY ainda com a marca fixa; ficheiros de imagem de partilha (og) por loja; idioma/país por loja (um `.ro` precisa de textos e moeda próprios).

O nome da empresa, morada, textos, mapa, política de privacidade, `sitemap`, `robots.txt` e ligações canónicas deixam de estar no código (hoje: FreshBubbles) e passam a vir da loja do endereço. Cache da página inicial e das traduções por loja e idioma. O admin de cada loja vive no mesmo endereço (`/admin`) com a marca da loja; um utilizador só entra no admin da sua loja (o superadmin entra em qualquer uma).

### Fase 3b — "Criar loja" automático (o botão único)
**Formulário** (Lojas → Criar loja): nome da empresa · identificador (sugerido) · **endereço do site** (`www.marcioslvinc.ro`, normalizado para `marcioslvinc.ro` + `www`) · **email do cliente** · nome do administrador · idioma do email (PT/EN) · criar posto kiosk (sim) · rede do posto (IP do PC, IP/porta do controlador). **Sem opção de copiar dados de outra loja.**
**O que acontece ao carregar em Criar:**
1. Cria a loja **vazia**, o administrador (sem palavra-passe em claro: o cliente recebe uma ligação para a **definir**, válida 7 dias) e o posto kiosk com chave pendente. Nenhum dado de outra loja é copiado.
2. **Envia ao cliente um email** (caixa de envio atual) com: o que é e o que vai acontecer; **como ligar o domínio** (criar 2 registos `A`: `@` e `www` → `128.140.118.209`, TTL 3600; apagar `A`/`AAAA`/`CNAME` que existam para esses nomes; explicação passo a passo em linguagem simples e onde se faz isto no painel do registador); a ligação para **definir a palavra-passe do administrador**; e o contacto de apoio. Cópia para o superadmin.
3. O admin mostra os passos em direto: ✅ loja criada · ✅ utilizadores · ⏳ DNS (mostra os registos a criar e o resultado da verificação) · ⏳ certificado · ✅ site ativo. Botões "Reenviar email" e "Verificar agora".
4. **Serviço no servidor** (separado da aplicação, como o atualizador automático; a aplicação nunca corre comandos): lê os pedidos de domínio da base de dados, só aceita nomes com formato estrito de pedidos de um superadmin, espera que o DNS aponte para nós, pede o certificado para `@` e `www`, liga o domínio ao site, recarrega o nginx, marca "ativo" e **envia o email "o seu site está ativo"** ao cliente. Se falhar mostra o motivo no admin e volta a tentar.
5. Tudo registado na auditoria. Limite de pedidos por hora para evitar abusos (e os limites da Let's Encrypt).
Sem o DNS a loja já funciona no admin e no quiosque; o site público mostra "a aguardar" até o DNS estar certo.

## 4. Ordem e riscos
- **Fase 1 tem de vir antes de criar a 2.ª loja** (P1).
- 1.3 exige migração: verificar utilizadores duplicados antes de criar o índice único (hoje: marcio, tatiane, kiosk — sem duplicados).
- Cada fase termina com testes automáticos + passos no `GO-LIVE-TESTS.md`.

## 5. Decisões necessárias
1. Nomes de utilizador **únicos globalmente** (recomendado) ou login com "loja/utilizador"?
2. Qual é a **loja do site público** (freshbubbles.pt)? (a atual)
3. Cada loja com o seu **domínio e marca** públicos, ou só admin/quiosque para as outras?
4. **Email** (recibos, alertas): a mesma caixa para todas as lojas ou uma por loja?
5. ~~Loja modelo para copiar preços~~ — **decidido: não existe; cada loja começa vazia.**
6. **Vários postos** por loja: agora ou mais tarde?

## 6. O que mais falta para uma loja nova impecável (revisão de lacunas, 2026-10-23)

Factos verificados: **não há backups do Mongo no Hetzner** (`/root/backups` vazio, sem cron de dump); "FreshBubbles" está escrito no código (frontend: 8 ficheiros, incluindo «Cartão FreshBubbles» nos 5 idiomas da compra de cartão; backend: 11 ficheiros, incluindo emails, página inicial, página do MB WAY); não há fuso horário por loja; há 30 ficheiros ligados a euro/pt-PT e 23 referências a NIF / Livro de Reclamações.

### 🔴 Antes de criar a 2.ª loja
| # | Lacuna | O que fazer |
|---|---|---|
| A | **Sem backups** | Dump diário do Mongo + cópia fora do servidor (Storage Box/S3), retenção, **teste de restauro**, e exportação por loja. Fazer já, independentemente das lojas |
| B | **País, moeda, idioma, fuso por loja.** O sistema é PT + euro (NIF, Livro de Reclamações, MB WAY/Eupago só PT, telefones PT, tabelas de moedas em euro, idiomas PT/EN/FR/DE/ES). Um `.ro` sugere Roménia (lei, moeda, fiscalidade, idioma diferentes) | Decidir: só lojas em Portugal por agora, ou "perfil de país" por loja (moeda, idiomas, documentos fiscais, métodos de pagamento, fuso) |
| C | **Marca escrita no código** | Tudo o que diz «FreshBubbles» passa a vir da marca da loja (cartão, emails, página inicial, página MB WAY, textos por defeito) |
| D | **Trava do posto:** um PC lembra a que loja pertence e **recusa a chave de outra loja** (evita misturar dados num PC já usado). Reinstalar = "repor posto" com PIN e confirmação | Fase 3 |
| E | **Atualização automática de todos os PCs a partir do `main`:** um erro atinge todas as lojas ao mesmo tempo | Canal/versão por loja, pausa por loja, e testar primeiro numa loja ("canário") |
| F | **Tailscale:** todos os PCs na mesma rede privada podiam ver-se uns aos outros | ACL por etiquetas: só tu chegas aos PCs; lojas não se vêem |

### 🟠 Antes do primeiro cliente
| # | Lacuna | O que fazer |
|---|---|---|
| G | Email de envio e **recibos**: hoje os recibos saem de `marcacoes@freshbubbles.pt` e não são fiscais; cada negócio tem as suas obrigações de faturação | Remetente por loja (SPF/DKIM do domínio da loja), e dizer claramente que o recibo não é fiscal |
| H | **RGPD:** cada loja é responsável pelos dados dos seus clientes, e nós somos subcontratantes | Textos legais próprios por loja (sem os da FreshBubbles), contrato de subcontratante, exportar/apagar dados de uma loja, retenção |
| I | **"Loja pronta?":** o quiosque não deve vender sem preços/máquinas; definições por defeito seguras; tabelas de moedas e notas **por modelo de aceitador** (não as da FreshBubbles) | Lista de arranque + bloqueio de venda + assistente de hardware com modelos genéricos |
| J | **Suspender / arquivar loja** (falta de pagamento, encerramento) | O posto deixa de sincronizar, o site mostra "indisponível", os dados ficam retidos e exportáveis. Definir o modelo comercial (quem paga o quê, limites) |
| K | **Pagamentos por loja:** conta Eupago de cada negócio (o dinheiro vai para a conta dele); a ligação do QR do MB WAY deve mostrar o endereço da loja, não o da FreshBubbles | Documentar e ajustar |
| L | **Monitorização:** loja offline, certificado a expirar, domínio que deixou de apontar, backup falhado | Alertas para ti + painel de estado de todas as lojas |
| M | **Domínios, casos reais:** domínio sem www, IPv6 (`AAAA`), `CNAME`, registos `CAA`, domínio removido (limpar certificado), renovação falhada, limites da Let's Encrypt, domínio expirado | O serviço de provisionamento trata e avisa |
| N | **Ambiente de teste** e loja "demo" para ensaiar a criação sem tocar na produção; **verificação automática de loja saudável** (DNS, HTTPS, login, posto online, sincronização, venda de teste) | Antes de cada loja real |
| O | **Suporte:** o acesso "a atuar como" já fica na auditoria; falta o guia de incidentes e os contactos | Documento curto |

### 🟡 Mais tarde
Vários postos por loja (fase 4), faturação certificada, API para terceiros.
