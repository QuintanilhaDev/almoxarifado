/**
 * Manual do Max Hub: como funciona cada setor e cada tela, em passos curtos.
 * A Max usa para responder "como funciona…", "passo a passo…", "como faço para…"
 * (sem internet e sem IA) e a IA opcional recebe os trechos certos como guia.
 * Código puro: roda no navegador e no servidor.
 */
import { contentTokens, matchScore, normalize } from './text';

export interface ManualTopic {
  id: string;
  title: string;
  /** setor da tela (null = vale em qualquer lugar) */
  sector: string | null;
  /** aba que a Max abre ao explicar (no setor do tópico) */
  tab?: string;
  /** jeitos de perguntar sobre o tópico (palavras-chave, sem acento) */
  keys: string[];
  /** uma ou duas frases do que é */
  summary: string;
  /** passo a passo */
  steps: string[];
  /** pergunta de exemplo (vira sugestão) */
  ask: string;
}

export const MANUAL: ManualTopic[] = [
  /* ---------------- visão geral ---------------- */
  {
    id: 'plataforma',
    title: 'O Max Hub',
    sector: null,
    keys: ['max hub', 'plataforma', 'sistema', 'site', 'hub', 'aplicativo'],
    summary: 'O Max Hub reúne os setores da empresa em um só lugar: Almoxarifado, Compras, RH, Operacional, Financeiro e Comercial. Cada pessoa entra direto no seu setor e vê só o que tem permissão.',
    steps: [
      'Entre com seu usuário e senha. Você cai direto na ferramenta do seu setor; o master geral cai no Painel master.',
      'O menu ao lado (no celular, embaixo) mostra as telas que você pode abrir.',
      'Os setores conversam entre si em tempo real: o que um faz, o outro vê na hora, com aviso na tela e da Max.',
      'Quem administra o setor (master do setor) libera as telas de cada pessoa na aba Equipe.',
      'Eu, a Max, fico no canto da tela: clique em mim, espere ficar verde e fale ou digite o pedido.',
    ],
    ask: 'Max, como funciona o Max Hub?',
  },
  {
    id: 'max',
    title: 'Usar a Max',
    sector: null,
    keys: ['max', 'assistente', 'voce', 'falar com voce', 'comando de voz', 'usar a max', 'conversar'],
    summary: 'Eu respondo por voz ou por texto, consulto os dados do seu setor, abro telas e preparo alterações, que só são gravadas depois do seu "sim".',
    steps: [
      'Clique na esfera no canto da tela. Quando ela ficar verde, fale começando por "Max" ou toque em Digitar.',
      'Peça do seu jeito: "Max, quanto tem de bota 42?", "Max, abrir pedidos de material", "Max, como faço para lançar uma nota?".',
      'Quando o pedido muda algo no sistema, eu digo o que vou fazer e espero você confirmar.',
      'Use o joinha para cima ou para baixo: é assim que eu aprendo o que acertei e o que errei.',
      'O alto-falante no topo liga e desliga a minha voz.',
    ],
    ask: 'Max, como eu uso você?',
  },
  {
    id: 'conta',
    title: 'Minha conta',
    sector: null,
    tab: 'conta',
    keys: ['minha conta', 'senha', 'trocar senha', 'mudar senha', 'meu nome', 'usuario de login', 'perfil'],
    summary: 'Em Minha conta você troca o seu nome, o usuário de login e a senha.',
    steps: ['Abra Minha conta no menu.', 'Altere o nome, o usuário ou a senha.', 'Para trocar usuário ou senha, confirme com a senha atual e salve.'],
    ask: 'Max, como troco minha senha?',
  },
  {
    id: 'equipe',
    title: 'Equipe e permissões',
    sector: null,
    tab: 'equipe',
    keys: ['equipe', 'permissao', 'permissoes', 'liberar acesso', 'dar acesso', 'adicionar pessoa', 'colocar alguem no setor', 'acesso'],
    summary: 'O master do setor decide, na aba Equipe, quem faz parte do setor e o que cada pessoa pode ver ou editar em cada tela.',
    steps: [
      'Abra Equipe (só aparece para o master do setor).',
      'Toque na pessoa ou em Adicionar para colocar alguém no setor.',
      'Para cada parte da ferramenta escolha Sem acesso, Visualizar ou Editar.',
      'Salve: a pessoa vê as telas novas na hora, sem precisar sair e entrar.',
    ],
    ask: 'Max, como libero uma tela para alguém?',
  },
  {
    id: 'login',
    title: 'Entrar no Max Hub',
    sector: null,
    keys: ['entrar', 'login', 'logar', 'acessar', 'esqueci a senha'],
    summary: 'Para entrar, use o usuário e a senha que o master do seu setor criou.',
    steps: ['Na tela inicial, digite o usuário e a senha.', 'Esqueceu a senha? Peça ao master do seu setor ou ao Mateus para redefinir.', 'Supervisores que só fazem pedidos usam o formulário de solicitação, sem login.'],
    ask: 'Max, como faço para entrar?',
  },

  /* ---------------- Painel master ---------------- */
  {
    id: 'hub',
    title: 'Painel master',
    sector: 'hub',
    tab: 'setores',
    keys: ['painel master', 'painel', 'master geral', 'visao dos setores'],
    summary: 'O Painel master é a tela do master geral: todos os setores, todos os usuários, a Gestão e o aprendizado da Max.',
    steps: [
      'Setores: o resumo de cada setor e o botão Abrir ferramenta.',
      'Gestão: os números do estoque, pedidos, compras e notas, com Excel e PDF.',
      'Usuários: criar pessoas, escolher o setor, o papel (master ou membro) e desativar.',
      'Aprendizado da Max: o que eu aprendi e as perguntas que ainda não soube responder.',
    ],
    ask: 'Max, como funciona o painel master?',
  },
  {
    id: 'usuarios',
    title: 'Criar usuário',
    sector: 'hub',
    tab: 'usuarios',
    keys: ['criar usuario', 'novo usuario', 'cadastrar usuario', 'usuarios', 'desativar usuario', 'cadastrar pessoa'],
    summary: 'Usuários são criados pelo master geral no Painel master, ou pelo master do setor na aba Equipe.',
    steps: [
      'Abra Usuários e toque em Novo usuário.',
      'Preencha nome, usuário de login e senha inicial.',
      'Escolha o setor e se a pessoa é master do setor ou membro.',
      'Salve. Para tirar o acesso, abra a pessoa e desative (o histórico fica).',
    ],
    ask: 'Max, como crio um usuário?',
  },
  {
    id: 'gestao',
    title: 'Gestão',
    sector: 'hub',
    tab: 'gestao',
    keys: ['gestao', 'indicadores', 'dashboard', 'relatorio gerencial', 'numeros da empresa', 'valor do estoque'],
    summary: 'A Gestão mostra, calculado na hora, o valor do estoque, o que está abaixo do mínimo, os pedidos abertos e atrasados, o tempo de atendimento, as compras e os vencimentos.',
    steps: ['Abra Gestão no Painel master.', 'Escolha o período (7, 30, 90 dias ou 12 meses).', 'Baixe em Excel ou imprima em PDF.', 'Os números se atualizam sozinhos quando os setores registram algo.'],
    ask: 'Max, como funciona a gestão?',
  },

  /* ---------------- Almoxarifado ---------------- */
  {
    id: 'almoxarifado',
    title: 'Almoxarifado',
    sector: 'almoxarifado',
    keys: ['almoxarifado', 'almox', 'setor do almoxarifado', 'setor de estoque'],
    summary: 'O Almoxarifado recebe os pedidos dos postos, da Operação e do RH, controla o estoque de fardamento e EPI, entrega com termo e pede compras.',
    steps: [
      'Solicitações: os pedidos que os supervisores mandam pelo formulário. Responda, dê baixa e marque como resolvida.',
      'Pedidos de material: os pedidos da Operação e do RH. O sistema sugere o que reservar e o que comprar; você confirma, entrega e imprime o termo.',
      'Estoque: saldo, reservado e disponível de cada item, com código, mínimo, custo e histórico. Entradas, saídas, transferências, inventário e baixas.',
      'Entradas (NF): importe o XML da nota, confira o que chegou e o estoque e o custo médio se atualizam.',
      'Postos: o que cada posto tem; devolver, dar baixa ou enviar itens.',
      'Compras: peça compras ao setor de Compras e use a reposição sugerida.',
      'Métricas: entradas e saídas por período, com gráfico e planilha.',
      'Formulário e E-mails autorizados: as perguntas do formulário e quem pode enviá-lo.',
    ],
    ask: 'Max, como funciona o almoxarifado?',
  },
  {
    id: 'solicitacoes',
    title: 'Solicitações dos postos',
    sector: 'almoxarifado',
    tab: 'solicitacoes',
    keys: ['solicitacoes', 'solicitacao', 'caixa de entrada', 'pedido do supervisor', 'formulario dos supervisores', 'resolver solicitacao', 'marcar como resolvida'],
    summary: 'As solicitações chegam do formulário dos supervisores, com som e aviso, divididas em Novas, Pendentes e Resolvidas.',
    steps: [
      'Abra Solicitações e toque na solicitação.',
      'Veja as respostas, fotos e vídeos e o e-mail do supervisor.',
      'Marque Pendente enquanto cuida e Resolvida ao terminar (o sistema guarda quem fez).',
      'Use Responder para escrever a resposta e dar baixa no estoque ao mesmo tempo, ou Criar pedido para tratar como pedido de material, com reserva e termo.',
    ],
    ask: 'Max, como funcionam as solicitações?',
  },
  {
    id: 'responder',
    title: 'Responder com baixa',
    sector: 'almoxarifado',
    tab: 'solicitacoes',
    keys: ['responder', 'resposta', 'baixa automatica', 'dar baixa na solicitacao', 'responder email', 'estornar baixa'],
    summary: 'No Responder você escreve a resposta ao supervisor e o sistema reconhece os itens enviados para dar baixa no estoque.',
    steps: [
      'Abra a solicitação e toque em Responder.',
      'Escreva o que foi enviado (ex.: 2 camisas M e 1 bota 42). Os itens reconhecidos aparecem ao lado.',
      'Confira os itens marcados e escolha Transferir para o posto ou Só dar baixa.',
      'Toque em Revisar baixa, confira o saldo antes e depois e confirme. Dá para abrir o e-mail já preenchido.',
      'Errou? Em Baixas de estoque, no detalhe, use Estornar.',
    ],
    ask: 'Max, como respondo com baixa?',
  },
  {
    id: 'estoque',
    title: 'Estoque',
    sector: 'almoxarifado',
    tab: 'estoque',
    keys: ['estoque', 'itens', 'saldo', 'reservado', 'disponivel', 'saldo disponivel', 'produtos', 'entrada', 'saida', 'ajustar saldo', 'novo item', 'cadastrar item', 'movimentar'],
    summary: 'No Estoque fica cada item com saldo físico, reservado, disponível, mínimo, custo, código e histórico.',
    steps: [
      'Abra Estoque. Use a busca, os filtros (estoque baixo, sem saldo, nos postos) e as categorias.',
      'Toque em um item para registrar Entrada, Saída, Ajustar saldo ou Enviar a posto.',
      'Novo item cadastra um produto; ele já ganha o código do catálogo.',
      'Reservado é o que já está separado para pedidos: ainda está na prateleira, mas não está livre.',
      'Exportar baixa a planilha; Importar planilha cadastra só os itens novos.',
    ],
    ask: 'Max, como funciona o estoque?',
  },
  {
    id: 'codigos',
    title: 'Códigos do catálogo',
    sector: 'almoxarifado',
    tab: 'estoque',
    keys: ['codigo', 'codigos', 'catalogo', 'classificar', 'classificacao', 'categoria e grupo', 'cc gg nnnn'],
    summary: 'Cada item tem um código no formato categoria, grupo e número, como 01-03-0001. Ele é gerado sozinho, nunca muda e não é reaproveitado.',
    steps: [
      'No Estoque, toque em Classificar (aparece enquanto houver item sem código).',
      'Confira a categoria e o grupo que o sistema sugeriu pelo nome; os marcados em amarelo precisam da sua escolha.',
      'Toque em Gerar códigos. Itens novos já nascem com código.',
    ],
    ask: 'Max, como funcionam os códigos dos itens?',
  },
  {
    id: 'inventario',
    title: 'Inventário e baixas',
    sector: 'almoxarifado',
    tab: 'estoque',
    keys: ['inventario', 'contagem', 'baixa por perda', 'perda', 'avaria', 'devolucao ao fornecedor', 'desativar item'],
    summary: 'O inventário corrige o saldo pela contagem; a baixa registra perda, avaria ou devolução ao fornecedor, sempre com motivo.',
    steps: [
      'Inventário (master do Almoxarifado): no Estoque, toque em Inventário, digite o que foi contado e registre. Só as diferenças são ajustadas.',
      'Baixa: abra o item e toque em Baixa, escolha perda/avaria ou devolução ao fornecedor, a quantidade e o motivo.',
      'Item que não se usa mais: abra e toque em Desativar. Ele some dos pedidos, mas o histórico fica.',
    ],
    ask: 'Max, como faço o inventário?',
  },
  {
    id: 'postos',
    title: 'Postos',
    sector: 'almoxarifado',
    tab: 'postos',
    keys: ['postos', 'posto', 'transferir para posto', 'enviar para posto', 'devolver do posto', 'novo posto'],
    summary: 'Em Postos você vê o que está em cada posto, envia itens, recebe devoluções e dá baixa do que foi consumido.',
    steps: [
      'Abra Postos e toque no posto.',
      'Enviar itens tira do almoxarifado e coloca no posto.',
      'Devolver traz de volta; Baixa registra o que foi consumido no posto.',
      'Novo posto cadastra um ou vários; Importar planilha cadastra só os que ainda não existem.',
    ],
    ask: 'Max, como funcionam os postos?',
  },
  {
    id: 'pedidos-almox',
    title: 'Pedidos de material (Almoxarifado)',
    sector: 'almoxarifado',
    tab: 'pedidos',
    keys: ['pedidos de material', 'pedido de material', 'reservar', 'reserva', 'entregar', 'entrega', 'termo', 'termo de entrega', 'sugestao automatica', 'separar'],
    summary: 'Os pedidos da Operação e do RH chegam aqui com aviso. O sistema sugere o que reservar e o que comprar, você confirma, entrega e o termo sai pronto.',
    steps: [
      'Abra Pedidos de material; o filtro Para separar mostra o que espera você.',
      'Abra o pedido e veja a Sugestão automática: reserva o que há sem furar o mínimo e pede compra do que falta. Toque em Confirmar sugestão.',
      'Quando o material estiver separado, toque em Entregar, confira quem recebe e confirme. O termo abre pronto para imprimir e assinar.',
      'Entrega parcial deixa o pedido aberto; quando tudo é entregue, ele se conclui sozinho.',
      'Se algo precisar sair abaixo do estoque mínimo, o master do Almoxarifado autoriza a liberação excepcional.',
      'Pedido com erro? Use Devolver para correção, com o motivo. Item devolvido pelo colaborador: Devolução, no termo.',
    ],
    ask: 'Max, como funcionam os pedidos de material?',
  },
  {
    id: 'notas',
    title: 'Entradas por nota fiscal',
    sector: 'almoxarifado',
    tab: 'notas',
    keys: ['nota fiscal', 'notas fiscais', 'nota', 'nf', 'xml', 'lancar nota', 'entrada da nota', 'conferencia', 'recebimento', 'estornar nota'],
    summary: 'Em Entradas você importa o XML da nota: fornecedor, itens, descontos e parcelas vêm preenchidos e os itens já se ligam ao estoque.',
    steps: [
      'Abra Entradas (NF) e toque em Importar XML (ou Digitar nota, se não tiver o arquivo).',
      'Confira os itens ligados ao estoque; ligue os que ficaram sem item.',
      'Em Recebido, coloque o que chegou de verdade (pode ser só uma parte).',
      'Toque em Registrar e dar entrada: o saldo e o custo médio se atualizam, e a compra ligada vira Entregue.',
      'O sistema mostra os pedidos que esperavam esses itens para você reservar.',
      'Lançou errado? Abra a nota e use Estornar nota, com o motivo.',
    ],
    ask: 'Max, como lanço uma nota fiscal?',
  },
  {
    id: 'compras-almox',
    title: 'Pedir compras',
    sector: 'almoxarifado',
    tab: 'compras',
    keys: ['pedir compra', 'compra', 'peco compra', 'solicitacao de compra', 'comprar', 'reposicao', 'reposicao sugerida', 'ponto de reposicao'],
    summary: 'Na aba Compras o Almoxarifado pede compras ao setor de Compras e acompanha cada pedido até a entrega.',
    steps: [
      'Reposição sugerida: o sistema calcula o que repor pelo consumo médio e pelo prazo, já descontando o que está para chegar. Ajuste e confirme.',
      'Ou toque em Nova solicitação de compra e escolha os itens e as quantidades.',
      'O setor de Compras recebe na hora; você acompanha o andamento, o fornecedor e a previsão.',
      'Enquanto estiver como Nova, dá para cancelar.',
    ],
    ask: 'Max, como peço uma compra?',
  },
  {
    id: 'metricas',
    title: 'Métricas',
    sector: 'almoxarifado',
    tab: 'metricas',
    keys: ['metricas', 'grafico', 'relatorio', 'entradas e saidas', 'baixar planilha'],
    summary: 'Métricas mostram entradas, saídas, transferências e consumo por período, com gráfico e planilha.',
    steps: ['Abra Métricas.', 'Escolha o período (hoje, último dia, semana ou mês).', 'Baixe o gráfico em imagem ou a planilha em Excel.'],
    ask: 'Max, como funcionam as métricas?',
  },
  {
    id: 'formulario',
    title: 'Formulário e e-mails autorizados',
    sector: 'almoxarifado',
    tab: 'formulario',
    keys: ['formulario', 'perguntas do formulario', 'editar formulario', 'emails autorizados', 'autorizar email', 'supervisor novo'],
    summary: 'O Almoxarifado decide as perguntas do formulário dos supervisores e quais e-mails podem enviá-lo.',
    steps: [
      'Formulário: adicione, remova, renomeie e reordene perguntas; salve e todos veem a versão nova.',
      'E-mails autorizados: cadastre o e-mail do supervisor (com nome e posto, se quiser).',
      'Só e-mails autorizados conseguem enviar solicitações.',
    ],
    ask: 'Max, como autorizo um supervisor?',
  },
  {
    id: 'formulario-publico',
    title: 'Fazer uma solicitação (supervisor)',
    sector: null,
    keys: ['fazer uma solicitacao', 'pedir material', 'formulario de solicitacao', 'como o supervisor pede'],
    summary: 'O supervisor pede material pelo formulário de solicitação, sem login, usando o e-mail autorizado.',
    steps: ['Na tela inicial, toque em Fazer uma solicitação.', 'Preencha o e-mail autorizado, o colaborador, o posto, os itens e os tamanhos.', 'Envie e guarde o número da solicitação.'],
    ask: 'Max, como o supervisor faz uma solicitação?',
  },

  /* ---------------- Compras ---------------- */
  {
    id: 'compras',
    title: 'Setor de Compras',
    sector: 'compras',
    tab: 'solicitacoes',
    keys: ['compras', 'setor de compras', 'cotacao', 'andamento da compra', 'fornecedor', 'previsao de entrega'],
    summary: 'O setor de Compras recebe as solicitações do Almoxarifado em tempo real e atualiza o andamento até a entrega.',
    steps: [
      'Cada solicitação nova chega com aviso, som e a minha voz.',
      'Abra e marque o andamento: Em cotação, Comprada, Entregue ou Recusada.',
      'Preencha fornecedor, número do pedido de compra e previsão de entrega: o Almoxarifado vê na hora.',
      'Escreva uma resposta se precisar explicar algo.',
      'Quando o Almoxarifado lança a nota, a compra vira Entregue sozinha.',
    ],
    ask: 'Max, como funciona o setor de compras?',
  },

  /* ---------------- RH ---------------- */
  {
    id: 'rh',
    title: 'Recursos Humanos',
    sector: 'rh',
    keys: ['rh', 'recursos humanos', 'departamento pessoal', 'dp', 'setor do rh'],
    summary: 'O RH pede os kits de admissão e as trocas de fardamento, mantém o cadastro dos colaboradores com os tamanhos e acompanha a troca anual.',
    steps: [
      'Pedidos: abra admissões e trocas extraordinárias; o Almoxarifado recebe na hora.',
      'Colaboradores: cadastro com função, posto e tamanhos, e o histórico do que cada um recebeu.',
      'Kits por função: o que cada função recebe e de quanto em quanto tempo troca.',
      'Troca anual: a lista de quem venceu ou vai vencer, para abrir as trocas de uma vez.',
    ],
    ask: 'Max, como funciona o RH?',
  },
  {
    id: 'admissao',
    title: 'Pedido de admissão',
    sector: 'rh',
    tab: 'pedidos',
    keys: ['admissao', 'kit de admissao', 'novo colaborador', 'colaborador novo', 'pedido do rh', 'troca extraordinaria'],
    summary: 'Na admissão basta informar a função e os tamanhos: o kit da função entra sozinho no pedido.',
    steps: [
      'Abra Pedidos e toque em Novo pedido do RH, Admissão.',
      'Digite o nome, a matrícula, o posto, a função e os tamanhos de camisa, calça e calçado.',
      'O kit da função aparece com os tamanhos certos; ajuste se precisar.',
      'Informe a data de início e envie: o Almoxarifado recebe na hora e o cadastro do colaborador é criado junto.',
      'Troca extraordinária: escolha um colaborador já cadastrado e diga o motivo (desgaste, perda, mudança de função).',
    ],
    ask: 'Max, como faço um pedido de admissão?',
  },
  {
    id: 'colaboradores',
    title: 'Colaboradores e kits',
    sector: 'rh',
    tab: 'colaboradores',
    keys: ['colaboradores', 'colaborador', 'tamanhos', 'kit por funcao', 'kits', 'importar colaboradores', 'desligado'],
    summary: 'Em Colaboradores fica o cadastro de cada pessoa com função, posto, admissão e tamanhos, e os kits de cada função.',
    steps: [
      'Novo colaborador cadastra um; Importar planilha cadastra vários (quem já existe é atualizado pela matrícula).',
      'Toque em alguém para ver tudo o que recebeu, com os termos, e para editar os tamanhos.',
      'Em Kits por função, diga o que cada função recebe e a cada quantos meses troca.',
      'Quem saiu da empresa: Marcar como desligado.',
    ],
    ask: 'Max, como cadastro um colaborador?',
  },
  {
    id: 'troca-anual',
    title: 'Troca anual',
    sector: 'rh',
    tab: 'trocas',
    keys: ['troca anual', 'troca de fardamento', 'trocas', 'vencida', 'vencimento da troca'],
    summary: 'A troca anual é calculada sozinha pela última entrega (ou admissão) e pelo prazo de cada função.',
    steps: [
      'Abra Troca anual: aparecem as vencidas e as que vencem em breve.',
      'Embaixo, a demanda consolidada mostra quantas peças de cada tamanho vão ser necessárias.',
      'Marque as pessoas e toque em Abrir troca.',
      'A Operação valida e o Almoxarifado entrega com termo.',
    ],
    ask: 'Max, como funciona a troca anual?',
  },

  /* ---------------- Operacional ---------------- */
  {
    id: 'operacional',
    title: 'Operacional',
    sector: 'operacional',
    tab: 'pedidos',
    keys: ['operacional', 'operacao', 'uesley', 'encaminhar', 'validar troca', 'conferir pedido', 'pedido do posto'],
    summary: 'A Operação confere os pedidos dos postos, encaminha ao Almoxarifado e valida as trocas anuais do RH.',
    steps: [
      'Abra Pedidos de material; o filtro Para conferir mostra o que espera a Operação.',
      'Novo pedido registra o pedido de um posto; desmarque Encaminhar direto se quiser conferir antes.',
      'Abra o pedido e toque em Encaminhar ao Almoxarifado.',
      'Trocas anuais do RH chegam para validar: abra e toque em Validar troca.',
      'A chave do topo define se o formulário dos supervisores passa pela Operação ou vai direto ao Almoxarifado.',
    ],
    ask: 'Max, como funciona o operacional?',
  },

  /* ---------------- Financeiro ---------------- */
  {
    id: 'financeiro',
    title: 'Financeiro',
    sector: 'financeiro',
    tab: 'notas',
    keys: ['financeiro', 'vencimentos', 'parcelas', 'boletos', 'contas a pagar', 'notas e vencimentos'],
    summary: 'O Financeiro consulta as notas de compra lançadas pelo Almoxarifado, com as parcelas e os vencimentos.',
    steps: [
      'Abra Notas e vencimentos.',
      'Vencimentos lista as parcelas por data, com o vencido em vermelho.',
      'Toque em uma nota para ver os itens, os valores e baixar o XML.',
      'O recebimento físico não aprova o pagamento: ele é só a conferência do Almoxarifado.',
    ],
    ask: 'Max, como funciona o financeiro?',
  },
];

