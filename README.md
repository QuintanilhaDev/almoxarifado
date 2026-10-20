# Max Hub

Plataforma interna que reúne os setores da empresa em um só lugar, com login único, permissões por pessoa e a **Max**, assistente virtual por voz.

| Endereço | Para quem | O que faz |
|---|---|---|
| `/` | Todos | **Login global.** Cada pessoa cai direto na ferramenta do seu setor. A Max fica em escuta constante aqui. |
| `/hub` | Master geral | Painel master: setores, usuários, alocação e permissões |
| `/setor/almoxarifado` | Equipe do almoxarifado | Solicitações, estoque, postos, métricas, formulário, e-mails |
| `/setor/rh` · `/setor/operacional` · `/setor/financeiro` · `/setor/comercial` · `/setor/compras` | Equipe de cada setor | Tela padrão, ainda sem funções (com Equipe, Minha conta e a Max) |
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

### Cerca de localização (só dentro do terreno da empresa)

A cerca vale **só para o usuário @uesley**. Os outros usuários, os que já existem e os que forem criados, entram de qualquer lugar e nem são perguntados pela localização.

O Max Hub acompanha a localização do @uesley o tempo inteiro. Fora do terreno da empresa, a tela trava e o servidor recusa qualquer ação, mesmo que a chamada seja feita diretamente. Quando a pessoa volta, a tela libera sozinha. Também trava quando ele não permite a localização ou quando o aparelho não consegue dizer com precisão onde está.

- O **master geral** entra de qualquer lugar.
- Para pôr ou tirar alguém da cerca, use a variável `GEO_USERS` (veja a tabela).
- O **formulário público** de solicitação e a tela de login continuam abertos.
- Para ajustar, cadastre estas variáveis na Vercel (opcionais) e faça um novo deploy:

| Variável | Padrão | Para que serve |
|---|---|---|
| `GEO_LAT` / `GEO_LNG` | `-12.986892099250628` / `-38.489956547863` | O centro do terreno |
| `GEO_RADIUS_M` | `150` | O raio liberado, em metros |
| `GEO_MAX_ACCURACY_M` | `200` | A partir desta imprecisão (em metros), a localização não é aceita |
| `GEO_USERS` | `uesley` | Usuários com cerca, separados por vírgula (ex.: `uesley,joao`) |
| `GEO_FENCE` | ligada | `off` desliga a cerca |

Computadores sem Wi-Fi nem GPS costumam dar uma localização imprecisa. Nesse caso, ligue o Wi-Fi do computador.

### Auditoria (Painel master › Auditoria)

A Auditoria mostra, ao vivo e sem precisar atualizar a página, tudo o que cada usuário faz:

- entradas no sistema e saídas, incluindo as tentativas com a senha errada;
- as telas e abas abertas;
- cada alteração feita, com o resultado (deu certo ou deu erro);
- os pedidos feitos à Max;
- as entradas e saídas da área da empresa.

Dá para filtrar por pessoa e por tipo, buscar e pausar a lista. Por enquanto, os registros ficam **só na memória do servidor**, não no banco, e zeram a cada novo deploy. As senhas nunca são registradas.

### Modo claro e modo escuro

O botão de sol/lua fica no rodapé do menu (no celular, no topo da tela) e também na tela de login. A troca é uma onda em 3D que nasce no canto inferior direito da tela e dura 4 segundos. A escolha fica lembrada naquele navegador.

---

## Max, a assistente virtual

**Na tela de login** ela fica acima do formulário, em **escuta constante**. Diga “Max, apresente-se”, “Max, bom dia” (ela responde conforme o horário de Salvador) ou “Max, que horas são?”. O botão **Escuta ligada** desliga o microfone, e a escolha fica lembrada naquele navegador. Antes do login ela só responde o que não depende de dados da empresa.

Ela também cumprimenta pelo nome: “Max, diga olá para Fernanda” → “Bom dia, Fernanda! Tudo tranquilo?”. Com mais de um nome, ela diz os dois primeiros e completa com “e a todos que estão presentes!”.

**Ela tem um rostinho.** Os olhos (com cílios) acompanham o mouse quando ele passa perto, ela sorri e cora; pisca sozinha e, de vez em quando, faz caras e bocas. Quando fala, a boca se mexe no ritmo da fala; ouvindo, fica verde e atenta; pensando, olha para cima. Quem ativou "reduzir movimento" no sistema vê só o piscar e a fala. O rosto fica em `components/max/MaxFace.tsx`.

**Dentro de cada ferramenta** ela é a esfera no canto inferior direito. Clique nela, espere ficar **verde** e fale “Max, …”. Também dá para digitar (botão **Digitar**), usar **Alt+M** e fechar com **Esc**. O ícone de alto-falante liga e desliga a voz.

Alguns pedidos:

| Onde | Exemplos |
|---|---|
| Qualquer tela | “Max, que dia é hoje?” · “Max, quanto é 15% de 2400?” · “Max, abrir minha conta” · “Max, modo silencioso” · “Max, sair” |
| Almoxarifado | “Max, desejo ver as métricas da última semana” · “Max, quantos itens saíram nas últimas 15 horas?” · “Max, o que entrou no estoque ontem?” · “Max, quantas botas saíram esta semana?” · “Max, tem solicitação nova?” · “Max, abrir a solicitação 12” · “Max, quanto tem de bota 42?” · “Max, o que está com estoque baixo?” · “Max, o que tem no Posto 01?” · “Max, copiar o link do formulário” |
| Baixar métricas | “Max, desejo baixar as métricas do almoxarifado” (gráfico .png) · “Max, baixe a planilha das métricas do último mês” (.xlsx) · períodos: hoje, último dia, última semana (padrão) e último mês |
| Painel master | “Max, quantos usuários temos?” · “Max, quem está no almoxarifado?” · “Max, em que setor está a Juliana?” · “Max, novo usuário chamado Rita Lopes no financeiro” · “Max, abrir o setor financeiro” |
| Com internet | “Max, como está o tempo?” · “Max, qual a cotação do dólar?” · “Max, quem foi Santos Dumont?” |

