import { Package } from 'lucide-react';

export function Brand({ sub }: { sub?: string }) {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden>
        <Package size={17} strokeWidth={2.4} />
      </span>
      <span>
        Almoxarifado
        {sub ? <small>{sub}</small> : null}
      </span>
    </span>
  );
}
