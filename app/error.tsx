'use client';
import { Brand } from '@/components/core/Brand';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="center-page">
      <div className="center-card">
        <Brand />
        <h1>Não foi possível abrir esta tela</h1>
        <p>O servidor não respondeu ou o banco de dados está fora do ar. Tente de novo em instantes.</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="btn btn-primary" onClick={() => reset()}>
            Tentar de novo
          </button>
          <a className="btn btn-ghost" href="/">
            Ir para a entrada
          </a>
        </div>
      </div>
    </main>
  );
}
