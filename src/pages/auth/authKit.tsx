import type { ReactNode, InputHTMLAttributes } from "react";
import { useId } from "react";

/** Marca WDash  -  quadrado com gradiente + "W" na fonte do tema. */
export function BrandMark({ size = 34, light: _light = false }: { size?: number; light?: boolean }) {
  const uid = useId().replace(/:/g, "");
  const gradId = `wedashGradient-${uid}`;

  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-[10px]"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id={gradId} x1="4" y1="4" x2="36" y2="36" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#B01CFF" />
            <stop offset="0.5" stopColor="#7A3FFF" />
            <stop offset="1" stopColor="#2C9CFF" />
          </linearGradient>
        </defs>
        <rect width="40" height="40" rx="10" fill={`url(#${gradId})`} />
        <text
          x="20"
          y="27"
          textAnchor="middle"
          fill="#FFFFFF"
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: "-0.04em",
          }}
        >
          W
        </text>
      </svg>
    </span>
  );
}

/** Labeled text input styled to match the auth mockups. */
export function AuthInput({
  label,
  hint,
  ...props
}: { label?: ReactNode; hint?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1.5 block text-xs font-semibold text-t1">{label}</span>
      )}
      <input
        {...props}
        className="h-11 w-full rounded-xl border border-line bg-bg-inset px-3.5 text-[13.5px] text-t0 outline-none transition-colors focus:border-acc"
      />
      {hint}
    </label>
  );
}

/** Full-width primary submit button used across auth cards. */
export function AuthButton({
  children,
  onClick,
  variant = "primary",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost";
}) {
  if (variant === "ghost") {
    return (
      <button
        onClick={onClick}
        className="h-11 w-full rounded-xl border border-line bg-transparent text-[13.5px] font-semibold text-t0 transition-colors hover:bg-bg-3"
      >
        {children}
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      className="h-12 w-full rounded-[13px] bg-acc text-[15px] font-bold text-white transition-colors hover:bg-acc-2"
      style={{ boxShadow: "0 8px 24px -8px var(--acc)" }}
    >
      {children}
    </button>
  );
}

/** Decorative radial glow backdrop used behind centered auth cards. */
export function AuthGlow() {
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        background:
          "radial-gradient(50% 50% at 50% 40%,rgba(124,92,255,.14),transparent 70%)",
      }}
    />
  );
}
