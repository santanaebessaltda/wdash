import { useEffect, useRef } from "react";

type Point3 = { x: number; y: number; z: number };

/** Fundo em accent (rosa). Com `sphere`, desenha a esfera geodésica animada. */
export function JarvisHubBackdrop({ sphere = true }: { sphere?: boolean } = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!sphere) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let angle = 0;
    let w = 0;
    let h = 0;
    let dpr = 1;

    const points = fibonacciSphere(96);
    const edges = nearestEdges(points, 4);

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = parent.clientWidth;
      h = parent.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const accent = () => {
      /* Lê do canvas: no placar --acc vem de [data-board-theme], não do <html>. */
      const raw = getComputedStyle(canvas).getPropertyValue("--acc").trim() || "#14b8a6";
      return raw;
    };

    const draw = () => {
      const color = accent();
      ctx.clearRect(0, 0, w, h);

      // partículas de fundo
      const seed = 17;
      for (let i = 0; i < 48; i++) {
        const px = ((i * 97 + seed * 13) % 1000) / 1000 * w;
        const py = ((i * 53 + seed * 29) % 1000) / 1000 * h;
        const a = 0.08 + ((i * 7) % 10) / 100;
        ctx.fillStyle = withAlpha(color, a);
        ctx.beginPath();
        ctx.arc(px, py, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }

      const cx = w * 0.5;
      const cy = h * 0.42;
      const radius = Math.min(w, h) * 0.28;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      const projected = points.map((p) => {
        const x1 = p.x * cos - p.z * sin;
        const z1 = p.x * sin + p.z * cos;
        const y1 = p.y;
        return {
          x: cx + x1 * radius,
          y: cy + y1 * radius * 0.92,
          z: z1,
          r: 1.4 + (z1 + 1) * 1.2,
        };
      });

      ctx.lineWidth = 1;
      for (const [a, b] of edges) {
        const pa = projected[a];
        const pb = projected[b];
        if (!pa || !pb) continue;
        const depth = (pa.z + pb.z) * 0.5;
        const alpha = 0.08 + Math.max(0, depth + 0.4) * 0.22;
        ctx.strokeStyle = withAlpha(color, alpha);
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }

      for (const p of projected) {
        const alpha = 0.2 + Math.max(0, p.z + 0.5) * 0.55;
        ctx.fillStyle = withAlpha(color, alpha);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // glow suave
      const g = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius * 1.35);
      g.addColorStop(0, withAlpha(color, 0.12));
      g.addColorStop(0.55, withAlpha(color, 0.04));
      g.addColorStop(1, withAlpha(color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 1.35, 0, Math.PI * 2);
      ctx.fill();

      if (!reduceMotion) {
        angle += 0.0035;
        raf = requestAnimationFrame(draw);
      }
    };

    resize();
    draw();
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [sphere]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 50% 42%, color-mix(in srgb, var(--acc) 14%, transparent), transparent 70%), linear-gradient(180deg, color-mix(in srgb, var(--bg-0) 88%, var(--acc) 12%), var(--bg-0))",
        }}
      />
      {sphere ? <canvas ref={canvasRef} className="absolute inset-0 h-full w-full opacity-90" /> : null}
    </div>
  );
}

function fibonacciSphere(n: number): Point3[] {
  const out: Point3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = golden * i;
    out.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r });
  }
  return out;
}

function nearestEdges(points: Point3[], k: number): Array<[number, number]> {
  const edges: Array<[number, number]> = [];
  const seen = new Set<string>();
  for (let i = 0; i < points.length; i++) {
    const dists = points
      .map((p, j) => ({ j, d: i === j ? Infinity : dist2(points[i]!, p) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, k);
    for (const { j } of dists) {
      const a = Math.min(i, j);
      const b = Math.max(i, j);
      const key = `${a}-${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([a, b]);
    }
  }
  return edges;
}

function dist2(a: Point3, b: Point3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  if (color.startsWith("#") && (color.length === 7 || color.length === 4)) {
    const hex = color.length === 4
      ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
      : color;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  return `color-mix(in srgb, ${color} ${Math.round(a * 100)}%, transparent)`;
}
