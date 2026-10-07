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
}

export interface AuthorizedEmail {
  id: string;
  email: string;
  supervisor_name: string | null;
  posto: string | null;
  created_by: string | null;
  created_at: string;
}

export interface AdminUser {
  id: string;
  username: string;
  display_name: string;
  /** usuário master: pode criar usuários e trocar senhas */
  is_master?: boolean;
}

/** Linha da lista de usuários (só o master vê). */
export interface AdminListItem {
  id: string;
  username: string;
  display_name: string;
  is_master: boolean;
  created_at: string;
}

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
  /** soma do que está espalhado pelos postos */
  at_postos: number;
  created_at: string;
  updated_at: string;
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
  | 'exclusao';

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
