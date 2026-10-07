# Almoxarifado · Central de Solicitações

Site para organizar os pedidos de fardamento, calçados e EPIs que chegam ao almoxarifado.

| Endereço | Para quem | O que faz |
|---|---|---|
| `/solicitacao` | Supervisores dos postos | Formulário de pedido (só e-mails autorizados conseguem enviar) |
| `/login` | Neilton e Juliana | Entrada no painel, com saudação por voz |
| `/dashboard` | Neilton e Juliana | Solicitações, **estoque**, **postos**, editor do formulário, e-mails autorizados e conta |

**Usuários iniciais:** `neilton` e `juliana`. A senha dos dois é `123456`. Troquem a senha no primeiro acesso, em **Minha conta**.

**Tecnologia:** Next.js 15 (React + TypeScript), hospedado na **Vercel**. Banco de dados, arquivos e tempo real ficam no **Supabase**.

---

## Passo a passo para colocar no ar

Você vai precisar de 3 contas gratuitas: **GitHub**, **Supabase** e **Vercel**. Leva uns 20 minutos.

### 1. Criar o banco no Supabase

1. Acesse https://supabase.com e entre (pode usar a conta do GitHub).
2. Clique em **New project**.
   - **Name:** `almoxarifado` (ou o nome que preferir).
   - **Database Password:** clique em *Generate a password* e guarde num lugar seguro.
   - **Region:** escolha **South America (São Paulo)**.
   - Se aparecerem as opções **Enable Data API** e **Enable automatic RLS**, deixe as duas **ligadas**.
   - Clique em **Create new project** e espere 1 a 2 minutos.
3. No menu da esquerda, abra **SQL Editor** e clique em **New query**.
4. Abra o arquivo `supabase/schema.sql` deste projeto, copie **todo** o conteúdo, cole no editor e clique em **Run**.
   - O resultado esperado é *Success. No rows returned*.
   - Esse script cria as tabelas, os dois usuários e o bucket privado `anexos` para fotos e vídeos.
   - Para o **Estoque** e os **Postos**, rode também `supabase/estoque.sql` (tabelas e funções) e, depois, `supabase/seed_estoque.sql` (carga inicial com os itens da planilha). Veja a seção *Estoque e Postos* abaixo.
   - Pode rodar de novo sem problema: ele não duplica nada.
5. Confira se deu certo: abra **Table Editor**. Devem aparecer as tabelas `admins`, `authorized_emails`, `form_config` e `requests`. Na tabela `admins` devem estar Neilton e Juliana.
6. Agora pegue as chaves. Vá em **Project Settings** (ícone de engrenagem):
   - Em **Data API** (ou **API**), copie a **Project URL** (algo como `https://abcdxyz.supabase.co`).
   - Em **API Keys**, copie:
     - a chave **pública**: `anon` *ou* `publishable` (começa com `eyJ...` ou `sb_publishable_...`);
     - a chave **secreta**: `service_role` *ou* `secret` (começa com `eyJ...` ou `sb_secret_...`). Clique em *Reveal* para ver.
   - ⚠️ **A chave secreta nunca pode ser compartilhada nem colocada no código.** Ela vai só nas variáveis da Vercel (passo 3).
7. Confira o tempo real: em **Project Settings → Realtime**, a opção **"Allow public access"** deve estar **ligada**. Ela vem ligada por padrão.
   - Isso só permite receber avisos do tipo "algo mudou". Nenhum dado é enviado por esse canal.

### 2. Subir o código para o GitHub

1. Acesse https://github.com e clique em **New repository**.
   - Nome: `almoxarifado`.
   - Marque **Private**.
   - Clique em **Create repository**.
2. Na página do repositório recém-criado, clique em **uploading an existing file**.
3. Descompacte o zip no seu computador e **arraste todo o conteúdo da pasta** para a página (as pastas `app`, `components`, `lib`, `public`, `supabase` e os arquivos soltos).
   - O arquivo `.gitignore` às vezes fica escondido. Tudo bem se ele não for.
4. Clique em **Commit changes**.

> Se você usa Git no terminal: `git init && git add . && git commit -m "primeira versão"`, depois siga as instruções do GitHub para o `git push`.

### 3. Publicar na Vercel