/** começa com uma ordem ("abrir…", "mostra…"): é para fazer, não para explicar */
export const ORDER_RE = /^(abr\w+|abre|ir |vai |va |mostr\w+|filtr\w+|baix\w+|sair|sai |list\w+|exib\w+|leva|leve)/;

/** A frase pede explicação ("como funciona", "passo a passo", "como faço para"…)? */
export const EXPLAIN_RE =
  /\b(como (e que |eu |que eu |a gente |se |posso |devo |vou |faco pra |faco para )?(funciona\w*|func\w+|faco|faz|fazer|faria|uso|usa|usar|utiliz\w+|mexo|mexe|opero|opera|lanc\w+|registr\w+|cadastr\w+|crio|cria|criar|peco|pede|pedir|abro|abrir|troc\w+|dou|dar|liber\w+|reserv\w+|entreg\w+|import\w+|classific\w+|autoriz\w+|respond\w+|estorn\w+|valid\w+|encaminh\w+)|passo a passo|tutorial|me (ensina|ensine|explica|explique|mostra como)|explic\w+|o que (e|sao|significa)|para que serve|pra que serve|qual (a )?funcao|nao sei (como|usar|mexer)|onde (eu )?(fico|vejo|acho|encontro|fica)|treinamento|manual|guia)\b/;

