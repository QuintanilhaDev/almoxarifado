'use client';
import { DatabaseZap } from 'lucide-react';

/** Aparece quando as tabelas de estoque ainda não existem no Supabase (ou o banco não responde). */
export function LoadError({ what }: { what: string }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <DatabaseZap size={24} />
      </span>
      <strong>Não foi possível carregar {what}</strong>
      <span>
        Confira se o arquivo <b>supabase/estoque.sql</b> foi executado no SQL Editor do Supabase e recarregue a página.
      </span>
    </div>
  );
}