1. Acesse https://vercel.com e entre com o GitHub.
2. Clique em **Add New… → Project** e escolha o repositório `almoxarifado` (clique em **Import**).
3. A Vercel reconhece sozinha que é **Next.js**. Não mude nada em *Build settings*.
4. Abra **Environment Variables** e cadastre as 4 variáveis abaixo. Para cada uma, cole o nome em *Key* e o valor em *Value*:

   | Key | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | a Project URL do Supabase |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | a chave pública (`anon` / `publishable`) |
   | `SUPABASE_SERVICE_ROLE_KEY` | a chave secreta (`service_role` / `secret`) |
   | `SESSION_SECRET` | uma frase longa e aleatória, com 40 caracteres ou mais |

   Para criar o `SESSION_SECRET`, você pode digitar uma frase qualquer bem longa, por exemplo: `almox-salvador-2026-troque-isso-por-algo-so-seu-9f8e7d`.

5. Clique em **Deploy** e espere de 1 a 3 minutos.
6. Pronto! A Vercel mostra o endereço do site, algo como `https://almoxarifado-xyz.vercel.app`:
   - Supervisores: `https://almoxarifado-xyz.vercel.app/solicitacao`
   - Equipe: `https://almoxarifado-xyz.vercel.app/login`

> **Mudou alguma variável depois?** Em **Settings → Environment Variables**, altere o valor e depois vá em **Deployments → ⋯ → Redeploy**. As variáveis que começam com `NEXT_PUBLIC_` só passam a valer depois de um novo deploy.

> **Quer um endereço mais bonito?** Em **Settings → Domains** você pode trocar o nome (ex.: `almox-salvador.vercel.app`) ou ligar um domínio próprio.

### 4. Primeiro uso

1. Entre em `/login` com `neilton` e senha `123456`.
2. Em **Minha conta**, troque a senha. A Juliana faz o mesmo no login dela.
3. Em **Formulário**, abra a pergunta **Posto** e troque `Posto 01`, `Posto 02`… pelos nomes reais dos postos. Clique em **Salvar formulário**.
4. Em **E-mails autorizados**, cadastre os e-mails executivos dos supervisores. Dá para colar vários de uma vez, um por linha.
5. Mande o link `/solicitacao` para os supervisores.

---

## Como funciona

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

**Estoque** (`/dashboard#estoque`)
- Cada item tem **saldo no almoxarifado**, quanto está **nos postos**, estoque mínimo, custo e tamanho. O total é a soma dos dois.
- Toque em um item para: **Enviar a posto**, registrar **Entrada**, **Saída** ou **Ajustar saldo** (contagem de inventário), editar os dados, excluir, e ver onde ele está e o histórico dele.
- **Novo item** cadastra um produto. **Transferir** envia vários itens de uma vez para um posto (tudo ou nada: se um item não tiver saldo, nada sai).
- Cartões de resumo (itens, unidades, valor), busca sem acento, filtros (**Estoque baixo**, **Sem saldo**, **Nos postos**) e ordenação.
- Item com saldo igual ou menor que o **estoque mínimo** ganha um aviso, e o menu mostra quantos estão assim.
- **Histórico:** toda movimentação fica registrada (quem fez, quando, saldo depois).
- **Exportar** baixa um `.csv` que abre direto no Excel. **Importar planilha** cadastra só os itens novos (mesmo nome + tamanho = já existe e não é mexido).

**Postos** (`/dashboard#postos`)
- Lista de postos com o que cada um tem. Toque em um posto para ver o estoque dele, **devolver** ao almoxarifado, dar **baixa** (consumido no posto), **enviar itens**, editar ou **remover**. Ao remover um posto, o que estava nele volta para o almoxarifado.
- **Novo posto:** um só (com código, cidade, endereço, supervisor) ou vários de uma vez, um nome por linha.
- **Importar planilha:** aceita `.xlsx` e `.csv`. O leitor acha sozinho a tabela e as colunas, mesmo com título, linhas vazias, células mescladas, totais, abas extras ou sem cabeçalho. Mostra uma **pré-visualização** antes de gravar. Postos que **já existem nunca são substituídos**: só os novos entram. Excel antigo (`.xls`) precisa ser salvo como `.xlsx`. Limite de 4 MB por arquivo.
- Se a lista de postos do **formulário de solicitações** for diferente da daqui, aparece um aviso com o botão **Atualizar formulário**.

**Observações sobre a planilha original (`Livro1.xlsx`):** as colunas ENTRADA, SAÍDA, SALDO e REF dependiam de outra planilha (links externos) e vinham com erro. A carga inicial usa a coluna **QUANT** como saldo atual. Dois pares de linhas repetidas (mesmo nome e tamanho) foram unidos.

---

## Responder com baixa automática e usuário master

**Atualizando um site que já está no ar:** no Supabase, abra o **SQL Editor** e rode `supabase/baixa_e_usuarios.sql` (depois do `estoque.sql`; pode rodar mais de uma vez). Depois suba os arquivos no GitHub. Não há variáveis novas.

