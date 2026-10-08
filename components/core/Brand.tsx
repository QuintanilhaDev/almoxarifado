/** Marca do Max Hub: a esfera da Max dentro do selo lilás. */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <span className="brand-mark" aria-hidden style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }}>
      <svg viewBox="0 0 24 24" width={size * 0.66} height={size * 0.66}>
        <circle cx="10.6" cy="13.4" r="7.4" fill="currentColor" />
        <circle cx="19.4" cy="5.4" r="2.9" fill="currentColor" />
      </svg>
    </span>
  );
}

export function Brand({ sub }: { sub?: string }) {
  return (
    <span className="brand">
      <BrandMark />
      <span>
        Max Hub
        {sub ? <small>{sub}</small> : null}
      </span>
    </span>
  );
}
