# Max Hub

Plataforma interna que reúne os setores da empresa em um só lugar, com login único, permissões por pessoa e a **Max**, assistente virtual por voz.

| Endereço | Para quem | O que faz |
|---|---|---|
| `/` | Todos | **Login global.** Cada pessoa cai direto na ferramenta do seu setor. A Max fica em escuta constante aqui. |
| `/hub` | Master geral | Painel master: setores, usuários, alocação e permissões |
| `/setor/almoxarifado` | Equipe do almoxarifado | Solicitações, estoque, postos, métricas, formulário, e-mails |
| `/setor/rh` · `/setor/operacional` · `/setor/financeiro` · `/setor/comercial` | Equipe de cada setor | Tela padrão, ainda sem funções (com Equipe, Minha conta e a Max) |
| `/solicitacao` | Supervisores dos postos | Formulário de pedido ao almoxarifado (sem login, só e-mails autorizados) |

Os endereços antigos `/login` e `/dashboard` continuam funcionando: redirecionam para os novos.

**Tecnologia:** Next.js 15 (React + TypeScript) na **Vercel**; banco, arquivos e tempo real no **Supabase**. A Max não usa nenhum serviço pago.

---

## Atualizando o site que já está no ar

> ⚠️ **Antes de tudo: troque as chaves do Supabase.** A versão anterior do arquivo `.env.example` tinha a chave secreta (`service_role`) de verdade e foi enviada ao GitHub. No Supabase, em **Project Settings → API Keys**, gere chaves novas; depois atualize `SUPABASE_SERVICE_ROLE_KEY` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` na Vercel e faça **Redeploy**.

### 1. Banco (Supabase)

No **SQL Editor**, rode o arquivo `supabase/maxhub.sql` inteiro. Ele pode ser rodado mais de uma vez e não mexe nos dados do almoxarifado. O que ele faz:

- acrescenta à tabela `admins` as colunas de setor, papel, permissões e ativo/desativado;
- na primeira vez, coloca quem já usava o painel no setor **Almoxarifado com acesso total** (ninguém perde nada);
- garante que **@mateus** é master geral.

### 2. Código (GitHub)

Vários arquivos **mudaram de pasta**. Não envie os novos por cima dos antigos: as rotas antigas (`app/api/admin/...`) continuariam no ar **sem** as permissões novas.

Na pasta do projeto no seu computador (a que tem a pasta oculta `.git`):

1. Apague tudo, **menos** a pasta `.git` (e o seu `.env.local`, se existir).
2. Descompacte o conteúdo do zip novo ali dentro.
3. No terminal:

```bash
git add -A
git commit -m "Max Hub: login global, setores, permissões e Max"
git push
```

A Vercel publica sozinha. Não há variável nova obrigatória.

> Publicou o código antes de rodar o SQL? O site continua funcionando como antes (todos no almoxarifado); só o cadastro de usuários avisa que falta o `maxhub.sql`.

### 3. Primeiro acesso

1. Entre em `/` com `mateus`. Você cai no **Painel master**.
2. Em **Usuários**, confira cada pessoa: setor, se é **master do setor** e as permissões.
3. Todos precisam entrar de novo uma vez (o login antigo deixa de valer).

---

## Acessos e permissões

| Papel | O que pode |
|---|---|
| **Master geral** | Tudo: painel master, todos os setores, criar/editar/desativar/excluir usuários, definir outros masters gerais e o master de cada setor |
| **Master do setor** | Acesso total à ferramenta do seu setor e, na aba **Equipe**, define as permissões dos outros membros do setor |
| **Membro** | Só o que foi liberado, módulo por módulo: **sem acesso**, **visualizar** ou **editar** |

- Cada pessoa pertence a **um** setor. Ao entrar, vai direto para ele e não abre os outros.
- As permissões valem **na hora**: o servidor confere no banco a cada ação (nunca confia só na tela) e a tela da pessoa se ajusta sozinha.
- Travas: ninguém tira o próprio acesso master nem se desativa, e o sistema nunca fica sem um master geral ativo.
- Quem só visualiza um módulo não vê os botões de alterar; se tentar por outro caminho, o servidor recusa.
- Pessoa sem setor entra e vê um aviso para procurar o administrador.

Módulos do Almoxarifado: Solicitações, Estoque, Postos, Métricas, Formulário e E-mails autorizados. Dar baixa de estoque pela resposta de uma solicitação exige **editar** em Solicitações **e** em Estoque.

---

## Max, a assistente virtual

**Na tela de login** ela fica acima do formulário, em **escuta constante**. Diga “Max, apresente-se”, “Max, bom dia” (ela responde conforme o horário de Salvador) ou “Max, que horas são?”. O botão **Escuta ligada** desliga o microfone, e a escolha fica lembrada naquele navegador. Antes do login ela só responde o que não depende de dados da empresa.

**Dentro de cada ferramenta** ela é a esfera no canto inferior direito. Clique nela, espere ficar **verde** e fale “Max, …”. Também dá para digitar (botão **Digitar**), usar **Alt+M** e fechar com **Esc**. O ícone de alto-falante liga e desliga a voz.

Alguns pedidos:

| Onde | Exemplos |
|---|---|
| Qualquer tela | “Max, que dia é hoje?” · “Max, quanto é 15% de 2400?” · “Max, abrir minha conta” · “Max, modo silencioso” · “Max, sair” |
| Almoxarifado | “Max, desejo ver as métricas da última semana” · “Max, tem solicitação nova?” · “Max, abrir a solicitação 12” · “Max, quanto tem de bota 42?” · “Max, o que está com estoque baixo?” · “Max, o que tem no Posto 01?” · “Max, copiar o link do formulário” |
| Painel master | “Max, quantos usuários temos?” · “Max, quem está no almoxarifado?” · “Max, em que setor está a Juliana?” · “Max, novo usuário chamado Rita Lopes no financeiro” · “Max, abrir o setor financeiro” |
| Com internet | “Max, como está o tempo?” · “Max, qual a cotação do dólar?” · “Max, quem foi Santos Dumont?” |

**Como ela pensa (tudo sem custo):**

1. **Habilidades locais**, no próprio navegador: entendem variações, erros de digitação e de reconhecimento de voz. Respeitam as permissões de quem pergunta. A Max **consulta e abre telas; ela não altera dados** (entradas, baixas e cadastros continuam sendo feitos por você).
2. Se nenhuma servir: **clima** (Open-Meteo), **câmbio** (AwesomeAPI/Frankfurter) e **Wikipédia**, todos gratuitos e sem chave.
3. **IA opcional** (abaixo), para entender qualquer frase.

**Voz:** usa o reconhecimento e a fala do próprio navegador. Funciona no Chrome, Edge e Safari; no Firefox, só digitando. No Chrome o áudio captado é processado pelos servidores do Google (é assim que o reconhecimento do navegador funciona). Por regra dos navegadores, a Max só consegue **falar** depois do primeiro clique na página.

### IA opcional da Max

Sem ela, frases muito fora do previsto recebem “ainda não sei responder isso”. Com ela, a Max entende pedidos livres (“como tá a saída de bota esse mês?”) e responde perguntas gerais.

Funciona com qualquer serviço compatível com a API *chat/completions* da OpenAI. Há serviços com plano gratuito e sem cartão (por exemplo a **Groq**; os limites são por minuto e por dia e mudam com o tempo). Na Vercel, cadastre:

| Key | Value |
|---|---|
| `MAX_LLM_API_KEY` | a chave criada no serviço |
| `MAX_LLM_BASE_URL` | ex.: `https://api.groq.com/openai/v1` |
| `MAX_LLM_MODEL` | o nome de um modelo, copiado da página de modelos do serviço |