**Como ela pensa (tudo sem custo):**

1. **Habilidades locais**, no próprio navegador: entendem variações, erros de digitação e de reconhecimento de voz. Respeitam as permissões de quem pergunta. Sem a IA, a Max consulta e abre telas; com a IA ligada ela também **altera dados, sempre pedindo confirmação** (veja *A Max como agente*).
2. Se nenhuma servir: **clima** (Open-Meteo), **câmbio** (AwesomeAPI/Frankfurter) e **Wikipédia**, todos gratuitos e sem chave.
3. **IA opcional** (abaixo), para entender qualquer frase. Com ela ligada, frases longas em que a habilidade local não tem tanta certeza passam por uma **segunda opinião** da IA, que confere qual comando a pessoa quis antes de a Max responder.

**Voz:** usa o reconhecimento e a fala do próprio navegador. Funciona no Chrome, Edge e Safari; no Firefox, só digitando. No Chrome o áudio captado é processado pelos servidores do Google (é assim que o reconhecimento do navegador funciona). Por regra dos navegadores, a Max só consegue **falar** depois do primeiro clique na página.

### Comandos que a própria Max faz (sem depender da IA)

Ela entende o pedido do jeito que a pessoa falar ou escrever: procura o verbo (em qualquer forma), a quantidade (em número ou por extenso), o item com o tamanho, o posto, a pessoa, o setor, o e-mail… em qualquer ordem e com tolerância a erros de digitação e de voz. Se faltar algo, ela pergunta, e a resposta curta completa o pedido ("Quantas unidades?" → "dez"). **Toda alteração pede um "sim"** antes de gravar.

| Área | Exemplos (são só exemplos: outras formas de dizer também valem) |
|---|---|
| Estoque | "chegaram dez botas 42" · "dar baixa em 2 coletes" · "o saldo da bota 42 é 15" · "manda 3 camisas G pro Posto 01" · "voltaram 3 bonés do Shopping Barra" · "cadastrar o item lanterna tática com 7 unidades" · "o mínimo da bota 42 é 8" · "coloca o boné na categoria EPI" |
| Solicitações e postos | "marca a 12 como resolvida" · "deixa a 3 pendente" · "novo posto Hospital Central em Salvador" · "remover o posto X" · "autorizar o e-mail joao@empresa.com" |
| Compras | "pedir compra de 20 botas 42, urgente" · "a compra 2 chegou" · "coloca a solicitação 2 em cotação" · "cancela a compra 1" · "desativar o fornecedor X" |
| Pedidos de material | "validar a troca 3" · "encaminhar o pedido 5" · "cancelar o pedido 4 porque a pessoa desistiu" · "aplicar a sugestão do pedido 2" · "entregar o pedido 2" |
| Usuários (master geral, de qualquer tela) | "cadastrar usuário no setor RH" · "desativar a Juliana" · "muda a Carla para o Financeiro" · "tornar a Juliana master do almoxarifado" · "redefinir a senha do Pedro para …" · "a Juliana só pode ver as métricas" |
| Botões das telas | "classificar os itens" · "fazer inventário" · "importar planilha de itens/postos/colaboradores" · "importar o XML da nota" · "lançar uma nota" · "nova solicitação de compra" · "nova admissão" · "cadastrar um colaborador" · "criar um kit" · "adicionar uma pergunta no formulário" · "trocar minha senha" |
| Navegação | "abrir o estoque do almoxarifado" · "me leva nos fornecedores" · "abrir a gestão" (de qualquer setor) |

Para os botões, ela corre até a aba e o botão certos (até em outro setor) e dá um soquinho. Botões que abrem a janela de arquivos mostram um cartãozinho "Escolher arquivo" ao lado: o navegador só abre essa janela com um clique da pessoa. Código: `lib/max/intent.ts` (entendimento), `lib/max/skills-actions.ts` (alterações), `lib/max/skills-ui.ts` (botões e navegação). A bateria `npm test` confere centenas de jeitos de falar cada comando.

### A Max como agente (com a IA ligada)

Com as variáveis da IA configuradas, a Max deixa de só responder comandos e passa a **agir**: a IA recebe ferramentas e decide quais usar.

| Ela pode | Exemplos |
|---|---|
| Consultar qualquer dado que a pessoa pode ver | “Max, qual o saldo de camisa social?” · “o que saiu nas últimas 15 horas?” · “quais solicitações do Posto 01 estão pendentes?” |
| **Alterar** o sistema | “registre a saída de 5 bonés” · “envie 2 botas 40 para o Shopping Barra” · “marque a solicitação 12 como resolvida” · “cadastre o item lanterna com 7 unidades” · “autorize o e-mail fulano@empresa.com” |
| Administrar usuários (master) | “passe a Juliana para o Financeiro” · “desative o acesso do Pedro” · “deixe a Juliana editar o Estoque” · “crie o usuário Rita Lopes, login rita, senha …” |
| **Pesquisar na web** em tempo real | “Max, pesquise o valor do salário mínimo” · “quais as notícias de hoje sobre segurança privada?” |

Como funciona, e por que é seguro:

- **Toda alteração pede um “sim”.** A Max diz o que vai fazer (“Vou registrar: saída de 5 unidades de Boné. Confirma?”) e só grava depois da confirmação, por voz ou no botão. “Não” cancela; mudar de assunto também. Isso existe porque o reconhecimento de voz erra, e um número errado no estoque é difícil de achar depois.
- **A IA não grava nada sozinha.** Depois do “sim”, quem executa é o navegador da pessoa, pelas **mesmas rotas dos botões da tela**. Então valem as mesmas validações e permissões: quem só visualiza o Estoque não movimenta estoque nem pela Max.
- **Cada pessoa só recebe as ferramentas que pode usar.** Um membro do RH não enxerga nada do almoxarifado; só o master geral mexe em usuários.
- **Filtro de linguagem.** Palavrões, ofensas e pedidos impróprios para o trabalho são barrados antes de chegar à IA, com uma resposta educada.
- Comandos simples e claros (“abrir estoque”, “quanto tem de bota 42?”, “sair”) continuam sendo resolvidos na hora, sem IA e sem gastar cota.
- Na **tela de login** a Max conversa, mas não tem ferramentas nem pesquisa na web (a página é pública).

