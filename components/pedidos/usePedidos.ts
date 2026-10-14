'use client';
import { useCallback, useRef, useState } from 'react';
import { api, ApiError } from '../core/api';
import type { MaterialOrder } from '@/lib/pedidos/types';
import type { OrderScope } from '@/lib/pedidos/access';

export interface PurchaseMini {
  status: 'nova' | 'em_cotacao' | 'comprada' | 'entregue' | 'recusada' | 'cancelada';
  number: number;
  expected_date: string | null;
  supplier: string | null;
}
export interface P3ConfigClient {
  routing: boolean;
  tradeAlertDays: number;
  extraResetsCycle: boolean;
  defaultLeadDays: number;
  consumptionDays: number;
}
export interface PedidosData {
  orders: MaterialOrder[];
  purchases: Record<string, PurchaseMini>;
  free: Record<string, number>;
  /** estoque mínimo de cada item (para a sugestão não furar o mínimo) */
  mins?: Record<string, number>;
  config: P3ConfigClient;
}

/**
 * Painel de pedidos de uma área. Percebe pedidos novos e mudanças desde a última consulta
 * (para os avisos em tempo real), juntando chamadas simultâneas em uma só.
 */
export function usePedidos(scope: OrderScope, handlers: { onNew?: (fresh: MaterialOrder[]) => void; onChange?: (changed: { order: MaterialOrder; from: MaterialOrder }[]) => void } = {}) {
  const [data, setData] = useState<PedidosData | null>(null);
  const [failed, setFailed] = useState('');
  const [setup, setSetup] = useState(false);
  const known = useRef<Map<string, MaterialOrder> | null>(null);
  const h = useRef(handlers);
  h.current = handlers;
  const busy = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const reload = useCallback(async (): Promise<void> => {
    if (busy.current) {
      again.current = true;
      return busy.current;
    }
    busy.current = (async () => {
      try {
        const j = await api<PedidosData>(`/api/pedidos?scope=${scope}`);
        const prev = known.current;
        known.current = new Map(j.orders.map((o) => [o.id, o]));
        setData(j);
        setFailed('');
        setSetup(false);
        if (!prev) return;
        const fresh = j.orders.filter((o) => !prev.has(o.id));
        const changed = j.orders.filter((o) => prev.has(o.id) && prev.get(o.id)!.updated_at !== o.updated_at).map((o) => ({ order: o, from: prev.get(o.id)! }));
        if (fresh.length) h.current.onNew?.(fresh);
        if (changed.length) h.current.onChange?.(changed);
      } catch (e) {
        setFailed(e instanceof ApiError ? e.message : 'Sem conexão com o servidor.');
        if (e instanceof ApiError && e.data.setup) setSetup(true);
      } finally {
        busy.current = null;
      }
    })();
    await busy.current;
    if (again.current) {
      again.current = false;
      await reload();
    }
  }, [scope]);

  return { data, failed, setup, reload, setData };
}