**Responder (detalhe da solicitação → botão Responder)**
- A ferramenta não consegue ler a caixa de e-mail de fora. Por isso o texto é escrito (ou colado) **dentro da própria janela do Responder**, e ela lê o que você escreveu.
- Enquanto você escreve, aparecem à direita os **itens encontrados** com a quantidade, o saldo e um aviso do que merece atenção. Entende abreviações (`m/c`), erros de digitação, plural, tamanho (`tam 42`, `(G)`), quantidade antes ou depois do item (`2 un`, `x2`) e vários itens na mesma frase.
- **Só vem marcado o que o texto diz que foi enviado e que a ferramenta identificou com certeza.** Itens com dúvida (nome parecido com mais de um, sem quantidade, tamanho faltando, “não temos”, “amanhã enviaremos”, devolução/troca, perguntas) aparecem **desmarcados** para você conferir, trocar o item ou ajustar a quantidade.
- Escolha entre **Transferir para um posto** (sai do almoxarifado e entra no estoque do posto; o posto do pedido já vem escolhido se estiver cadastrado) ou **Só dar baixa**.
- **Revisar baixa** mostra o resumo (saldo antes e depois) antes de gravar. Depois: **Só dar baixa** ou **Dar baixa e abrir e-mail**. Também há **Copiar texto** e **E-mail sem baixa**.
- Tudo ou nada: se algum item não tiver saldo, nada é baixado. Clicar duas vezes ou perder a internet **nunca baixa em duplicidade**. Se já existe baixa na solicitação, a janela avisa e pede sua confirmação para registrar outra.
- Em **Baixas de estoque** (no detalhe da solicitação) fica o registro de cada baixa, com o botão **Estornar** (devolve ao almoxarifado, uma única vez). Tudo aparece também no histórico do Estoque.

**Usuário master e usuários do painel** (`/dashboard#usuarios`, só para o master)
- Usuário: `master` · senha inicial: `berrythedev45`. **Troque essa senha** assim que entrar (aba Usuários → Trocar senha, ou Minha conta).
- O master **cria usuários** (nome, usuário de login, senha) e **troca a senha de qualquer um, inclusive a dele**. As demais pessoas não veem essa aba.
- Quem já estava logado continua logado após uma troca de senha; vale no próximo login. Não há exclusão de usuários.

---

## Métricas (`/dashboard#metricas`)

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
```

## Estrutura

```
app/
  solicitacao/        página do formulário
  login/              página de login
  dashboard/          painel
  api/                rotas do servidor (formulário, login, painel, estoque, postos)
components/           telas e peças visuais
  dashboard/          caixa de entrada, editor, e-mails, conta, estoque, postos
lib/                  regras (validação, sessão, voz, tempo real, banco)
middleware.ts         protege /dashboard
supabase/schema.sql   script do banco
supabase/estoque.sql  tabelas e funções do estoque e dos postos
supabase/seed_estoque.sql  carga inicial do estoque (planilha)
supabase/baixa_e_usuarios.sql  baixa pelo Responder e usuário master
```

## Problemas comuns

| Sintoma | Solução |
|---|---|
| Formulário mostra "Não foi possível abrir o formulário" | Confira as 4 variáveis na Vercel e faça **Redeploy**. Confira também se o `schema.sql` foi rodado. |
| Login diz "Não foi possível concluir agora" | A chave secreta (`SUPABASE_SERVICE_ROLE_KEY`) está errada ou faltando. |
| Erro "permission denied for table" nos logs da Vercel | Rode o `schema.sql` de novo: ele libera as tabelas para o servidor. |
| Anexo não envia | Confira se a chave pública está certa. Arquivos acima de 50 MB são recusados. |
| As coisas não aparecem na hora, só depois de alguns segundos | O tempo real está desligado: ligue **Allow public access** em *Project Settings → Realtime*. Mesmo assim, o painel se atualiza sozinho a cada 12 s. |
| A voz não fala | Verifique o volume e o modo silencioso. Alguns navegadores (ex.: Firefox no Linux) não têm voz em português instalada. |
| "Falta rodar o arquivo baixa_e_usuarios.sql" ao dar baixa | Rode `supabase/baixa_e_usuarios.sql` no SQL Editor. |
| Estoque ou Postos mostram "Não foi possível carregar" | Rode `supabase/estoque.sql` no SQL Editor e recarregue a página. |
| Esqueceram a senha | No Supabase, em **SQL Editor**, rode: `update admins set password_hash = '$2b$10$c3tnk4UPkHj9.kv9pl7KsuDlaHAWcXU2EzcaZSKcTtwSADSM2pAIW' where username = 'neilton';`. A senha volta a ser `123456`. |
