/**
 * Botões da plataforma que a Max aperta: ela corre até a aba certa (e, se preciso, até o setor
 * certo), depois até o botão, e dá um soquinho. Cada entrada diz onde o botão fica e quais
 * jeitos de pedir chamam por ele (verbo + assunto, em qualquer ordem e forma).
 */
import { canOpenSector, hasLevel } from '../permissions';
import { getSector, sectorPath, type SectorSlug } from '../sectors';
import { maxEmit } from './bus';
import { V, asksHow, findPostoIn } from './intent';
import type { Query } from './text';
import type { MaxHost, MaxReply, Skill } from './types';

const tabSel = (id: string) => `.nav-item[data-tab="${id}"], .tab[data-tab="${id}"]`;
const btn = (id: string) => `[data-max="${id}"]`;

/** abas de cada setor (para ir direto a uma aba de outro setor) */
export const SECTOR_TABS: Record<string, { id: string; label: string; aliases: string[] }[]> = {
  almoxarifado: [
    { id: 'solicitacoes', label: 'Solicitações', aliases: ['solicitacoes', 'caixa de entrada', 'requisicoes'] },
    { id: 'pedidos', label: 'Pedidos de material', aliases: ['pedidos de material', 'pedidos da operacao', 'pedidos do rh', 'admissoes', 'entregas', 'reservas'] },
    { id: 'estoque', label: 'Estoque', aliases: ['estoque', 'itens', 'inventario', 'produtos'] },
    { id: 'notas', label: 'Entradas (NF)', aliases: ['entradas', 'notas fiscais', 'nota fiscal', 'notas', 'nf', 'xml', 'recebimento'] },
    { id: 'postos', label: 'Postos', aliases: ['postos'] },
    { id: 'metricas', label: 'Métricas', aliases: ['metricas', 'graficos'] },
    { id: 'formulario', label: 'Formulário', aliases: ['formulario', 'perguntas'] },
    { id: 'emails', label: 'E-mails autorizados', aliases: ['emails', 'e-mails', 'emails autorizados', 'supervisores'] },
    { id: 'compras', label: 'Compras', aliases: ['pedidos de compra', 'solicitacoes de compra', 'aba compras', 'painel do recebimento', 'a receber', 'o que esta chegando'] },
    { id: 'equipe', label: 'Equipe', aliases: ['equipe', 'permissoes'] },
  ],
  rh: [
    { id: 'pedidos', label: 'Pedidos', aliases: ['pedidos', 'admissoes', 'admissao', 'pedidos do rh'] },
    { id: 'colaboradores', label: 'Colaboradores', aliases: ['colaboradores', 'funcionarios', 'kits'] },
    { id: 'trocas', label: 'Troca anual', aliases: ['troca anual', 'trocas', 'troca de fardamento'] },
    { id: 'equipe', label: 'Equipe', aliases: ['equipe', 'permissoes'] },
  ],
  operacional: [
    { id: 'pedidos', label: 'Pedidos de material', aliases: ['pedidos', 'pedidos de material', 'trocas para validar'] },
    { id: 'equipe', label: 'Equipe', aliases: ['equipe', 'permissoes'] },
  ],
  financeiro: [
    { id: 'notas', label: 'Notas e vencimentos', aliases: ['notas', 'notas fiscais', 'vencimentos', 'parcelas', 'boletos'] },
    { id: 'equipe', label: 'Equipe', aliases: ['equipe', 'permissoes'] },
  ],
  compras: [
    { id: 'painel', label: 'Painel', aliases: ['painel de compras', 'painel', 'pendencias de compras'] },
    { id: 'solicitacoes', label: 'Solicitações', aliases: ['solicitacoes', 'solicitacoes de compra', 'requisicoes de compra'] },
    { id: 'cotacoes', label: 'Cotações', aliases: ['cotacoes', 'cotacao', 'mapa comparativo', 'propostas', 'orcamentos'] },
    { id: 'pedidos-compra', label: 'Pedidos de compra', aliases: ['pedidos de compra', 'ordens de compra', 'aprovacoes de compra'] },
    { id: 'fornecedores', label: 'Fornecedores', aliases: ['fornecedores', 'cadastro de fornecedores', 'homologacao'] },
    { id: 'equipe', label: 'Equipe', aliases: ['equipe', 'permissoes'] },
  ],
  hub: [
    { id: 'setores', label: 'Setores', aliases: ['setores', 'visao geral'] },
    { id: 'gestao', label: 'Gestão', aliases: ['gestao', 'indicadores', 'painel da gestao'] },
    { id: 'usuarios', label: 'Usuários', aliases: ['usuarios', 'cadastro de usuarios', 'acessos'] },
    { id: 'auditoria', label: 'Auditoria', aliases: ['auditoria', 'registros', 'logs', 'atividades'] },
    { id: 'max', label: 'Aprendizado da Max', aliases: ['aprendizado', 'aprendizado da max', 'memoria da max'] },
  ],
};

