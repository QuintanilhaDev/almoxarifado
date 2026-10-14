export type FieldType =
  | 'email'
  | 'text'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'number'
  | 'date'
  | 'file';

/** Campos de sistema não podem ser removidos nem mudar de tipo. */
export type SystemKey = 'email' | 'colaborador' | 'posto' | 'anexos';

export interface FormField {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  help?: string;
  placeholder?: string;
  options?: string[];
  system?: SystemKey;
}

export interface Answer {
  fieldId: string;
  label: string;
  type: FieldType;
  value: string | string[] | number;
}

export interface Attachment {
  path: string;
  name: string;
  type: string;
  size: number;
  url?: string;
}

export type RequestStatus = 'nova' | 'pendente' | 'resolvida';

export interface RequestRow {
  id: string;
  protocol: number;
  email: string;
  collaborator: string | null;
  posto: string | null;
  answers: Answer[];
  attachments: Attachment[];
  status: RequestStatus;
  handled_by: string | null;
  created_at: string;
  updated_at: string;
  /** baixas de estoque registradas pelo "Responder" (existe após rodar baixa_e_usuarios.sql) */
  stock_applications?: StockApplication[];
  /** pedido de material criado a partir desta solicitação (Projeto 3) */
  order_id?: string | null;
}

export interface AuthorizedEmail {
  id: string;
  email: string;
  supervisor_name: string | null;
  posto: string | null;
  created_by: string | null;
  created_at: string;
}

/** Pessoa logada (o cadastro de usuários agora é do Max Hub). */
export type { HubUser as AdminUser } from '../permissions';

/** Uma baixa de estoque feita a partir da resposta de uma solicitação. */
export interface StockApplication {
  id: string;
  at: string;
  by: string;
  mode: 'transferencia' | 'saida';
  posto_id: string | null;
  posto_name: string | null;
  note: string | null;
  lines: { item_id: string; name: string; quantity: number }[];
  text: string;
  reverted: boolean;
  reverted_at?: string;
  reverted_by?: string;
}

export const STATUS_LABEL: Record<RequestStatus, string> = {
  nova: 'Novas',
  pendente: 'Pendentes',
  resolvida: 'Resolvidas',
};

export const STATUS_SINGULAR: Record<RequestStatus, string> = {
  nova: 'Nova',
  pendente: 'Pendente',
  resolvida: 'Resolvida',
};

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  email: 'E-mail',
  text: 'Texto curto',
  textarea: 'Texto longo',
  select: 'Lista (uma opção)',
  checkbox: 'Múltipla escolha',
  number: 'Número',
  date: 'Data',
  file: 'Fotos e vídeos',
};

/** Tipos que o usuário pode escolher ao criar/editar uma pergunta. */
export const EDITABLE_TYPES: FieldType[] = ['text', 'textarea', 'select', 'checkbox', 'number', 'date'];

/* ---------- estoque e postos ---------- */
export interface StockItem {
  id: string;
  ref: number;
  name: string;
  size: string | null;
  unit: string;
  /** saldo que está no almoxarifado */
  quantity: number;
  min_quantity: number;
  cost: number | null;
  /** categorias do item (pode ter várias); vazio = sem categoria */
  categories: string[];
  /** soma do que está espalhado pelos postos */
  at_postos: number;
  created_at: string;
  updated_at: string;
  /* ----- Projeto 3 (vazios enquanto o supabase/pedidos_e_notas.sql não for rodado) ----- */
  /** código do catálogo CC-GG-NNNN (imutável) */
  code: string | null;
  cat_code: string | null;
  grp_code: string | null;
  brand: string | null;
  /** certificado de aprovação (EPI) */
  ca_number: string | null;
  location: string | null;
  max_quantity: number | null;
  /** prazo de reposição em dias */
  lead_days: number | null;
  safety_qty: number | null;
  /** reservado para pedidos (não saiu fisicamente) */
  reserved: number;
  active: boolean;
}

export interface Posto {
  id: string;
  name: string;
  code: string | null;
  city: string | null;
  address: string | null;
  supervisor: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  /** quantos itens diferentes e quantas unidades há no posto */
  items_count: number;
  units: number;
}

export interface PostoStockLine {
  item_id: string;
  name: string;
  size: string | null;
  unit: string;
  quantity: number;
}

export type MovementKind =
  | 'entrada'
  | 'saida'
  | 'ajuste'
  | 'transferencia'
  | 'devolucao'
  | 'baixa_posto'
  | 'criacao'
  | 'exclusao'
  /* Projeto 3 */
  | 'entrega'
  | 'estorno'
  | 'perda'
  | 'devolucao_fornecedor'
  | 'inventario'
  | 'devolucao_colaborador';

export interface StockMovement {
  id: string;
  item_id: string | null;
  item_name: string;
  posto_id: string | null;
  posto_name: string | null;
  kind: MovementKind;
  quantity: number;
  before_qty: number | null;
  after_qty: number | null;
  note: string | null;
  by_name: string | null;
  created_at: string;
}

export const MOVEMENT_LABEL: Record<MovementKind, string> = {
  entrada: 'Entrada',
  saida: 'Saída',
  ajuste: 'Ajuste de saldo',
  transferencia: 'Enviado ao posto',
  devolucao: 'Devolvido ao almoxarifado',
  baixa_posto: 'Baixa no posto',
  criacao: 'Item cadastrado',
  exclusao: 'Item excluído',
  entrega: 'Entregue ao colaborador (termo)',
  estorno: 'Estorno de nota fiscal',
  perda: 'Baixa por perda ou avaria',
  devolucao_fornecedor: 'Devolvido ao fornecedor',
  inventario: 'Ajuste de inventário',
  devolucao_colaborador: 'Devolvido pelo colaborador',
};

/** Resultado da leitura de uma planilha (pré-visualização antes de importar). */
export interface ImportPreviewRow {
  data: Record<string, string | number | null>;
  status: 'new' | 'exists' | 'duplicate';
  /** onde a linha está na planilha, ex.: "Folha1, linha 12" */
  source: string;
}
export interface ImportPreview {
  rows: ImportPreviewRow[];
  sheets: {
    name: string;
    headerRow: number | null;
    columns: { letter: string; header: string; field: string | null }[];
    read: number;
  }[];
  ignored: number;
  warnings: string[];
}
