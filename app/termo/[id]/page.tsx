import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { db } from '@/lib/supabaseAdmin';
import { currentUser } from '@/lib/auth';
import { almoxOrders, colabAccess, rhOrders } from '@/lib/pedidos/access';
import { ORIGIN_LABEL, orderLabel, type OrderOrigin } from '@/lib/pedidos/types';
import { PrintButton } from '@/components/pedidos/PrintButton';
import './termo.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Termo de entrega · Max Hub' };
type Props = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Row {
  item_name: string;
  size: string | null;
  item_code: string | null;
  ca_number: string | null;
  qty: number;
  returned_qty: number;
  collaborator_name: string | null;
  matricula: string | null;
  role: string | null;
  posto_name: string | null;
  order_number: number | null;
  origin: OrderOrigin | null;
  receiver: string | null;
  by_name: string | null;
  delivered_at: string;
}

/** Termo de entrega (fardamento e EPI): uma entrega = um termo, pronto para imprimir e assinar. */
export default async function TermoPage({ params }: Props) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const user = await currentUser();
  if (!user) redirect('/');
  if (!almoxOrders(user) && !rhOrders(user) && !colabAccess(user)) notFound();
  const { data } = await db().from('deliveries').select('item_name, size, item_code, ca_number, qty, returned_qty, collaborator_name, matricula, role, posto_name, order_number, origin, receiver, by_name, delivered_at').eq('group_id', id).order('item_name');
  const rows = (data ?? []) as Row[];
  if (!rows.length) notFound();
  const h = rows[0];
  const when = new Date(h.delivered_at);
  const date = when.toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' });
  const time = when.toLocaleTimeString('pt-BR', { timeZone: 'America/Bahia', hour: '2-digit', minute: '2-digit' });
  const hasEpi = rows.some((r) => r.ca_number);
  return (
    <main className="termo">
      <div className="termo-bar">
        <PrintButton />
      </div>
      <article className="termo-page">
        <header>
          <div>
            <strong>GRUPO MAX FORTE</strong>
            <span>Almoxarifado · Salvador/BA</span>
          </div>
          <div className="termo-id">
            <span>Termo nº</span>
            <b>{id.slice(0, 8).toUpperCase()}</b>
          </div>
        </header>
        <h1>Termo de entrega de {hasEpi ? 'EPI e fardamento' : 'fardamento e materiais'}</h1>
        <dl className="termo-who">
          <div><dt>Colaborador</dt><dd>{h.collaborator_name ?? h.receiver ?? '—'}</dd></div>
          <div><dt>Matrícula</dt><dd>{h.matricula ?? '—'}</dd></div>
          <div><dt>Função</dt><dd>{h.role ?? '—'}</dd></div>
          <div><dt>Posto</dt><dd>{h.posto_name ?? '—'}</dd></div>
          <div><dt>Pedido</dt><dd>{h.order_number ? `${orderLabel(h.order_number)}${h.origin ? ' · ' + ORIGIN_LABEL[h.origin] : ''}` : '—'}</dd></div>
          <div><dt>Data da entrega</dt><dd>{date} às {time}</dd></div>
        </dl>
        <table>
          <thead>
            <tr><th>Código</th><th>Item</th><th>Tam.</th><th>CA</th><th className="n">Qtd.</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.item_code ?? '—'}</td>
                <td>{r.item_name}{r.returned_qty ? <small> (devolvido: {r.returned_qty})</small> : null}</td>
                <td>{r.size ?? '—'}</td>
                <td>{r.ca_number ?? '—'}</td>
                <td className="n">{r.qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="termo-text">
          Declaro que recebi os itens acima, novos e em perfeito estado, para uso exclusivo no trabalho. Comprometo-me a usá-los apenas para a finalidade a
          que se destinam, a zelar pela sua guarda e conservação, a comunicar qualquer dano, extravio ou alteração que os torne impróprios para o uso e a
          devolvê-los quando solicitado ou no desligamento{hasEpi ? ', conforme a NR-6 (Equipamento de Proteção Individual)' : ''}.
        </p>
        <div className="termo-sign">
          <div><span /> <small>{h.receiver ?? h.collaborator_name ?? 'Colaborador'}</small><small>Recebedor</small></div>
          <div><span /> <small>{h.by_name ?? 'Almoxarifado'}</small><small>Entregue por</small></div>
        </div>
        <footer>Gerado pelo Max Hub em {new Date().toLocaleString('pt-BR', { timeZone: 'America/Bahia' })}</footer>
      </article>
    </main>
  );
}
