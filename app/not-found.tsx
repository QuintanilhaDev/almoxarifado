import { Brand } from '@/components/core/Brand';

export default function NotFound() {
  return (
    <main className="center-page">
      <div className="center-card">
        <Brand />
        <h1>Página não encontrada</h1>
        <p>O endereço pode ter mudado. O Max Hub agora começa pela tela de entrada.</p>
        <a className="btn btn-primary" href="/">
          Ir para a entrada
        </a>
      </div>
    </main>
  );
}
