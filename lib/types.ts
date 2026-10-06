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