Só a **frase dita** é enviada à IA. Saldos, nomes e números do sistema nunca saem: quando o pedido depende de dados, a IA apenas “traduz” a frase para um comando que a Max executa localmente.

---

## Criar a ferramenta de um setor

Os setores ficam em `lib/sectors.ts`. A tela padrão é `components/setores/SectorShell.tsx`.

- **Novo setor:** acrescente uma entrada em `lib/sectors.ts`. Ele ganha sozinho a página `/setor/<slug>`, o cartão no painel master, a aba Equipe e a Max.
- **Funções de um setor:** declare os `modules` (viram linhas no editor de permissões), crie as telas em `components/<setor>/` e as rotas em `app/api/<setor>/`, protegendo cada rota com `requireModule('<setor>', '<módulo>', 'view' | 'edit')` de `lib/access.ts`. O almoxarifado é o exemplo completo.
- **Ensinar a Max:** acrescente habilidades em `lib/max/` (veja `skills-almox.ts`) e as frases de teste em `tests/max-nlu.test.ts`.

---

## Colocar no ar do zero

Você vai precisar de 3 contas gratuitas: **GitHub**, **Supabase** e **Vercel**.

1. **Supabase:** crie o projeto (região *South America (São Paulo)*) e, no **SQL Editor**, rode nesta ordem: `supabase/schema.sql`, `supabase/estoque.sql`, `supabase/seed_estoque.sql` (opcional, carga inicial), `supabase/baixa_e_usuarios.sql` e `supabase/maxhub.sql`. Em **Project Settings → Realtime**, deixe **Allow public access** ligado.
2. **GitHub:** crie um repositório **privado** e envie o conteúdo deste projeto.
3. **Vercel:** importe o repositório e cadastre as variáveis do arquivo `.env.example` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`). Clique em **Deploy**.
4. Os usuários iniciais são `master` (senha `berrythedev45`), `neilton` e `juliana` (senha `123456`). Entre com `master`, troque as senhas e ajuste os acessos no painel master.

> Mudou alguma variável? Altere em **Settings → Environment Variables** e faça **Redeploy**.

---

## Almoxarifado: como funciona

**Formulário**
- Todos os campos são obrigatórios, menos fotos e vídeos. Isso pode ser mudado no editor.
- O e-mail executivo é conferido no servidor. Quem não está na lista recebe o aviso no próprio campo e não consegue enviar, nem anexar arquivos.
- Fotos e vídeos vão direto para um bucket **privado** do Supabase, com barra de progresso. O limite é de até 10 arquivos de 50 MB cada.
- Ao enviar, o supervisor recebe um **número de solicitação** (ex.: `#0012`).
- O e-mail fica lembrado naquele aparelho para o próximo pedido.