**Pesquisa na web:** usa a ferramenta `browser_search` dos modelos `gpt-oss` da Groq e liga sozinha com eles. Variáveis opcionais: `MAX_LLM_WEB` (`off` desliga) e `MAX_LLM_WEB_MODEL`.

**Limite do plano gratuito:** a cota gratuita da Groq é contada em tokens por minuto e por dia (confira a sua em console.groq.com → Settings → Limits). Um pedido ao agente gasta bem mais do que uma pergunta simples, e uma pesquisa na web gasta ainda mais. Se o limite estourar, a Max avisa e os comandos prontos continuam funcionando; o limite volta sozinho no minuto seguinte.

### Troca de tela pela Max

Pelo clique, a troca de tela é direta (na mesma página, com a entrada em 3D). Quando alguém pede pela Max ("Max, abrir o setor almoxarifado", "abrir o estoque"), ela ganha bracinhos e perninhas, corre até o botão certo e dá um soquinho nele; se precisar de mais de um botão (de um setor para outro: **Painel master** e depois o card), ela passa por todos. Depois volta correndo para o canto. A Max usa um boné "Max Forte" que acompanha as animações dela. Código: `components/core/Warp.tsx`, `components/max/MaxRunner.tsx`, `components/max/MaxCap.tsx`.

### Como a Max pensa e aprende

Cada pedido passa por camadas, da mais rápida para a mais capaz:

1. **Habilidades locais** (instantâneas, sem custo): saldo, estoque baixo, categorias, métricas, telas, usuários.
2. **Memória de aprendizado:** se um pedido praticamente igual já foi resolvido antes, ela repete a solução na hora, sem chamar a IA.
3. **IA com ferramentas (Groq):** entende o pedido pelo sentido. Recebe um *retrato do sistema* (totais do estoque, valor, categorias, solicitações, postos, usuários — só o que a pessoa pode ver), as *anotações* ensinadas e os *pedidos parecidos já resolvidos* como guia.
4. **Arbitragem:** em frase longa a IA confere a leitura local. Se a IA disser que "não sabe" ou "não existe", ganha uma segunda chance; se insistir, vale a resposta local. Um "não sei" só aparece quando nenhuma camada tem resposta.

**O que é o aprendizado (e o que não é):** não há rede neural treinada no seu servidor; isso exigiria máquina e custo. É um classificador por *vizinho mais próximo*: cada pedido resolvido vira um exemplo ("frase" → comando ou ferramenta), e pedidos novos são comparados pelos radicais das palavras e trigramas de letras (aguenta erro de voz, plural, ordem e cortesias). Muito parecido = executa na hora; parecido = vira exemplo no pedido à IA.

- **👍 / 👎** embaixo de cada resposta: 👎 aposenta o aprendizado daquele pedido e manda a frase para a lista do master.
- **Ensinar:** "Max, lembre que o fornecedor de botas é a Casa do Vigilante" (master do setor ou master geral; pede confirmação). A anotação passa a valer para todo o setor.
- **Painel master → Aprendizado da Max:** pedidos que ela não soube atender (com quem pediu e o que ela respondeu), anotações e tudo o que aprendeu, com botão de apagar. É por essa lista que se descobre o que falta ensinar ou criar.
- **Privacidade:** argumentos de alterações e de usuários (senhas) nunca vão para a memória; aprendizado de um setor não aparece em outro.
- **Cota gratuita:** perguntas de consulta vão só com as ferramentas de consulta (pedido ~40% menor), e quando o modelo principal atinge o limite entra o **modelo reserva** (`openai/gpt-oss-20b` ↔ `120b` na Groq, cada um com cota própria). `MAX_LLM_FALLBACK_MODEL` troca a reserva; `off` desliga.

**Ativar a memória:** rode `supabase/max_aprendizado.sql` no SQL Editor (cria 3 tabelas novas; não mexe nas existentes). Sem ele a Max funciona igual, só não guarda o que aprende.

### IA opcional da Max

Sem ela, frases muito fora do previsto recebem “ainda não sei responder isso”. Com ela, a Max entende pedidos livres (“como tá a saída de bota esse mês?”) e responde perguntas gerais.

Funciona com qualquer serviço compatível com a API *chat/completions* da OpenAI. Há serviços com plano gratuito e sem cartão (por exemplo a **Groq**; os limites são por minuto e por dia e mudam com o tempo). Na Vercel, cadastre:

| Key | Value |
|---|---|
| `MAX_LLM_API_KEY` | a chave criada no serviço |
| `MAX_LLM_BASE_URL` | ex.: `https://api.groq.com/openai/v1` |
| `MAX_LLM_MODEL` | o nome de um modelo, copiado da página de modelos do serviço (na Groq, ex.: `openai/gpt-oss-120b`) |
| `MAX_LLM_REASONING_EFFORT` | opcional: `low`. Só para modelos de raciocínio, como os `gpt-oss` da Groq; deixa a resposta mais rápida e gasta menos da cota |

Só a **frase dita** é enviada à IA. Saldos, nomes e números do sistema nunca saem: quando o pedido depende de dados, a IA apenas “traduz” a frase para um comando que a Max executa localmente.

---

**Baixar métricas pela Max.** O arquivo é baixado sozinho para a pasta de downloads: gráfico `.png` por padrão, planilha `.xlsx` se a pessoa disser "planilha" ou "Excel". Se o setor não tiver métricas, ela avisa e orienta a procurar o Mateus na sede. Para um setor novo ganhar o download: marque `metrics: true` em `lib/sectors.ts` e registre a função dele em `METRICS_DOWNLOAD` (`lib/max/skills-core.ts`). No Chrome, a partir do segundo download seguido o navegador pode pedir uma vez a permissão de "baixar vários arquivos".

## Criar a ferramenta de um setor

