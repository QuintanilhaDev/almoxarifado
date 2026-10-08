import type { Answer, FormField } from './types';
import { EMAIL_RE } from '../format';

export type RawValues = Record<string, unknown>;

/** Valida as respostas contra a configuração atual do formulário. */
export function validateAnswers(fields: FormField[], values: RawValues, hasFiles: boolean) {
  const errors: Record<string, string> = {};
  const answers: Answer[] = [];

  for (const f of fields) {
    if (f.type === 'file') {
      if (f.required && !hasFiles) errors[f.id] = 'Anexe pelo menos um arquivo.';
      continue;
    }
    const raw = values[f.id];
    let value: string | string[] | number | null = null;

    if (f.type === 'checkbox') {
      const arr = Array.isArray(raw) ? raw.map(String).filter((x) => (f.options || []).includes(x)) : [];
      value = arr;
      if (f.required && arr.length === 0) errors[f.id] = 'Escolha pelo menos uma opção.';
    } else if (f.type === 'number') {
      const s = String(raw ?? '').trim();
      if (s === '') {
        if (f.required) errors[f.id] = 'Preencha este campo.';
      } else {
        const n = Number(s.replace(',', '.'));
        if (!Number.isFinite(n)) errors[f.id] = 'Digite um número válido.';
        else if (n < 0) errors[f.id] = 'O número não pode ser negativo.';
        else value = n;
      }
    } else {
      const s = String(raw ?? '').trim().slice(0, 5000);
      if (s === '') {
        if (f.required) errors[f.id] = f.type === 'select' ? 'Escolha uma opção.' : 'Preencha este campo.';
      } else if (f.type === 'email' && !EMAIL_RE.test(s)) {
        errors[f.id] = 'Digite um e-mail válido.';
      } else if (f.type === 'select' && !(f.options || []).includes(s)) {
        errors[f.id] = 'Escolha uma opção da lista.';
      } else if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        errors[f.id] = 'Data inválida.';
      } else {
        value = f.type === 'email' ? s.toLowerCase() : s;
      }
    }

    if (value !== null && !(Array.isArray(value) && value.length === 0)) {
      answers.push({ fieldId: f.id, label: f.label, type: f.type, value });
    }
  }
  return { errors, answers, ok: Object.keys(errors).length === 0 };
}

const SYSTEM_TYPES: Record<string, FormField['type']> = {
  email: 'email',
  colaborador: 'text',
  posto: 'select',
  anexos: 'file',
};

/** Normaliza e valida uma configuração de formulário enviada pelo painel. */
export function sanitizeFields(input: unknown): { fields?: FormField[]; error?: string } {
  if (!Array.isArray(input)) return { error: 'Formato inválido.' };
  const out: FormField[] = [];
  const seen = new Set<string>();
  const seenSystem = new Set<string>();
  const allowed = ['email', 'text', 'textarea', 'select', 'checkbox', 'number', 'date', 'file'];
  for (const raw of input as Record<string, unknown>[]) {
    if (!raw || typeof raw !== 'object') return { error: 'Pergunta inválida.' };
    const id = String(raw.id || '').trim().slice(0, 60);
    if (!id || seen.has(id)) return { error: 'Há perguntas duplicadas.' };
    seen.add(id);
    const system = raw.system ? (String(raw.system) as FormField['system']) : undefined;
    if (system && !SYSTEM_TYPES[system]) return { error: 'Campo fixo inválido.' };
    if (system && seenSystem.has(system)) return { error: 'Campo fixo repetido.' };
    if (system) seenSystem.add(system);
    // campos fixos sempre mantêm o tipo original
    const type = (system ? SYSTEM_TYPES[system] : String(raw.type)) as FormField['type'];
    if (!allowed.includes(type)) return { error: 'Tipo de pergunta inválido.' };
    const label = String(raw.label || '').trim().slice(0, 200);
    if (!label) return { error: 'Toda pergunta precisa de um título.' };
    const field: FormField = {
      id,
      label,
      type,
      required: Boolean(raw.required),
      help: raw.help ? String(raw.help).slice(0, 300) : undefined,
      placeholder: raw.placeholder ? String(raw.placeholder).slice(0, 200) : undefined,
      system,
    };
    if (type === 'select' || type === 'checkbox') {
      const opts = Array.isArray(raw.options)
        ? Array.from(new Set((raw.options as unknown[]).map((o) => String(o).trim().slice(0, 120)).filter(Boolean)))
        : [];
      if (opts.length === 0) return { error: `A pergunta "${label}" precisa de pelo menos uma opção.` };
      field.options = opts;
    }
    if (system === 'email') field.required = true;
    if (type === 'email' && system !== 'email') return { error: 'Só pode existir um campo de e-mail executivo.' };
    if (type === 'file' && system !== 'anexos') return { error: 'Só pode existir um campo de anexos.' };
    out.push(field);
  }
  for (const k of ['email', 'colaborador', 'posto', 'anexos'] as const) {
    if (!out.some((f) => f.system === k)) return { error: 'Campos fixos não podem ser removidos.' };
  }
  if (out.length > 60) return { error: 'Limite de 60 perguntas.' };
  return { fields: out };
}
