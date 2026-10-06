'use client';
import { Check, ChevronDown } from 'lucide-react';
import type { FormField } from '@/lib/types';

interface Props {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
  inputId: string;
}

/** Renderiza um campo do formulário (exceto anexos). */
export function FieldInput({ field, value, onChange, inputId }: Props) {
  switch (field.type) {
    case 'textarea':
      return (
        <textarea
          id={inputId}
          className="textarea"
          value={String(value ?? '')}
          placeholder={field.placeholder}
          maxLength={5000}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'select':
      return (
        <div className="select-wrap">
          <select id={inputId} className="select" data-empty={!value ? '' : undefined} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
            <option value="" disabled>
              Escolha uma opção
            </option>
            {(field.options || []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <ChevronDown size={18} />
        </div>
      );
    case 'checkbox': {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="chips" role="group" aria-labelledby={inputId + '-label'} id={inputId}>
          {(field.options || []).map((o) => {
            const on = arr.includes(o);
            return (
              <button
                type="button"
                key={o}
                className="chip"
                aria-pressed={on}
                onClick={() => onChange(on ? arr.filter((x) => x !== o) : [...arr, o])}
              >
                {on ? (
                  <span className="tick">
                    <Check size={15} strokeWidth={3} />
                  </span>
                ) : null}
                {o}
              </button>
            );
          })}
        </div>
      );
    }
    case 'number':
      return (
        <input
          id={inputId}
          className="input"
          type="number"
          inputMode="numeric"
          min={0}
          step="any"
          value={String(value ?? '')}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          onWheel={(e) => (e.target as HTMLInputElement).blur()}
        />
      );
    case 'date':
      return (
        <input id={inputId} className="input" type="date" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
      );
    case 'email':
      return (
        <input
          id={inputId}
          className="input"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          value={String(value ?? '')}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    default:
      return (
        <input
          id={inputId}
          className="input"
          type="text"
          value={String(value ?? '')}
          placeholder={field.placeholder}
          maxLength={500}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