**Painel**
- **Solicitações:** lista no estilo de conversa, dividida em **Novas**, **Pendentes** e **Resolvidas**, com busca por nome, posto, número ou qualquer resposta.
  - Ao abrir uma solicitação aparecem as respostas, as fotos e vídeos (clique para ampliar) e o e-mail do supervisor, com os botões **Copiar** e **Responder** (abre o e-mail já com o assunto preenchido).
  - O painel registra quem marcou como pendente ou resolvida.
- **Formulário:** adicionar, remover (com *Desfazer*), renomear, reordenar (arrastando pela alça ou com as setas), mudar o tipo de resposta, o texto de ajuda, as opções e se é obrigatória.
  - Os campos *e-mail executivo, colaborador, posto e anexos* são fixos: podem ser renomeados, mas não removidos.
  - **Restaurar padrão** volta à versão original.
  - Quem estiver com o formulário aberto vê a nova versão na hora, sem perder o que já digitou.
- **E-mails autorizados:** cadastro de um ou vários e-mails, com nome do supervisor e posto (opcionais). Remover pede confirmação.
- **Minha conta:** trocar nome, usuário de login e senha. Trocar usuário ou senha pede a senha atual.

**Tempo real**
- Quando chega um pedido, o painel toca um som suave, mostra um aviso e atualiza o contador, inclusive no título da aba: `(3) Painel`.
- Se a Juliana muda o status de um pedido, o Neilton vê na hora, e vice-versa.
- Como garantia extra, o painel também se atualiza sozinho a cada 12 segundos e sempre que a aba volta a ficar visível.

**Saudação por voz**
- Depois do login, o site diz "Bom dia", "Boa tarde" ou "Boa noite" seguido do nome, conforme o horário de Salvador/BA:
  - Bom dia: das 5h às 11h59.
  - Boa tarde: das 12h às 17h59.
  - Boa noite: das 18h às 4h59.
