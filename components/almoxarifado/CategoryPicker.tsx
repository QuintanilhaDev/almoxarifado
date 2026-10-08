'use client';
import { Check, Plus } from 'lucide-react';
import { useState } from 'react';
import { MAX_CATEGORIES, MAX_CATEGORY_LEN, canonCategory, categoryKey, sortCategories } from '@/lib/almoxarifado/categories';

/**
 * Escolha de categorias de um item. Dá para marcar várias (um cinto pode ser
 * "Acessório" e "Max Forte" ao mesmo tempo) e criar uma categoria nova.
 */
export function CategoryPicker({
  value,
  options,
  onChange,
  disabled,
  idPrefix = 'cat',
}: {
  value: string[];
  options: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const [draft, setDraft] = useState('');
  const keys = new Set(value.map(categoryKey));
  // as opções + o que o item já tem (mesmo que ninguém mais use)
  const all = sortCategories([...new Set([...options, ...value])]);
  const full = value.length >= MAX_CATEGORIES;

  const toggle = (c: string) => {
    const k = categoryKey(c);
    if (keys.has(k)) onChange(value.filter((v) => categoryKey(v) !== k));
    else if (!full) onChange(sortCategories([...value, c]));
  };
  const add = () => {
    const c = canonCategory(draft);
    setDraft('');
    if (!c || keys.has(categoryKey(c)) || full) return;
    // se já existe uma igual (com outra grafia), usa a que existe
    const same = all.find((o) => categoryKey(o) === categoryKey(c));
    onChange(sortCategories([...value, same ?? c]));
  };

  return (
    <div className="cat-picker">
      <div className="cat-chips" role="group" aria-label="Categorias">
        {all.map((c) => {
          const on = keys.has(categoryKey(c));
          return (
            <button
              key={c}
              type="button"
              className={`cat-chip${on ? ' is-on' : ''}`}
              aria-pressed={on}
              disabled={disabled || (!on && full)}
              onClick={() => toggle(c)}
            >
              {on ? <Check size={13} /> : null}
              {c}
            </button>
          );
        })}
      </div>
      <div className="cat-new">
        <input
          id={`${idPrefix}-new`}
          className="input"
          placeholder="Nova categoria"
          aria-label="Nova categoria"
          value={draft}
          maxLength={MAX_CATEGORY_LEN}
          disabled={disabled || full}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault(); // não envia o formulário
              add();
            }
          }}
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={add} disabled={disabled || full || !draft.trim()}>
          <Plus size={15} /> Adicionar
        </button>
      </div>
    </div>
  );
}