const GENERIC_HERE = /\b(este setor|esse setor|aqui|essa tela|esta tela|essa ferramenta|esta ferramenta|meu setor|o setor|a ferramenta)\b/;
const QUESTION_WORDS = new Set(['como', 'funciona', 'funcionam', 'passo', 'explique', 'explica', 'explicar', 'me', 'max', 'faco', 'fazer', 'faz', 'eu', 'por', 'favor', 'setor', 'sobre', 'que', 'e', 'o', 'a', 'do', 'da', 'de', 'para', 'pra', 'tela', 'aba', 'detalhe', 'detalhes', 'tutorial', 'ensina', 'ensine', 'voce', 'pode', 'poderia', 'quero', 'saber', 'gostaria', 'entender']);

export interface ManualHit {
  topic: ManualTopic;
  score: number;
}

/** Tópicos do manual que respondem à frase, do mais provável ao menos. `here` = setor da tela (ou 'hub'). */
export function searchManual(norm: string, here: string | null): ManualHit[] {
  const text = ` ${normalize(norm)} `;
  const words = contentTokens(text.trim()).filter((w) => !QUESTION_WORDS.has(w));
  const hits: ManualHit[] = [];
  for (const topic of MANUAL) {
    let best = 0;
    for (const key of topic.keys) {
      const k = normalize(key);
      if (text.includes(` ${k} `)) best = Math.max(best, 0.9 + Math.min(0.08, k.split(' ').length * 0.03));
      else {
        const kt = contentTokens(k);
        if (!kt.length) continue;
        // a chave inteira aparece (tolerando erro de voz) na frase
        const s = matchScore(kt, text);
        if (s >= 0.8) best = Math.max(best, s * 0.88);
      }
    }
    // palavras da frase que aparecem no título/resumo ajudam a desempatar
    if (best > 0 && words.length) {
      const hay = normalize(`${topic.title} ${topic.keys.join(' ')}`);
      const cover = words.filter((w) => hay.includes(w)).length / words.length;
      best += cover * 0.05;
    }
    if (best > 0 && topic.sector && topic.sector === here) best += 0.04;
    if (best > 0) hits.push({ topic, score: Math.min(1, best) });
  }
  // "como funciona este setor / aqui" sem citar nada: a visão geral da tela atual
  if (GENERIC_HERE.test(text) && !(hits.some((h) => h.score >= 0.9 && h.topic.id !== 'plataforma'))) {
    hits.length = 0;
    const overview = MANUAL.find((t) => (here === 'hub' ? t.id === 'hub' : t.id === here)) ?? MANUAL.find((t) => t.sector === here) ?? MANUAL[0];
    hits.push({ topic: overview, score: 0.9 });
  }
  return hits.sort((a, b) => b.score - a.score);
}

/** Os passos ditos em voz alta: "Primeiro, … Depois, … Por fim, …". */
export function spokenSteps(steps: string[]): string {
  const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
  return steps
    .map((s, i) => {
      const t = s.replace(/\.$/, '');
      if (steps.length === 1) return t + '.';
      if (i === 0) return `Primeiro: ${lower(t)}.`;
      if (i === steps.length - 1) return `Por fim: ${lower(t)}.`;
      return `${['Depois', 'Em seguida', 'Também', 'Além disso', 'E mais'][Math.min(i - 1, 4)]}: ${lower(t)}.`;
    })
    .join(' ');
}

/** Texto curto do tópico para a IA opcional (guia para responder com precisão). */
export function topicForAi(t: ManualTopic): string {
  return `${t.title}: ${t.summary} Passos: ${t.steps.map((s, i) => `${i + 1}) ${s}`).join(' ')}`;
}