Os setores ficam em `lib/sectors.ts`. A tela padrão é `components/setores/SectorShell.tsx`.

- **Novo setor:** acrescente uma entrada em `lib/sectors.ts`. Ele ganha sozinho a página `/setor/<slug>`, o cartão no painel master, a aba Equipe e a Max.
- **Funções de um setor:** declare os `modules` (viram linhas no editor de permissões), crie as telas em `components/<setor>/` e as rotas em `app/api/<setor>/`, protegendo cada rota com `requireModule('<setor>', '<módulo>', 'view' | 'edit')` de `lib/access.ts`. O almoxarifado é o exemplo completo.
- **Ensinar a Max:** acrescente habilidades em `lib/max/` (veja `skills-almox.ts`) e as frases de teste em `tests/max-nlu.test.ts`.

---

## Colocar no ar do zero

Você vai precisar de 3 contas gratuitas: **GitHub**, **Supabase** e **Vercel**.

1. **Supabase:** crie o projeto (região *South America (São Paulo)*) e, no **SQL Editor**, rode nesta ordem: `supabase/schema.sql`, `supabase/estoque.sql`, `supabase/seed_estoque.sql` (opcional, carga inicial), `supabase/baixa_e_usuarios.sql`, `supabase/maxhub.sql`, `supabase/categorias.sql`, `supabase/max_aprendizado.sql` e `supabase/compras.sql`. Em **Project Settings → Realtime**, deixe **Allow public access** ligado.
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
- **Exportar** baixa um `.csv` que abre direto no Excel. **Importar planilha** cadastra os itens novos e **atualiza os que já existem** (mesmo nome + tamanho): saldo, mínimo e custo ficam iguais aos da planilha. A pré-visualização mostra cada mudança (ex.: saldo ~~12~~ → **0**) antes de gravar. A mudança de saldo entra no histórico como **ajuste** ("Atualizado pela planilha"); nada do histórico é apagado, e itens que não estão na planilha ficam como estão. Na planilha do Almoxarifado vale a coluna **SALDO** (já com entradas e saídas), e saldos calculados por fórmula que dão 0 são lidos como 0.

**Postos** (`/setor/almoxarifado#postos`)
- Lista de postos com o que cada um tem. Toque em um posto para ver o estoque dele, **devolver** ao almoxarifado, dar **baixa** (consumido no posto), **enviar itens**, editar ou **remover**. Ao remover um posto, o que estava nele volta para o almoxarifado.
- **Novo posto:** um só (com código, cidade, endereço, supervisor) ou vários de uma vez, um nome por linha.
- **Importar planilha:** aceita `.xlsx` e `.csv`. O leitor acha sozinho a tabela e as colunas, mesmo com título, linhas vazias, células mescladas, totais, abas extras ou sem cabeçalho. Mostra uma **pré-visualização** antes de gravar. Postos que **já existem nunca são substituídos**: só os novos entram. Excel antigo (`.xls`) precisa ser salvo como `.xlsx`. Limite de 4 MB por arquivo.
- Se a lista de postos do **formulário de solicitações** for diferente da daqui, aparece um aviso com o botão **Atualizar formulário**.

**Observações sobre a planilha original (`Livro1.xlsx`):** as colunas ENTRADA, SAÍDA, SALDO e REF dependiam de outra planilha (links externos) e vinham com erro. A carga inicial usa a coluna **QUANT** como saldo atual. Dois pares de linhas repetidas (mesmo nome e tamanho) foram unidos.

---

## Compras ⇄ Almoxarifado (solicitações de compra)

O Almoxarifado pede, o setor de Compras atende — tudo em tempo real.

- **Almoxarifado → aba Compras:** "Nova solicitação de compra" com itens do estoque (busca por nome/tamanho, com saldo e mínimo) ou itens novos, quantidade, prioridade (normal/urgente), "precisa até" e motivo. O formulário sugere os itens com estoque baixo (quantidade para chegar a 2× o mínimo). No detalhe de um item do Estoque há o botão **Pedir compra deste item**. Enquanto o pedido está "Nova", o Almoxarifado pode cancelar.
- **Compras → aba Solicitações:** cada pedido novo chega **sem recarregar a página**, com aviso na tela, som e a **Max falando em voz alta** (ela pisca em amarelo enquanto fala). Compras muda o andamento — Em cotação, Comprada, Entregue ou Recusada — e responde; o Almoxarifado vê na hora, com aviso.
- **Permissões:** no Almoxarifado, módulo **Compras** (visualizar = acompanhar; editar = pedir e cancelar). Em Compras, módulo **Solicitações** (visualizar = ver; editar = mudar andamento e responder). Masters do setor e o master geral têm tudo. Membros antigos do Almoxarifado começam **sem** acesso a Compras: libere na aba Equipe.
- **Max:** "Max, tem solicitação de compra nova?", "Max, como está a solicitação de compra 3?", "Max, qual foi a última solicitação?" (em Compras).
- **Som e voz:** o navegador só toca som e fala depois do primeiro clique na página; até lá aparece um lembrete discreto. O aviso na tela aparece sempre.
- **Tempo real:** chega pelo Supabase Realtime em cerca de 1 segundo; se a rede bloquear o Realtime, a tela de Compras confere sozinha a cada 8 segundos (o Almoxarifado, a cada 12).

**Ativar:** rode `supabase/compras.sql` no SQL Editor (cria a tabela nova; não mexe em nada existente). Sem ele, as abas explicam o que falta e o resto do sistema funciona normalmente.

### Fornecedores (Compras › Fornecedores)