interface UiAction {
  id: string;
  /** onde o botão fica; "*" = em qualquer tela (ex.: Minha conta) */
  sector: SectorSlug | 'hub' | '*' | SectorSlug[];
  tab: string;
  /** botões a apertar depois da aba, na ordem */
  steps: string[];
  /** o pedido (verbo e assunto juntos) */
  re: RegExp;
  not?: RegExp;
  /** módulo (permissão de edição) que o botão exige */
  module?: string;
  say: string;
}

const NOT_ITEMS = /\b(postos?|colaborador\w*|funcionari\w+|fornecedor\w*|xml|notas?|nf|usuari\w+|perguntas?|kits?)\b/;

const UI: UiAction[] = [
  { id: 'estoque-classificar', sector: 'almoxarifado', tab: 'estoque', steps: [btn('estoque-classificar')], module: 'estoque', say: 'Abrindo a classificação dos itens: eu sugiro a categoria e o grupo de cada um, você confere e gera os códigos.', re: /\b(classific\w+|codific\w+|(ger\w+|cri\w+|atribu\w+|d[aeê]\w*|coloc\w+|faz\w*) (os )?codigos?)\b/ },
  { id: 'estoque-inventario', sector: 'almoxarifado', tab: 'estoque', steps: [btn('estoque-inventario')], module: 'estoque', say: 'Abrindo o inventário. Digite o que foi contado: só as diferenças são ajustadas.', re: /\b(faz\w*|fac\w+|abr\w+|abre|inici\w+|comec\w+|lanc\w+|realiz\w+|vamos|quero|preciso|novo)\b.*\binventario\b|\binventario (geral|do estoque|completo)\b/ },
  { id: 'estoque-importar', sector: 'almoxarifado', tab: 'estoque', steps: [btn('estoque-importar')], module: 'estoque', say: 'Abrindo a importação de itens. É só escolher ou arrastar a planilha: eu reconheço as colunas sozinha.', re: /\b(import\w+|carreg\w+|sub(ir|a|o)|sobe|upload)\b.*\b(planilha|itens|estoque|produtos|materiais|catalogo|excel|csv)\b/, not: NOT_ITEMS },
  { id: 'postos-importar', sector: 'almoxarifado', tab: 'postos', steps: [btn('postos-importar')], module: 'postos', say: 'Abrindo a importação de postos. Escolha ou arraste a planilha.', re: /\b(import\w+|carreg\w+|sub(ir|a|o)|sobe|upload)\b.*\bpostos?\b/ },
  { id: 'compra-nova', sector: 'almoxarifado', tab: 'compras', steps: [btn('compra-nova')], module: 'compras', say: 'Abrindo uma nova solicitação de compra. Os itens com estoque baixo já aparecem como sugestão.', re: /\b(nov[oa]|faz\w*|fac\w+|(abr\w+|abre) (um|uma|nov[oa])|cri\w+|ped\w+|solicitar|lanc\w+|mand\w+|envi\w+)\b.*\b(solicitac\w+ de compras?|pedidos? de compras?|compras?)\b/, not: /\b(cancel\w+|\d+|status|andamento|como esta|marc\w+|quant\w+)\b/ },
  { id: 'form-pergunta', sector: 'almoxarifado', tab: 'formulario', steps: [btn('form-pergunta')], module: 'formulario', say: 'Abrindo o formulário com uma pergunta nova no fim. Escreva a pergunta e salve.', re: /\b(adicion\w+|inclu\w+|cri\w+|nova|coloc\w+|bot\w+|acrescent\w+|p[oô]r)\b.*\bperguntas?\b/ },
  { id: 'nota-importar', sector: 'almoxarifado', tab: 'notas', steps: [btn('nota-importar')], module: 'notas', say: 'Abrindo a importação do XML da nota. Escolha o arquivo: eu leio fornecedor, itens, valores e parcelas.', re: /\b(import\w+|carreg\w+|sub(ir|a|o)|sobe|lanc\w+|ler|le|leia|envi\w+)\b.*\b(xml|xmls)\b/ },
  { id: 'nota-digitar', sector: 'almoxarifado', tab: 'notas', steps: [btn('nota-digitar')], module: 'notas', say: 'Abrindo o lançamento de nota digitada. Preencha fornecedor, número e itens.', re: /\b(digit\w+|lanc\w+|cadastr\w+|registr\w+|nova|inclu\w+|d[aeê]\w* entrada (de|da|na|numa) nota)\b.*\b(notas?( fiscal| fiscais)?|nf|nfe)\b/, not: /\b(xml|baix\w+|vencimento|parcela)\b/ },
  { id: 'pedido-novo', sector: ['rh', 'operacional'], tab: 'pedidos', steps: [btn('pedido-novo')], module: 'pedidos', say: 'Abrindo um pedido de material novo.', re: /\b(nov[oa]|(abr\w+|abre) (um|uma|nov[oa])|faz\w*|fac\w+|cri\w+|lanc\w+|ped\w+|registr\w+|solicitar|quero|preciso)\b.*\b(pedido( de material)?|admissao|troca extraordinaria|kit de admissao|reposicao de fardamento)\b/, not: /\b(\d+|quant\w+|atrasad\w+|validar|status|como esta|baix\w+|planilha|compra)\b/ },
  { id: 'colab-novo', sector: 'rh', tab: 'colaboradores', steps: [btn('colab-novo')], module: 'colaboradores', say: 'Abrindo o cadastro de colaborador novo.', re: /\b(cadastr\w+|cri\w+|nov[oa]|adicion\w+|inclu\w+|registr\w+)\b.*\b(colaborador\w*|funcionari\w+|vigilante\w*|empregad\w+|pessoa)\b/, not: /\b(import\w+|planilha|usuari\w+|acesso|login)\b/ },
  { id: 'colab-importar', sector: 'rh', tab: 'colaboradores', steps: [btn('colab-importar')], module: 'colaboradores', say: 'Toque em Escolher arquivo e selecione a planilha de colaboradores: eu reconheço as colunas sozinha.', re: /\b(import\w+|carreg\w+|sub(ir|a|o)|sobe|upload)\b.*\b(planilha|colaborador\w*|funcionari\w+|pessoas)\b/ },
  { id: 'kit-novo', sector: 'rh', tab: 'colaboradores', steps: [btn('colab-kits'), btn('kit-novo')], module: 'colaboradores', say: 'Abrindo um kit novo: diga o que a função recebe e de quanto em quanto tempo troca.', re: /\b(cadastr\w+|cri\w+|nov[oa]|adicion\w+|inclu\w+|mont\w+|defin\w+)\b.*\bkits?\b/ },
  { id: 'conta-senha', sector: '*', tab: 'conta', steps: ['#ac-new'], say: 'Abrindo Minha conta, no campo da senha nova.', re: /\b(troc\w+|mud\w+|alter\w+|redefin\w+|nova|cri\w+|atualiz\w+|esqueci)\b.*\b(minha senha|senha)\b|\bminha senha\b/, not: /\bsenha (d[oa]|de) (?!minha\b)\w+/ },
];

