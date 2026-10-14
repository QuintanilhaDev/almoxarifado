'use client';
import { Printer } from 'lucide-react';

export function PrintButton() {
  return (
    <button className="termo-print" onClick={() => window.print()}>
      <Printer size={16} /> Imprimir ou salvar em PDF
    </button>
  );
}
