'use client';
import { LEVELS, LEVEL_LABEL, fullPermissions, type Level, type Permissions } from '@/lib/permissions';
import { getSector } from '@/lib/sectors';

/** Tabela "módulo × nível" para escolher o que a pessoa vê e altera em um setor. */
export function PermissionsEditor({
  sector,
  value,
  onChange,
  disabled,
}: {
  sector: string;
  value: Permissions;
  onChange: (p: Permissions) => void;
  disabled?: boolean;
}) {
  const def = getSector(sector);
  if (!def) return null;
  if (!def.modules.length) {
    return <p className="perm-none">A ferramenta de {def.name} ainda não tem módulos. Quando ganhar funções, as permissões aparecem aqui.</p>;
  }
  const set = (id: string, level: Level) => onChange({ ...value, [id]: level });
  return (
    <div className="perm">
      <div className="perm-presets">
        <span>Preencher tudo:</span>
        {LEVELS.map((l) => (
          <button key={l} type="button" className="chip-btn" disabled={disabled} onClick={() => onChange(fullPermissions(sector, l))}>
            {LEVEL_LABEL[l]}
          </button>
        ))}
      </div>
      {def.modules.map((m) => {
        const cur = value[m.id] ?? 'none';
        return (
          <div className="perm-row" key={m.id}>
            <div className="perm-name">
              <b>{m.label}</b>
              <small>{m.hint}</small>
            </div>
            <div className="perm-seg" role="radiogroup" aria-label={`Permissão em ${m.label}`}>
              {LEVELS.map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={cur === l}
                  className={`perm-opt ${l}${cur === l ? ' is-active' : ''}`}
                  disabled={disabled}
                  onClick={() => set(m.id, l)}
                >
                  {LEVEL_LABEL[l]}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** "Edita 3 · visualiza 2 · sem acesso 1" */
export function permissionSummary(sector: string | null, p: Permissions): string {
  const def = getSector(sector);
  if (!def || !def.modules.length) return 'Sem módulos com permissão ainda';
  let edit = 0;
  let view = 0;
  for (const m of def.modules) {
    if (p[m.id] === 'edit') edit++;
    else if (p[m.id] === 'view') view++;
  }
  const none = def.modules.length - edit - view;
  if (edit === def.modules.length) return 'Edita tudo';
  if (view === def.modules.length) return 'Só visualiza tudo';
  if (none === def.modules.length) return 'Sem acesso a nenhum módulo';
  return [edit ? `edita ${edit}` : '', view ? `visualiza ${view}` : '', none ? `sem acesso a ${none}` : '']
    .filter(Boolean)
    .join(' · ')
    .replace(/^./, (c) => c.toUpperCase());
}
