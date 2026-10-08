import { Alert, Card } from "@/components/ui";

/** Avisos explicando blocos ocultos. Nunca silencioso: quem tira print entende o que falta. */
export function Avisos({ itens }: { itens: string[] }) {
  if (itens.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {itens.map((a) => (
        <Alert key={a} variant="info">
          {a}
        </Alert>
      ))}
    </div>
  );
}

/** Leitura da IA no topo da visao. So renderiza quando ha algo a dizer. */
export function LeituraIA({ texto }: { texto: string | null }) {
  if (!texto) return null;
  return (
    <Card padding="sm" className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(120% 120% at 0% 0%, var(--acc-soft), transparent 55%)" }} />
      <div className="relative flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-acc text-white">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m13 2-3 7h6l-3 7" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-t2">Leitura</p>
          <p className="mt-0.5 text-[13.5px] leading-relaxed text-t0">{texto}</p>
        </div>
      </div>
    </Card>
  );
}
