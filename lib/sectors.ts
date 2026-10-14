/**
 * Setores do Max Hub.
 * Para criar um setor novo: acrescente uma entrada aqui. Ele ganha, sozinho, a tela
 * padrão (/setor/<slug>), a aba Equipe, as permissões e a assistente Max.
 */
export type SectorSlug = 'almoxarifado' | 'rh' | 'operacional' | 'financeiro' | 'comercial' | 'compras';

export interface SectorModule {
  /** id usado nas permissões (não mude depois de criado) */
  id: string;
  label: string;
  /** o que "editar" significa neste módulo, mostrado no editor de permissões */
  hint: string;
}

export interface SectorDef {
  slug: SectorSlug;
  name: string;
  /** nome curto para menus apertados */
  short: string;
  description: string;
  /** partes da ferramenta que aceitam permissão por pessoa */
  modules: SectorModule[];
  /** false = a ferramenta ainda é só a tela padrão, sem funções */
  ready: boolean;
  /** o setor tem métricas (tela de Métricas, gráfico e planilha para baixar) */
  metrics?: boolean;
  /** como as pessoas costumam chamar o setor (usado pela Max) */
  aliases: string[];
}

export const SECTORS: SectorDef[] = [
  {
    slug: 'almoxarifado',
    name: 'Almoxarifado',
    short: 'Almoxarifado',
    description: 'Solicitações dos postos, estoque de fardamento e EPIs, postos e métricas.',
    ready: true,
    metrics: true,
    aliases: ['almoxarifado', 'almox', 'estoque', 'fardamento'],
    modules: [
      { id: 'solicitacoes', label: 'Solicitações', hint: 'Mudar status, responder e apagar pedidos' },
      { id: 'estoque', label: 'Estoque', hint: 'Cadastrar itens, entradas, saídas e ajustes' },
      { id: 'postos', label: 'Postos', hint: 'Cadastrar postos e movimentar o que está neles' },
      { id: 'metricas', label: 'Métricas', hint: 'Só leitura: ver e baixar os relatórios' },
      { id: 'formulario', label: 'Formulário', hint: 'Alterar as perguntas do formulário dos supervisores' },
      { id: 'emails', label: 'E-mails autorizados', hint: 'Liberar e remover e-mails de supervisores' },
      { id: 'compras', label: 'Compras', hint: 'Pedir compras ao setor de Compras e cancelar pedidos ainda novos' },
      { id: 'pedidos', label: 'Pedidos de material', hint: 'Reservar, entregar (com termo) e acompanhar os pedidos da Operação e do RH/DP' },
      { id: 'notas', label: 'Entradas (notas fiscais)', hint: 'Lançar notas, conferir o recebimento e estornar' },
    ],
  },
  {
    slug: 'rh',
    name: 'Recursos Humanos',
    short: 'RH',
    description: 'Admissões, colaboradores, kits de fardamento e troca anual.',
    ready: true,
    aliases: ['recursos humanos', 'rh', 'pessoal', 'departamento pessoal', 'dp', 'rh dp'],
    modules: [
      { id: 'pedidos', label: 'Pedidos (admissões e trocas)', hint: 'Pedir kits de admissão e trocas de fardamento ao Almoxarifado' },
      { id: 'colaboradores', label: 'Colaboradores', hint: 'Cadastrar colaboradores, tamanhos e kits por função' },
    ],
  },
  {
    slug: 'operacional',
    name: 'Operacional',
    short: 'Operacional',
    description: 'Pedidos de material dos postos, validação de trocas e supervisão.',
    ready: true,
    aliases: ['operacional', 'operacoes', 'operacao'],
    modules: [{ id: 'pedidos', label: 'Pedidos de material', hint: 'Conferir, encaminhar ao Almoxarifado e validar trocas' }],
  },
  {
    slug: 'financeiro',
    name: 'Financeiro',
    short: 'Financeiro',
    description: 'Notas fiscais de compra, parcelas e vencimentos.',
    ready: true,
    aliases: ['financeiro', 'financas', 'contas'],
    modules: [{ id: 'notas', label: 'Notas e vencimentos', hint: 'Consultar notas fiscais, parcelas e vencimentos (o recebimento não aprova o pagamento)' }],
  },
  {
    slug: 'comercial',
    name: 'Comercial',
    short: 'Comercial',
    description: 'Propostas, contratos, clientes e oportunidades.',
    ready: false,
    aliases: ['comercial', 'vendas', 'contratos'],
    modules: [],
  },
  {
    slug: 'compras',
    name: 'Compras',
    short: 'Compras',
    description: 'Pedidos de compra, cotações, fornecedores e acompanhamento das entregas.',
    ready: true,
    aliases: ['compras', 'setor de compras', 'suprimentos', 'aquisicoes', 'cotacoes'],
    modules: [{ id: 'solicitacoes', label: 'Solicitações', hint: 'Mudar o andamento e responder os pedidos de compra' }],
  },
];

export const SECTOR_SLUGS = SECTORS.map((s) => s.slug);

export function isSectorSlug(v: unknown): v is SectorSlug {
  return typeof v === 'string' && (SECTOR_SLUGS as string[]).includes(v);
}

export function getSector(slug: string | null | undefined): SectorDef | null {
  return SECTORS.find((s) => s.slug === slug) ?? null;
}

export const sectorPath = (slug: string) => `/setor/${slug}`;