- O código procura a voz mais natural de cada navegador:
  - Edge: *Francisca/Thalita (Natural)* — são as melhores.
  - Chrome: *Google português do Brasil*.
  - Safari, iPhone e Mac: vozes *Aprimoradas* ou *Premium*, se estiverem instaladas.
- Dica para o iPhone/Mac ficar ainda mais natural: **Ajustes → Acessibilidade → Conteúdo Falado → Vozes → Português (Brasil)** e baixe uma voz *Aprimorada*.
- A voz sai com o volume do aparelho. Se o celular estiver no silencioso, ela não toca.

**Segurança**
- As tabelas do banco não podem ser lidas pela chave pública (RLS ligado, sem políticas). Tudo passa pelas rotas do servidor.
- As senhas são guardadas com *bcrypt*.
- O login usa um cookie *HttpOnly* assinado, válido por 7 dias.
- Os anexos ficam num bucket privado e só abrem por links temporários, gerados para quem está logado.

---

## Estoque e Postos

**Atualizando um site que já está no ar:** no Supabase, abra o **SQL Editor** e rode, nesta ordem, `supabase/estoque.sql` e `supabase/seed_estoque.sql` (cada um pode ser rodado de novo sem duplicar nada). Depois suba os arquivos novos no GitHub: a Vercel publica sozinha. Não há variáveis novas.

**Estoque** (`/setor/almoxarifado#estoque`)
- Cada item tem **saldo no almoxarifado**, quanto está **nos postos**, estoque mínimo, custo e tamanho. O total é a soma dos dois.
- Toque em um item para: **Enviar a posto**, registrar **Entrada**, **Saída** ou **Ajustar saldo** (contagem de inventário), editar os dados, excluir, e ver onde ele está e o histórico dele.
- **Novo item** cadastra um produto. **Transferir** envia vários itens de uma vez para um posto (tudo ou nada: se um item não tiver saldo, nada sai).
- Cartões de resumo (itens, unidades, valor), busca sem acento, filtros (**Estoque baixo**, **Sem saldo**, **Nos postos**) e ordenação.
- Item com saldo igual ou menor que o **estoque mínimo** ganha um aviso, e o menu mostra quantos estão assim.
- **Histórico:** toda movimentação fica registrada (quem fez, quando, saldo depois).
- **Exportar** baixa um `.csv` que abre direto no Excel. **Importar planilha** cadastra só os itens novos (mesmo nome + tamanho = já existe e não é mexido).

**Postos** (`/setor/almoxarifado#postos`)
- Lista de postos com o que cada um tem. Toque em um posto para ver o estoque dele, **devolver** ao almoxarifado, dar **baixa** (consumido no posto), **enviar itens**, editar ou **remover**. Ao remover um posto, o que estava nele volta para o almoxarifado.
- **Novo posto:** um só (com código, cidade, endereço, supervisor) ou vários de uma vez, um nome por linha.
- **Importar planilha:** aceita `.xlsx` e `.csv`. O leitor acha sozinho a tabela e as colunas, mesmo com título, linhas vazias, células mescladas, totais, abas extras ou sem cabeçalho. Mostra uma **pré-visualização** antes de gravar. Postos que **já existem nunca são substituídos**: só os novos entram. Excel antigo (`.xls`) precisa ser salvo como `.xlsx`. Limite de 4 MB por arquivo.
- Se a lista de postos do **formulário de solicitações** for diferente da daqui, aparece um aviso com o botão **Atualizar formulário**.

**Observações sobre a planilha original (`Livro1.xlsx`):** as colunas ENTRADA, SAÍDA, SALDO e REF dependiam de outra planilha (links externos) e vinham com erro. A carga inicial usa a coluna **QUANT** como saldo atual. Dois pares de linhas repetidas (mesmo nome e tamanho) foram unidos.

---

## Responder com baixa automática

**Atualizando um site que já está no ar:** no Supabase, abra o **SQL Editor** e rode `supabase/baixa_e_usuarios.sql` (depois do `estoque.sql`; pode rodar mais de uma vez). Depois suba os arquivos no GitHub. Não há variáveis novas.

