import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { str } from '@/lib/almoxarifado/stockData';
import { canManageSector } from '@/lib/permissions';
import { canSeeOrders, loadConfig, money, saveConfig } from '@/lib/compras/pcServer';
import { brl } from '@/lib/compras/pc';

export const dynamic = 'force-dynamic';

/** Regras de Compras (alçada de aprovação, local de entrega, dados da empresa nos documentos). */
export async function GET() {
  try {
    const user = await requireUser();
    if (!canSeeOrders(user)) throw new AccessError(403, 'Sem acesso.');
    return NextResponse.json({ config: await loadConfig(), canEdit: canManageSector(user, 'compras') });
  } catch (e) {
    return serverError(e);
  }
}

/** Só o master geral ou o master do setor Compras mudam as regras. */
export async function PUT(req: Request) {
  const b = await readJson<Record<string, unknown>>(req);
  if (!b) return fail('Dados inválidos.');
  try {
    const user = await requireUser();
    if (!canManageSector(user, 'compras')) throw new AccessError(403, 'Só o master geral ou o master de Compras mudam as regras.');
    const cur = await loadConfig();
    const min = money(b.approval_min, 1e8);
    if ('approval_min' in b && min === null) return fail('Valor da alçada inválido.');
    const days = Number(b.quote_valid_days);
    const tol = money(b.price_tolerance, 1000);
    const c = (b.company ?? {}) as Record<string, unknown>;
    const next = {
      ...cur,
      approval_min: min ?? cur.approval_min,
      delivery_location: str(b.delivery_location, 160) ?? cur.delivery_location,
      quote_valid_days: Number.isInteger(days) && days >= 1 && days <= 90 ? days : cur.quote_valid_days,
      price_tolerance: tol ?? cur.price_tolerance,
      company: {
        name: str(c.name, 120) ?? cur.company.name,
        cnpj: str(c.cnpj, 20) ?? cur.company.cnpj,
        address: str(c.address, 200) ?? cur.company.address,
        phone: str(c.phone, 40) ?? cur.company.phone,
        email: str(c.email, 120) ?? cur.company.email,
      },
    };
    await saveConfig(next);
    return NextResponse.json({ config: next, note: next.approval_min > 0 ? `Pedidos abaixo de ${brl(next.approval_min)} são aprovados sozinhos.` : 'Todo pedido passa por aprovação.' });
  } catch (e) {
    return serverError(e);
  }
}