const inSector = (a: UiAction, slug: string | null) => (a.sector === '*' ? true : Array.isArray(a.sector) ? a.sector.includes(slug as SectorSlug) : a.sector === slug);

function pickAction(q: Query): UiAction | null {
  if (asksHow(q.norm) || V.ask.test(q.norm)) return null;
  return UI.find((a) => a.re.test(q.norm) && !(a.not && a.not.test(q.norm))) ?? null;
}

/** em que setor esta ação acontece, a partir de onde a pessoa está */
function whereFor(a: UiAction, host: MaxHost, q: Query): { slug: string; path: string | null } | null {
  const here = host.scope === 'hub' ? 'hub' : host.sector?.slug ?? null;
  if (inSector(a, here)) return { slug: here!, path: null };
  if (a.sector === 'hub') return host.user?.is_master ? { slug: 'hub', path: '/hub' } : null;
  const options = Array.isArray(a.sector) ? a.sector : [a.sector as SectorSlug];
  // "novo pedido da operação": o setor dito na frase decide; senão, o primeiro que a pessoa abre
  const named = options.find((s) => getSector(s)?.aliases.some((al) => q.norm.includes(al)));
  const slug = named ?? options.find((s) => canOpenSector(host.user, s));
  if (!slug || !canOpenSector(host.user, slug)) return null;
  return { slug, path: sectorPath(slug) };
}

const uiAction: Skill = {
  id: 'ui-action',
  scopes: ['hub', 'sector'],
  examples: ['Max, importar a planilha de itens', 'Max, fazer inventário', 'Max, nova solicitação de compra', 'Max, importar o XML da nota', 'Max, novo pedido de admissão', 'Max, cadastrar um colaborador', 'Max, criar um kit'],
  match: (q, host) => {
    const a = pickAction(q);
    if (!a) return 0;
    const w = whereFor(a, host, q);
    if (!w) return 0;
    return w.path ? 0.9 : 0.93;
  },
  run: (q, host) => {
    const a = pickAction(q)!;
    const w = whereFor(a, host, q)!;
    const allowed = !a.module || (w.path ? hasLevel(host.user, w.slug, a.module, 'edit') : host.can(a.module, 'edit'));
    if (!allowed) return { say: `Você não tem permissão para isso${w.path ? ` no setor ${getSector(w.slug)?.name ?? ''}` : ''}. Fale com o master do setor.` };
    return {
      say: w.path ? `Vou até ${w.slug === 'hub' ? 'o Painel master' : `o setor ${getSector(w.slug)?.name}`}. ${a.say}` : a.say,
      act: () => {
        if (w.path) host.navigate(w.path, { spoken: true });
        if (host.press) {
          host.press(tabSel(a.tab), { skipActive: true });
          a.steps.forEach((s, i) => host.press!(s, i < a.steps.length - 1 ? { skipActive: true } : undefined));
        } else host.goTab(a.tab);
      },
    } satisfies MaxReply;
  },
};

