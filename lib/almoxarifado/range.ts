/** Resposta de /api/almoxarifado/metrics/range (movimentação em um intervalo qualquer). */
export interface RangeData {
  from: string;
  to: string;
  totals: {
    /** unidades */
    in: number;
    out: number;
    /** registros de movimentação */
    inMoves: number;
    outMoves: number;
    /** itens diferentes */
    itemsIn: number;
    itemsOut: number;
    toPostos: number;
    returned: number;
    consumed: number;
    adjustments: number;
  };
  items: { name: string; in: number; out: number }[];
  postos: { name: string; received: number }[];
  requests: { total: number; nova: number; pendente: number; resolvida: number };
  truncated: boolean;
}