**Responder (detalhe da solicitação → botão Responder)**
- A ferramenta não consegue ler a caixa de e-mail de fora. Por isso o texto é escrito (ou colado) **dentro da própria janela do Responder**, e ela lê o que você escreveu.
- Enquanto você escreve, aparecem à direita os **itens encontrados** com a quantidade, o saldo e um aviso do que merece atenção. Entende abreviações (`m/c`), erros de digitação, plural, tamanho (`tam 42`, `(G)`), quantidade antes ou depois do item (`2 un`, `x2`) e vários itens na mesma frase.
- **Só vem marcado o que o texto diz que foi enviado e que a ferramenta identificou com certeza.** Itens com dúvida (nome parecido com mais de um, sem quantidade, tamanho faltando, “não temos”, “amanhã enviaremos”, devolução/troca, perguntas) aparecem **desmarcados** para você conferir, trocar o item ou ajustar a quantidade.
- Escolha entre **Transferir para um posto** (sai do almoxarifado e entra no estoque do posto; o posto do pedido já vem escolhido se estiver cadastrado) ou **Só dar baixa**.
- **Revisar baixa** mostra o resumo (saldo antes e depois) antes de gravar. Depois: **Só dar baixa** ou **Dar baixa e abrir e-mail**. Também há **Copiar texto** e **E-mail sem baixa**.
- Tudo ou nada: se algum item não tiver saldo, nada é baixado. Clicar duas vezes ou perder a internet **nunca baixa em duplicidade**. Se já existe baixa na solicitação, a janela avisa e pede sua confirmação para registrar outra.
- Em **Baixas de estoque** (no detalhe da solicitação) fica o registro de cada baixa, com o botão **Estornar** (devolve ao almoxarifado, uma única vez). Tudo aparece também no histórico do Estoque.

---

## Métricas (`/setor/almoxarifado#metricas`)

Não precisa rodar nenhum SQL novo nem criar variável: usa o histórico do estoque e as solicitações que já existem.

- Botões de período: **Último dia** (últimas 24 horas), **Hoje** (desde a meia-noite), **Última semana** (7 dias) e **Último mês** (30 dias). O gráfico e os números trocam na hora, com atualização automática a cada minuto e quando o estoque muda.
- O gráfico mostra **entradas** e **saídas** em unidades. Passe o mouse (ou o dedo) para ver cada hora/dia, com o total de movimentações e solicitações.
- **Baixar gráfico** gera uma imagem **PNG** (2560×1720, abre no Power BI, PowerPoint, WhatsApp etc.) do **período que está na tela**. **Baixar planilha** gera um `.xlsx` do **mesmo período e do mesmo instante** que a tela mostra, então os números sempre batem.
- A planilha tem as abas **Resumo**, **Linha do tempo**, **Itens**, **Postos**, **Movimentações** e **Solicitações**. Nas abas de dados o cabeçalho fica na primeira linha e não há linhas de total, para filtrar no Excel ou importar no Power BI sem ajuste.
- **Como contamos:** *Entradas* = entrada + devolução de posto. *Saídas* = saída + transferência a posto. Ajuste de inventário, consumo no posto e criação/exclusão de item aparecem só nos detalhes (assim importar uma planilha de itens não vira "milhares de entradas"). Horário da Bahia (UTC−3).
- Limites: lê até 50 mil movimentações e 20 mil solicitações por período; se passar disso, a tela e a planilha avisam.

---

## Rodar no seu computador (opcional)

Precisa do Node.js 20 ou mais novo.

```bash
npm install
cp .env.example .env.local   # e preencha com as chaves do Supabase
npm run dev                  # abre em http://localhost:3000
npm run typecheck            # confere os tipos
npm test                     # frases da Max + clima/câmbio/Wikipédia/IA simulados
```

Teste completo no navegador, sem tocar no banco de verdade (usa um Supabase de mentira em memória; usuários `mateus`, `neilton`, `juliana`, `carla`, `pedro`, senha `123456`):

```bash
npm run build
node tests/mock-supabase.mjs 54321 &
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=anon \
SUPABASE_SERVICE_ROLE_KEY=eyJteste SESSION_SECRET=uma-frase-longa-so-para-o-teste-local \
npx next start -p 3100 &
npm i --no-save playwright && npx playwright install chromium
node tests/e2e.mjs
```

## Estrutura