/** "abrir o estoque do almoxarifado", "me leva nos fornecedores de compras", "abrir a gestão" (de qualquer tela) */
const goSectorTab: Skill = {
  id: 'go-sector-tab',
  scopes: ['hub', 'sector'],
  examples: ['Max, abrir o estoque do almoxarifado', 'Max, ir para os fornecedores'],
  match: (q, host) => {
    if (!V.open.test(q.norm) || asksHow(q.norm)) return 0;
    const t = targetTab(q, host);
    // abaixo das consultas ("me mostre as métricas de hoje" responde os números), acima do "abrir o setor"
    return t ? 0.89 : 0;
  },
  run: (q, host) => {
    const t = targetTab(q, host)!;
    const name = t.slug === 'hub' ? 'no Painel master' : `no setor ${getSector(t.slug)?.name}`;
    return {
      say: `Abrindo ${t.tab.label} ${name}.`,
      act: () => {
        host.navigate(t.slug === 'hub' ? '/hub' : sectorPath(t.slug as SectorSlug), { spoken: true });
        host.press?.(tabSel(t.tab.id), { skipActive: true });
      },
    };
  },
};

/** aba de OUTRO setor citada na frase (a do setor atual é com o "go-tab") */
function targetTab(q: Query, host: MaxHost): { slug: string; tab: { id: string; label: string } } | null {
  const here = host.scope === 'hub' ? 'hub' : host.sector?.slug ?? null;
  const has = (al: string) => ` ${q.norm} `.includes(` ${al} `);
  // setor dito na frase ("estoque DO ALMOXARIFADO"); sem setor, a aba precisa ser única na plataforma
  const sector = Object.keys(SECTOR_TABS).find((s) => s !== 'hub' && getSector(s)?.aliases.some((al) => has(al)));
  const candidates = Object.entries(SECTOR_TABS)
    .filter(([slug]) => slug !== here && (!sector || slug === sector))
    .flatMap(([slug, tabs]) => tabs.filter((t) => t.id !== 'equipe' || sector).filter((t) => t.aliases.some(has)).map((tab) => ({ slug, tab })));
  if (!candidates.length) return null;
  // a aba existe aqui também? então é o "go-tab" de sempre
  if (!sector && host.tabs.some((t) => candidates.some((c) => c.tab.id === t.id))) return null;
  const pick = sector ? candidates[0] : candidates.length === 1 ? candidates[0] : null;
  if (!pick) return null;
  if (pick.slug === 'hub' ? !host.user?.is_master : !canOpenSector(host.user, pick.slug)) return null;
  return pick;
}

/** "enviar itens para o posto 01" (sem dizer quais): abre o posto e aperta "Enviar itens" */
const postoSend: Skill = {
  id: 'ui-posto-enviar',
  scopes: ['sector'],
  sector: 'almoxarifado',
  examples: ['Max, enviar itens para o Shopping Barra'],
  match: (q, host) => {
    if (!host.almox || !V.send.test(q.norm) || !/\b(itens|material|materiais|coisas|fardamento)\b/.test(q.norm)) return 0;
    const p = findPostoIn(q.norm, host.almox.postos() ?? []);
    // sem quantidade (o número do nome do posto não conta)
    return p && !/\d/.test(q.norm.replace(new RegExp(`\\b${p.name.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').join('|')}\\b`, 'g'), '')) ? 0.93 : 0;
  },
  run: (q, host) => {
    if (!host.can('postos', 'edit') && !host.can('estoque', 'edit')) return { say: 'Você não tem permissão para enviar itens aos postos.' };
    const p = findPostoIn(q.norm, host.almox?.postos() ?? [])!;
    return {
      say: `Abrindo o envio de itens para o ${/^posto\b/i.test(p.name) ? p.name : 'posto ' + p.name}. Escolha os itens e as quantidades.`,
      act: () => {
        host.press?.(tabSel('postos'), { skipActive: true });
        host.press?.(`[data-max-posto="${p.id}"]`, { exec: () => maxEmit('almox:postos', { openId: p.id }) });
        host.press?.(btn('posto-enviar'));
      },
    };
  },
};

export const uiSkills: Skill[] = [uiAction, goSectorTab, postoSend];
export const UI_IDS = uiSkills.map((s) => s.id);
