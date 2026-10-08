/**
 * Setores do Max Hub.
 * Para criar um setor novo: acrescente uma entrada aqui. Ele ganha, sozinho, a tela
 * padrão (/setor/<slug>), a aba Equipe, as permissões e a assistente Max.
 */
export type SectorSlug = 'almoxarifado' | 'rh' | 'operacional' | 'financeiro' | 'comercial';

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
    aliases: ['almoxarifado', 'almox', 'estoque', 'fardamento'],
    modules: [
      { id: 'solicitacoes', label: 'Solicitações', hint: 'Mudar status, responder e apagar pedidos' },
      { id: 'estoque', label: 'Estoque', hint: 'Cadastrar itens, entradas, saídas e ajustes' },
      { id: 'postos', label: 'Postos', hint: 'Cadastrar postos e movimentar o que está neles' },
      { id: 'metricas', label: 'Métricas', hint: 'Só leitura: ver e baixar os relatórios' },
      { id: 'formulario', label: 'Formulário', hint: 'Alterar as perguntas do formulário dos supervisores' },
      { id: 'emails', label: 'E-mails autorizados', hint: 'Liberar e remover e-mails de supervisores' },
    ],
  },
  {
    slug: 'rh',
    name: 'Recursos Humanos',
    short: 'RH',
    description: 'Admissões, colaboradores, férias e documentos.',
    ready: false,
    aliases: ['recursos humanos', 'rh', 'pessoal', 'departamento pessoal'],
    modules: [],
  },
  {
    slug: 'operacional',
    name: 'Operacional',
    short: 'Operacional',
    description: 'Escalas, postos de serviço, ocorrências e supervisão.',
    ready: false,
    aliases: ['operacional', 'operacoes', 'operacao'],
    modules: [],
  },
  {
    slug: 'financeiro',
    name: 'Financeiro',
    short: 'Financeiro',
    description: 'Contas a pagar e a receber, faturamento e fluxo de caixa.',
    ready: false,
    aliases: ['financeiro', 'financas', 'contas'],
    modules: [],
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
];

export const SECTOR_SLUGS = SECTORS.map((s) => s.slug);

export function isSectorSlug(v: unknown): v is SectorSlug {
  return typeof v === 'string' && (SECTOR_SLUGS as string[]).includes(v);
}

export function getSector(slug: string | null | undefined): SectorDef | null {
  return SECTORS.find((s) => s.slug === slug) ?? null;
}

export const sectorPath = (slug: string) => `/setor/${slug}`;