- **Cadastro manual:** razão social (obrigatória), nome fantasia, CNPJ ou CPF (com conferência dos dígitos), o que fornece, contato, telefone, e-mail, cidade/UF, endereço e observações.
- **Por planilha:** a mesma leitura inteligente das outras importações. Acha o cabeçalho sozinha, reconhece as colunas pelo nome (razão social, fornecedor, CNPJ, telefone, e-mail, contato, o que fornece, cidade, UF…) e corrige o CNPJ que o Excel guardou como número. Mostra tudo antes de gravar: **novo**, **já cadastrado** (é completado com o que veio na planilha), **repetido** ou **com problema** (com o motivo).
- Quem vende pelas **notas fiscais** entra sozinho (pelo CNPJ) e aparece aqui com o histórico: quantidade de notas, total comprado e última nota.
- Fornecedor não é apagado: é **desativado** (as notas continuam ligadas a ele).
- **Permissões:** módulo **Fornecedores** do setor Compras (visualizar = consultar; editar = cadastrar, editar e importar). Almoxarifado e Financeiro (módulo Notas) podem consultar.
- **Max:** "Max, cadastrar um novo fornecedor Malharia Bahia, telefone 71 3333-4444" (abre o cadastro já preenchido), "Max, importar a planilha de fornecedores", "Max, quem fornece botas?", "Max, qual o telefone do fornecedor Malharia Bahia?", "Max, quantos fornecedores temos?".

**Ativar:** rode `supabase/fornecedores.sql` no SQL Editor (completa a tabela de fornecedores; não apaga nada).

---

## Compras completo: cotação, pedido de compra e recebimento pelo pedido

Feito a partir das especificações da gerência ("Módulo de Compras" e "Estoque/Recebimento/NF/Pagamentos").

**Ativar:** no SQL Editor do Supabase, rode `supabase/compras_pedidos.sql` (depois de `compras.sql`, `pedidos_e_notas.sql` e `fornecedores.sql`). Ele só **acrescenta** tabelas e colunas e pode ser rodado de novo. Os fornecedores que já existiam ficam homologados, e as equivalências antigas ficam validadas. Também ficam validadas as parcelas das notas antigas que já fechavam com o total. Antes do SQL, o site continua funcionando como antes, e as telas novas avisam que falta ativar.

### O caminho de uma compra

1. **Solicitação:** o Almoxarifado pede, como antes.
2. **Cotação (Compras):** no **Painel**, o botão **Cotar** junta as solicitações; itens iguais viram uma linha só e cada parte guarda a origem.
   - Os fornecedores que já vendem cada item entram sozinhos (cadastro de itens do fornecedor, contrato, notas e pedidos anteriores, ramo).
   - **Pedir orçamento** abre o e-mail pronto; também há o PDF da solicitação de orçamento.
   - Em cada proposta ficam o preço por item e o primeiro preço, quando houve negociação. Também ficam frete, desconto, pagamento, prazo em dias úteis (pronta entrega ou produção), marca/modelo, aderência, validade e anexos.
3. **Mapa comparativo:** compara o **custo efetivo** de cada item (preço + a parte do frete e do desconto), o prazo e o pagamento.
   - A opção de menor custo já vem marcada. Escolher outra exige **justificativa**.
   - Fornecedor **não homologado** pode cotar, mas não é contratado. Proposta vencida não é usada.
   - As propostas perdedoras ficam guardadas.
4. **Pedido de compra (PC 0001…):** nasce em rascunho, um por fornecedor.
   - **Aprovação:** abaixo da **alçada** (configurável em **Painel › Regras e alçada**) aprova sozinho. Acima dela, aprova o master geral ou quem tem a permissão nova **"Aprovação de compras"**. Quem emitiu não aprova o próprio pedido.
   - **Alteração depois de aprovado:** exige motivo e fica no histórico. Se mudar item, quantidade, preço, fornecedor, custos ou pagamento, volta para aprovação; se a alteração for recusada, o pedido volta exatamente ao aprovado.
   - **Envio:** PDF do pedido e e-mail pronto; a previsão de chegada é calculada em dias úteis (sem feriados nacionais e o 2 de Julho).
   - **Confirmação:** a data que o fornecedor confirmou passa a valer. Passou da data sem chegar, o pedido fica **atrasado**.
   - **Compra direta** (sem cotação, com motivo): para itens de contrato ou de fornecedor exclusivo. A solicitação mostra **Comprar direto do contrato** quando todos os itens estão no contrato de um fornecedor; o prazo vem do item, por exemplo Marvin com 5 dias úteis no contrato e 30 no que é produzido.
5. **Recebimento (Almoxarifado):** **Entradas › Receber pelo pedido** (ou **Compras › Painel do recebimento › Receber**).
   - As linhas vêm do pedido com o que falta receber e o preço combinado.
   - **DANFE:** foto ou PDF. A **chave de acesso** é lida do código de barras (foto) ou do texto (PDF) e preenche número, série e CNPJ; o PDF traz também o valor total e a data. Tudo é conferido antes de gravar, e a chave que não bate com o número ou com o CNPJ é recusada.
   - **Conferência física** por linha: chegou, aceito, recusado (com motivo). **Só o aceito entra no estoque.** Falta de mercadoria deixa a nota em recebimento parcial, e o resto continua a receber.
   - **Divergências** com o pedido (preço, quantidade acima do pedido, item fora do pedido, outro CNPJ, frete ou pagamento diferente) travam a entrada até Compras/gestão tratar, com justificativa. Para **autorizar** uma exceção é preciso ter a aprovação. O pedido **nunca** é alterado para bater com a nota.
   - **Parcelas:** vêm da condição de pagamento do pedido; a pessoa confere e valida. A soma precisa ser igual ao total da nota, ao centavo (se não for, a tela mostra a diferença). Toda alteração fica no histórico. As parcelas do XML que já fecham com o total valem sozinhas.
   - **Sem divergência,** "Registrar e dar entrada" é um clique só. Na entrada, o "a receber" do pedido baixa sozinho e a solicitação vira **Entregue** quando tudo chega.
   - **Estorno:** desfaz a entrada e devolve ao "a receber" do pedido.