```
app/
  page.tsx                 login global (endereço principal)
  hub/                     painel master
  setor/[slug]/            ferramenta de cada setor
  sem-setor/               aviso para quem ainda não foi alocado
  solicitacao/             formulário dos supervisores (público)
  api/
    auth/  account/        login, sessão e "Minha conta"
    hub/users/             cadastro de usuários (master geral)
    setor/[slug]/equipe/   permissões da equipe (master do setor)
    max/ask/               segunda camada da Max (clima, câmbio, IA, Wikipédia)
    almoxarifado/          rotas do almoxarifado (com permissão por módulo)
    form/ requests/ upload-url/   rotas públicas do formulário
components/
  core/                    moldura, marca, conta, equipe, permissões, janelas
  login/                   tela de entrada
  hub/                     painel master
  setores/                 tela padrão de setor e aviso "sem setor"
  max/                     esfera 3D e assistente
  almoxarifado/            todas as telas do almoxarifado
lib/
  sectors.ts               lista de setores e módulos
  permissions.ts           regras de acesso (iguais no navegador e no servidor)
  auth.ts  access.ts       sessão e conferências das rotas
  max/                     cérebro da Max (texto, habilidades, voz, escuta)
  almoxarifado/            regras do almoxarifado
supabase/
  maxhub.sql               login global, setores e permissões  ← novo
  schema.sql  estoque.sql  seed_estoque.sql  baixa_e_usuarios.sql
tests/                     testes da Max, banco de mentira e teste no navegador
middleware.ts              barra quem não está logado
```

## Problemas comuns

| Sintoma | Solução |
|---|---|
| Formulário de solicitação mostra "Não foi possível abrir o formulário" | Confira as 4 variáveis na Vercel e faça **Redeploy**. Confira também se o `schema.sql` foi rodado. |
| Login diz "Não foi possível concluir agora" | A chave secreta (`SUPABASE_SERVICE_ROLE_KEY`) está errada ou faltando. |
| Erro "permission denied for table" nos logs da Vercel | Rode o `schema.sql` de novo: ele libera as tabelas para o servidor. |
| Anexo não envia | Confira se a chave pública está certa. Arquivos acima de 50 MB são recusados. |
| As coisas não aparecem na hora, só depois de alguns segundos | O tempo real está desligado: ligue **Allow public access** em *Project Settings → Realtime*. Mesmo assim, o painel se atualiza sozinho a cada 12 s. |
| A voz não fala | Verifique o volume e o modo silencioso. Alguns navegadores (ex.: Firefox no Linux) não têm voz em português instalada. |
| "Falta rodar o arquivo baixa_e_usuarios.sql" ao dar baixa | Rode `supabase/baixa_e_usuarios.sql` no SQL Editor. |
| Estoque ou Postos mostram "Não foi possível carregar" | Rode `supabase/estoque.sql` no SQL Editor e recarregue a página. |
| Alguém esqueceu a senha | O master geral abre **Painel master → Usuários**, clica na pessoa e define uma **Nova senha**. |
| O master geral esqueceu a senha | No Supabase, em **SQL Editor**, rode: `update admins set password_hash = '$2b$10$c3tnk4UPkHj9.kv9pl7KsuDlaHAWcXU2EzcaZSKcTtwSADSM2pAIW' where username = 'mateus';`. A senha volta a ser `123456`; troque em seguida. |
| "Falta rodar o arquivo supabase/maxhub.sql" | Rode `supabase/maxhub.sql` no SQL Editor (passo 1 da atualização). |
| Entrei e caí em "Quase lá" | O usuário não tem setor. O master geral aloca em **Usuários**. |
| Ninguém é master geral | No SQL Editor: `update admins set is_master = true, sector = null where username = 'seu_usuario';` |
| A Max não ouve | Use Chrome, Edge ou Safari e permita o microfone (cadeado da barra de endereço). No Firefox ela funciona digitando. |
| A Max ouve mas não fala na tela de login | O navegador só libera voz depois de um clique na página. Clique em qualquer lugar. |
| A Max responde "ainda não sei" a perguntas gerais | Sem a IA opcional ela usa só Wikipédia, clima e câmbio. Veja *IA opcional da Max*. |
