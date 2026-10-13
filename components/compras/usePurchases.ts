'use client';
import { useCallback, useRef, useState } from 'react';
import { api, ApiError } from '../core/api';
import type { PurchaseRequest, PurchaseStatus } from '@/lib/compras/types';

export interface PurchaseChange {
  req: PurchaseRequest;
  from: PurchaseStatus;
}

/**
 * Carrega as solicitações de compra e percebe o que mudou desde a última vez
 * (pedido novo, andamento novo, resposta nova). Serve para os avisos em tempo real:
 * chega pelo Supabase Realtime e, se ele falhar, pela consulta a cada poucos segundos.
 */
export function usePurchases(handlers: { onNew?: (fresh: PurchaseRequest[]) => void; onChange?: (changes: PurchaseChange[]) => void }) {
  const [requests, setRequests] = useState<PurchaseRequest[] | null>(null);
  const [failed, setFailed] = useState('');
  const known = useRef<Map<string, { status: PurchaseStatus; updated: string }> | null>(null);
  const h = useRef(handlers);
  h.current = handlers;
  const busy = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const reload = useCallback(async (): Promise<void> => {
    // pedidos ao mesmo tempo (aviso em tempo real + consulta periódica) viram um só;
    // se chegar um aviso no meio de uma consulta, consulta de novo no fim (para não perder a mudança)
    if (busy.current) {
      again.current = true;
      return busy.current;
    }
    busy.current = (async () => {
      try {
        const j = await api<{ requests: PurchaseRequest[] }>('/api/compras/requests');
        const prev = known.current;
        const next = new Map(j.requests.map((r) => [r.id, { status: r.status, updated: r.updated_at }]));
        known.current = next;
        setRequests(j.requests);
        setFailed('');
        if (!prev) return; // primeira carga: só guarda o retrato
        const fresh = j.requests.filter((r) => !prev.has(r.id));
        const changes = j.requests.filter((r) => prev.has(r.id) && prev.get(r.id)!.updated !== r.updated_at).map((r) => ({ req: r, from: prev.get(r.id)!.status }));
        if (fresh.length) h.current.onNew?.(fresh);
        if (changes.length) h.current.onChange?.(changes);
      } catch (e) {
        setFailed(e instanceof ApiError ? e.message : 'Sem conexão com o servidor.');
      } finally {
        busy.current = null;
      }
    })();
    const run = busy.current;
    await run;
    if (again.current) {
      again.current = false;
      await reload();
    }
  }, []);

  return { requests, failed, reload, setRequests };
}