6. **Uma nota, vários pedidos.** O fornecedor pode faturar numa nota só itens de pedidos diferentes, por exemplo 5 camisas do PC 0001 e 3 apitos do PC 0002. Cada linha da nota é ligada à linha certa de um dos pedidos em aberto do mesmo fornecedor, nesta ordem de força:
   1. o pedido que o fornecedor escreveu no item do XML (`xPed`/`nItemPed`);
   2. os pedidos citados nas informações complementares do XML ou no texto do DANFE ("Seu pedido nº 0002");
   3. o item do estoque, pela equivalência, ou o código do fornecedor cadastrado no pedido;
   4. a quantidade (igual ao que falta receber pesa mais) e o preço combinado;
   5. em empate, o pedido mais antigo.

   Como funciona:
   - **Linha dividida:** se a quantidade só fecha somando dois pedidos (8 camisas = 5 + 3), a linha é dividida entre eles, com os valores rateados ao centavo, e cada parte baixa o seu pedido. A nota mostra "parte 1 de 2".
   - **Motivo visível:** cada ligação mostra o porquê. Dá para trocar o pedido de uma linha, ou marcá-la "fora de pedido"; a escolha à mão não é mais mexida. O que já entrou no estoque não muda de pedido.
   - **Receber pelo pedido:** a tela oferece os outros pedidos abertos do mesmo fornecedor ("Veio mais algum pedido deste fornecedor nesta nota?"). O DANFE em PDF que cita o pedido ou traz os itens dele o inclui sozinho e avisa o item do pedido que não aparece no DANFE.
   - **XML:**
     - quando o fornecedor cita pedido e linha, ou usa o código cadastrado no pedido, o item já vem ligado ("pelo pedido");
     - quando a descrição só se parece com um item que está num pedido aberto, ele vem como sugestão, e **"Confirmar as sugestões dos pedidos"** liga todas de uma vez;
     - o que nem assim se resolve, a IA da Max (se configurada) lê a descrição do fornecedor e sugere. É sempre só sugestão.
   - **Entrada e estorno:** a entrada baixa o "a receber" de cada pedido e conclui cada um que fechar; o estorno devolve a cada pedido o que era dele.

### Saldos que não se confundem

No **Estoque**, cada item mostra separados:

- físico;
- reservado;
- disponível;
- requisições pendentes;
- **em compra (a receber)**, com a previsão e o atraso;
- **em conferência**.

Pedido de compra nunca soma ao físico.

### Equivalência de códigos

Em **Entradas › Equivalências** fica a ligação entre o código do fornecedor e o item do estoque. A chave é o CNPJ + código + unidade, e cada ligação guarda o fator de conversão (ex.: 1 caixa = 10 unidades). Um item interno pode ter vários fornecedores e códigos, e o estoque continua um só.

- A primeira ligação de cada código é confirmada por alguém; daí em diante vem sozinha.
- Pela descrição o sistema só **sugere**.

### Painéis e relatórios

- **Compras › Painel (Pedro):**
  - o que precisa de alguém (solicitações novas, pedidos para aprovar, divergências de nota, propostas vencidas, atrasos);
  - o que chega em 14 dias e os itens críticos (com **Comprar**);
  - desempenho dos fornecedores (pontualidade, atraso médio em dias úteis, divergências, total comprado) e a economia.
- **Compras › Fornecedores:** homologação, condições padrão, itens fornecidos com prazo, desempenho, histórico de preços e códigos.
- **Almoxarifado › Compras › Painel do recebimento (Juliana):** requisições a liberar, abaixo do mínimo, pedidos a receber, atrasos, recebimentos parciais e divergências de nota.
- **Entradas › Vencimentos:**
  - filtra por período e fornecedor e mostra o total por mês e por fornecedor;
  - exporta **planilha** e **PDF**;
  - é previsão de desembolso, sem afirmar pagamento.
- **Painel master › Gestão:**
  - valor comprado por mês, fornecedor e categoria;
  - itens críticos;
  - economia por critério definido:
    - **negociada** = (primeiro preço − preço final) × quantidade;
    - **sobre a média** = (média das outras propostas válidas − preço escolhido) × quantidade.

### Permissões

- **Compras › "Solicitações, cotações e pedidos":** cota, decide e emite pedidos.
- **Compras › "Aprovação de compras"** (nova): aprova pedidos e autoriza exceções das notas. O master geral também.
- **Almoxarifado › Entradas (notas):** recebe, confere, valida parcelas e mantém as equivalências.
- **Almoxarifado › Compras:** consulta pedidos de compra e condições.
- **Financeiro:** consulta notas e vencimentos.

### Ainda a confirmar com a gerência

Ficou configurável, sem nada presumido:

- **Alçada:** hoje todo pedido passa por aprovação. Ajuste o valor em Painel › Regras e alçada e dê a permissão "Aprovação de compras" a quem aprova.
- **Itens e prazos do contrato Marvin:** cadastre na ficha do fornecedor, item por item, marcando se o prazo já foi confirmado em contrato.
- **Estoque mínimo e de segurança:** continuam no cadastro de cada item.

### Testes

- `tests/api-compras.mjs`: 88 verificações dos critérios de aceite das duas especificações.
- `tests/e2e-compras-fluxo.mjs`: o fluxo inteiro nas telas, inclusive a leitura do DANFE em PDF e por foto do código de barras.

---

## Animações 3D e o manual da Max

- **3D em toda a plataforma:** cena 3D ao fundo das ferramentas (piso em perspectiva, sólidos girando, câmera que acompanha o mouse), telas que giram ao trocar de aba, gavetas e janelas que abrem em 3D, listas e cartões que "desdobram" ao aparecer, cartões e botões que inclinam com o mouse e botões que afundam ao clicar.
- **Manual da Max:** ela explica passo a passo qualquer setor ou tela, mesmo sem a IA ligada: "Max, me explique passo a passo como funciona o almoxarifado", "Max, como lanço uma nota fiscal?", "Max, como funciona a troca anual?", "Max, como funciona este setor?". Ela abre a tela certa e mostra os passos em um cartão. Com a IA ligada, o manual vai junto para ela responder com precisão.

---

## Estoque integrado (pedidos, notas, RH, Operação, Gestão)

Tudo o que dá para automatizar é feito sozinho, mas **nada é gravado sem a confirmação de alguém**: o sistema calcula, mostra a sugestão e a pessoa confirma.

**Ativar:** rode `supabase/pedidos_e_notas.sql` no SQL Editor (pode rodar de novo; não apaga nem altera saldos, entradas ou saídas que já existem). Sem ele, as telas novas explicam o que falta e o resto continua igual.

### Catálogo (código CC-GG-NNNN)
- **Estoque → Classificar:** o Max Hub sugere categoria e grupo pelo nome de cada item (ex.: bota → 01 Fardamento › 03 Calçados). Confira e confirme: cada item ganha o código, **único, que não muda e não é reaproveitado** (garantido pelo banco).
- Item novo já nasce com código. Campos novos no cadastro: marca/modelo, CA (EPI), localização, estoque máximo, prazo de reposição e estoque de segurança. Itens podem ser **desativados** (somem dos pedidos e buscas, o histórico fica).
- **Saldo físico, reservado e disponível**: reserva não baixa o físico; o disponível (físico − reservado) é o que pode ser usado.
- **Inventário** (master do Almoxarifado): digite o contado, só as diferenças são ajustadas e ficam no histórico. **Baixa** por perda/avaria ou devolução ao fornecedor, sempre com motivo.

### Pedidos de material (Almoxarifado › Pedidos de material)
- Origem **Operação** (Uesley) ou **RH/DP** (admissão, troca anual, troca extraordinária). Cada área tem o seu painel; o master geral vê tudo.
- Ao abrir um pedido, aparece a **Sugestão automática**: reservar o que há (sem furar o estoque mínimo) e pedir compra do que falta. Um clique confirma: a reserva é feita e a solicitação de compra vai para o setor de Compras, ligada ao pedido.
- **Entregar** gera o **termo de entrega** (página pronta para imprimir/assinar ou salvar em PDF) e baixa o saldo. Entrega parcial mantém o pedido aberto; quando tudo é entregue, ele é concluído sozinho.
- **Abaixo do mínimo:** usar o saldo que deixaria o item abaixo do mínimo pede a **liberação excepcional** do master do Almoxarifado (fica registrada no histórico).
- Alertas de **duplicidade** (o colaborador recebeu o mesmo item há menos de 90 dias, ou já tem pedido aberto), **atraso** e **admissão em risco** (começa em até 3 dias).
- **Devolução/troca** de um item entregue (bom estado volta ao saldo; avariado só registra). Status por item e consolidado, filtros (origem, posto, prioridade, período, atraso…) e **planilha Excel** do que está na tela.
- **Caixa de entrada → Criar pedido:** a solicitação do formulário vira pedido com os itens e tamanhos já reconhecidos.

### Operacional (Uesley)
- Pedidos dos postos: **Novo pedido**, conferir, **encaminhar ao Almoxarifado**, cancelar. **Validar** as trocas anuais abertas pelo RH.
- Chave **"Solicitações do formulário dos supervisores"**: *Direto ao Almoxarifado* (padrão, como sempre foi) ou *Passam pela Operação* (cada solicitação vira pedido e chega primeiro ao Uesley).
- Avisos na tela, som e a Max falando quando chega algo para conferir ou validar.

### RH/DP
- **Colaboradores:** cadastro com matrícula, função, posto, empresa, admissão e **tamanhos** (camisa, calça, calçado); importação por planilha (atualiza pela matrícula); ficha com tudo o que a pessoa recebeu (com os termos) e os pedidos.
- **Kits por função:** o que cada função recebe e de quanto em quanto tempo troca. Na **admissão**, basta informar função e tamanhos: o kit entra sozinho no pedido (dá para ajustar).
- **Troca anual:** lista automática de quem venceu ou vence em breve (pela última entrega ou admissão), com a **demanda consolidada** por item e tamanho. Marque e confirme: a troca vai para a Operação validar e depois ao Almoxarifado. A troca extraordinária exige justificativa e, por padrão, **não reinicia** a contagem (ajustável em Regras).

### Entradas por nota fiscal (Almoxarifado › Entradas)
- **Importar XML:** fornecedor, CNPJ, número, série, chave, itens, descontos, frete e parcelas vêm do arquivo. Os itens se ligam ao estoque sozinhos (pelo que aquele fornecedor já mandou antes, ou pelo nome e tamanho) e a solicitação de compra atendida já vem escolhida.
- **Conferência física:** informe o que chegou (tudo ou parte). A entrada atualiza o saldo e o **custo médio**; nota repetida é barrada; ao completar, a compra vira "Entregue" e o sistema mostra os **pedidos que esperavam** esses itens.
- **Estorno** com motivo (a entrada original fica no histórico). Notas sem XML podem ser digitadas.
- **Financeiro › Notas e vencimentos:** consulta das notas, parcelas, vencidas e a vencer (só leitura).

### Compras e reposição
- **Reposição sugerida** (Almoxarifado › Compras): ponto = consumo médio diário × prazo + segurança, já descontando o que está para chegar e os pedidos sem saldo. Ajuste as quantidades e confirme para gerar a solicitação de compra.
- Compras informa **fornecedor, nº do pedido de compra e previsão de entrega**; o Almoxarifado e os pedidos ligados veem na hora.

### Gestão (Painel master › Gestão)
- Valor do estoque (total e por categoria), físico/reservado/disponível, abaixo do mínimo, pedidos abertos/parciais/aguardando compra/atrasados/concluídos, tempo médio de atendimento, consumo e giro, entregas por empresa, itens sem movimentação, compras e vencimentos. **Excel** (planilha formatada, com resumo e abas por assunto) e **PDF** (relatório próprio, com gráficos e tabelas).
- Todas as planilhas baixáveis usam o mesmo padrão visual: `lib/reportXlsx.ts` (`buildReport`). Para um relatório novo, basta montar as seções e abas e chamar essa função.

### Permissões novas (aba Equipe de cada setor)
- Almoxarifado: **Pedidos de material** e **Entradas (notas fiscais)**. RH: **Pedidos** e **Colaboradores**. Operacional: **Pedidos de material**. Financeiro: **Notas e vencimentos**. Masters de setor têm tudo do setor; membros antigos começam sem os módulos novos (libere na aba Equipe).
- **Max:** "Max, quantos pedidos de material para separar?", "Max, tem troca para validar?", "Max, abrir o pedido 3".

### Fora deste pacote (decisões da Gestão no PDF)
- **Armamento e munições** (categoria 04) já existe no catálogo, mas o controle segregado (registro, guia de tráfego, responsáveis) depende das regras legais e fica para depois.
- Pontos que o PDF deixa para a Gestão decidir (ex.: se a troca extraordinária reinicia o ciclo, quem valida trocas) estão como opções nas telas, com o padrão do PDF.

---

## Categorias do estoque

Cada item pode ter **uma ou mais categorias**: Max Forte, Max Serviços, Max Confiável, EPI, Acessório, Equipamento, Higienizado, ou qualquer outra que a equipe criar. Um cinto pode ser "Acessório" **e** "Max Forte" ao mesmo tempo, e aparece nos dois filtros.

- **Estoque:** a barra "Categoria" filtra a lista; os números do topo e os filtros (estoque baixo, sem saldo, nos postos) acompanham a categoria escolhida. "Sem categoria" mostra o que falta classificar.
- **Detalhe do item:** marque ou desmarque as categorias (salva na hora) ou digite uma nova. Mudar categoria **não** mexe em saldo nem cria movimentação.
- **Novo item / Editar dados:** mesmas opções. A exportação (CSV) ganhou a coluna "Categorias".
- **Max:** "Max, quanto temos de EPI?", "Max, mostre os itens da Max Forte", "Max, o que está com estoque baixo na Max Serviços?", "Max, quais categorias existem?". Com a IA ligada: "Max, o cinto tático também é Max Forte" (ela pede confirmação antes de gravar).

**Atualizando um site que já está no ar:** no Supabase, abra o **SQL Editor** e rode `supabase/categorias.sql`. Ele cria a coluna de categorias e classifica os 308 itens da planilha. **Não altera saldo, mínimo, custo, postos nem histórico**, e pode ser rodado de novo: só preenche itens que ainda estão sem categoria. Se o código for publicado antes do SQL, o estoque continua funcionando normalmente, só sem categorias.

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
  categorias.sql           categorias dos itens do estoque
  max_aprendizado.sql      memória de aprendizado da Max
  compras.sql              solicitações de compra (Almoxarifado → Compras)  ← novo
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
| "As solicitações de compra ainda não foram ativadas no banco" | Rode `supabase/compras.sql` no SQL Editor. |
| "O aprendizado da Max ainda não foi ativado no banco" | Rode `supabase/max_aprendizado.sql` no SQL Editor. |
| "As categorias ainda não foram ativadas no banco" | Rode `supabase/categorias.sql` no SQL Editor. |
| "Falta rodar o arquivo supabase/maxhub.sql" | Rode `supabase/maxhub.sql` no SQL Editor (passo 1 da atualização). |
| Entrei e caí em "Quase lá" | O usuário não tem setor. O master geral aloca em **Usuários**. |
| Ninguém é master geral | No SQL Editor: `update admins set is_master = true, sector = null where username = 'seu_usuario';` |
| A Max não ouve | Use Chrome, Edge ou Safari e permita o microfone (cadeado da barra de endereço). No Firefox ela funciona digitando. |
| A Max ouve mas não fala na tela de login | O navegador só libera voz depois de um clique na página. Clique em qualquer lugar. |
| A Max responde "ainda não sei" a perguntas gerais | Sem a IA opcional ela usa só Wikipédia, clima e câmbio. Veja *IA opcional da Max*. |

## Pontos (aba da Evelyn)

A aba **Pontos** aparece só para os usuários `evelyn`, `jefferson` e `adilene` (nem o master geral vê; a regra fica em `lib/pontos/types.ts`, `PONTOS_USERS`). Ela anexa o espelho de ponto exportado do GesOper e a ferramenta faz a conferência sozinha. **Nada fica gravado:** o arquivo e o resultado existem só na tela e nos relatórios baixados.

- **Leitura:** aceita **PDF**, Excel (.xlsx), CSV e o ".xls" em HTML que sistemas web exportam. Não depende de layout fixo.
  - Acha o funcionário, a matrícula, a função, a filial (empresa e CNPJ) e o período no cabeçalho.
  - Acha as batidas pelas colunas (no PDF, pela posição de cada texto).
  - No GesOper: "21/08-Sex", "Folga", 00:00 nos campos vazios, o cliente/posto escrito na linha e as horas do próprio sistema (Hr. Dia e Horas Dif.).
- **Escala de cada funcionário:** vale a do espelho. Dia marcado como folga nunca vira "sem registro". A jornada prevista de cada dia é a calculada pelo sistema de ponto (Hr. Dia − Dif.). Sem essas informações, a escala é deduzida das batidas: 12x36 em dia sim, dia não, ou os dias da semana habituais.
- **O que a ferramenta aponta:**
  - **sem registro:** dia de trabalho sem nenhuma batida;
  - **parcialmente sem registro:** faltou a entrada, a saída ou o intervalo;
  - falta e ausência justificada (atestado, falta justificada);
  - atraso e saída antecipada, comparando com o horário habitual da própria pessoa, que acompanha quem muda de horário no período;
  - hora extra e jornada acima do limite;
  - intervalo menor que 1h;
  - descanso menor que 11h entre jornadas;
  - trabalho em dia de folga;
  - batida repetida.
- **Batidas que não chegaram:** quando quase todos aparecem sem batida a partir de um dia, a tela avisa que as batidas talvez não tenham sido importadas no GesOper e oferece considerar só até o dia anterior.
- **Filtros:** período, cliente/posto, filial e função. Valem para a tela e para os relatórios.
- **Relatórios:** um **.zip** baixa sozinho depois da análise, com `RELATÓRIO COMPLETO.pdf` (detalhe dia a dia) e `RELATÓRIO PARA DIRETORIA.pdf` (limpo: números, destaques, quem está sem registro ou com registro parcial e os dias, e o resumo por posto). Também dá para baixar a **planilha de controle** (.xlsx).
