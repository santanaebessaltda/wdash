import type { ReactNode } from "react";
import { Card } from "@/components/ui";
import { PersonAvatar } from "@/components/wedash/PersonAvatar";
import { BrandMark } from "@/pages/auth/authKit";
import { TargetIcon, TrophyIcon } from "@/pages/dashboards/icons";
import { cn } from "@/lib/cn";
import type { BoardMoment } from "@/data/wedash/boardEvents";

export type CelebrationFace = { name: string; employeeId: string; storeId: string };

const SPARKS = [
  { x: "-42px", y: "-18px" },
  { x: "46px", y: "-26px" },
  { x: "-34px", y: "34px" },
  { x: "38px", y: "30px" },
  { x: "2px", y: "-48px" },
  { x: "16px", y: "46px" },
];

const SCENE_STYLE = `
@keyframes board-scene-in{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:none}}
@keyframes board-scene-out{to{opacity:0;transform:scale(.96) translateY(8px)}}
@keyframes board-dim-in{from{opacity:0}to{opacity:1}}
@keyframes board-dim-out{to{opacity:0}}
@keyframes board-avatar-pop{0%{opacity:0;transform:scale(.8)}55%{opacity:1;transform:scale(1.08)}100%{opacity:1;transform:scale(1)}}
@keyframes board-crown{0%{opacity:0;transform:translate(-50%,-150%) scale(.55)}62%{opacity:1;transform:translate(-50%,-78%) scale(1.14)}100%{opacity:1;transform:translate(-50%,-78%) scale(1)}}
@keyframes board-glow-burst{0%{opacity:0;transform:scale(.45)}35%{opacity:.85}100%{opacity:0;transform:scale(1.45)}}
@keyframes board-copy-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@keyframes board-spark{0%{opacity:0;transform:translate(-50%,-50%) scale(.4)}22%{opacity:1}100%{opacity:0;transform:translate(calc(-50% + var(--sx)),calc(-50% + var(--sy))) scale(1)}}
@keyframes board-trophy{0%{opacity:0;transform:rotate(-16deg) scale(.7)}60%{opacity:1;transform:rotate(7deg) scale(1.06)}100%{opacity:1;transform:rotate(0) scale(1)}}
@keyframes board-shine{0%{opacity:0;transform:translateX(-50%)}40%{opacity:.7}100%{opacity:0;transform:translateX(50%)}}
@keyframes board-rise{0%{opacity:0;transform:translateY(12px)}45%{opacity:1}100%{opacity:1;transform:translateY(-8px)}}
@keyframes board-ring{0%{opacity:.75;transform:scale(.55)}100%{opacity:0;transform:scale(1.7)}}
@keyframes board-row-flash{0%,100%{filter:brightness(1)}40%{filter:brightness(1.4)}}
.board-scene{animation:board-scene-in .36s ease both}
.board-scene-out{animation:board-scene-out .3s ease forwards}
.board-dim{animation:board-dim-in .3s ease both}
.board-dim-out{animation:board-dim-out .3s ease forwards}
.board-avatar-pop{animation:board-avatar-pop .38s ease both}
.board-crown{animation:board-crown .42s cubic-bezier(.2,1.4,.4,1) .1s both}
.board-glow-burst{animation:board-glow-burst .9s ease-out .05s both}
.board-copy{animation:board-copy-in .35s ease .22s both}
.board-spark{animation:board-spark 1s ease-out .16s both}
.board-trophy{animation:board-trophy .45s ease .16s both}
.board-shine{animation:board-shine .7s ease .28s both}
.board-rise{animation:board-rise .45s ease .12s both}
.board-ring{animation:board-ring .8s ease-out .1s both}
.board-row-flash{animation:board-row-flash .7s ease 2}
@media (prefers-reduced-motion:reduce){
  .board-scene,.board-scene-out,.board-dim,.board-dim-out,.board-avatar-pop,.board-crown,.board-glow-burst,.board-copy,.board-spark,.board-trophy,.board-shine,.board-rise,.board-ring,.board-row-flash{animation:none}
}
`;

function Sparks({ color }: { color: string }) {
  return (
    <>
      {SPARKS.map((spark) => (
        <span
          key={`${spark.x}${spark.y}`}
          aria-hidden
          className="board-spark pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full"
          style={{ background: color, ["--sx" as string]: spark.x, ["--sy" as string]: spark.y }}
        />
      ))}
    </>
  );
}

function Glow({ color, wide = false }: { color: string; wide?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn("board-glow-burst pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full", wide ? "h-56 w-56" : "h-40 w-40")}
      style={{ background: `radial-gradient(circle, ${color}, transparent 68%)` }}
    />
  );
}

function HeroAvatar({ face }: { face: CelebrationFace }) {
  return (
    <div className="board-avatar-pop">
      <div className="scale-125">
        <PersonAvatar size="3xl" name={face.name} employeeId={face.employeeId} storeId={face.storeId} />
      </div>
    </div>
  );
}

function SceneFrame({
  leaving,
  glow,
  children,
  caption,
}: {
  leaving: boolean;
  glow: string;
  children: ReactNode;
  caption: string;
}) {
  return (
    <Card
      padding="none"
      className={cn("board-scene relative overflow-visible px-8 pb-7 pt-11 text-center", leaving && "board-scene-out")}
      style={{
        background: "color-mix(in srgb, var(--bg-2) 86%, transparent)",
        borderColor: glow,
        boxShadow: `0 0 0 1px ${glow}, 0 0 42px -10px ${glow}, var(--shadow-vela)`,
      }}
    >
      {children}
      <p aria-live="polite" className="board-copy mx-auto mt-7 max-w-xl text-[26px] font-extrabold leading-tight tracking-tight text-t0 sm:text-[32px]">
        {caption}
      </p>
    </Card>
  );
}

function LeadershipEvent({ face, caption, leaving }: { face: CelebrationFace; caption: string; leaving: boolean }) {
  return (
    <SceneFrame leaving={leaving} glow="#f7b84e" caption={caption}>
      <div className="relative mx-auto flex h-24 w-24 items-center justify-center">
        <Glow color="rgba(247,184,78,.55)" />
        <Sparks color="#f7b84e" />
        <HeroAvatar face={face} />
        <span className="board-crown absolute left-1/2 top-0 z-10 text-[52px] leading-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.35)]" aria-hidden>
          👑
        </span>
      </div>
    </SceneFrame>
  );
}

function OvertakeEvent({
  face,
  passed,
  caption,
  leaving,
}: {
  face: CelebrationFace;
  passed: CelebrationFace | null;
  caption: string;
  leaving: boolean;
}) {
  return (
    <SceneFrame leaving={leaving} glow="var(--acc)" caption={caption}>
      <div className="relative mx-auto flex h-24 w-24 items-center justify-center">
        <Glow color="color-mix(in srgb, var(--acc) 55%, transparent)" />
        <Sparks color="var(--acc)" />
        <span className="board-rise absolute -left-9 top-1/2 text-acc" aria-hidden>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5" />
            <path d="m6 11 6-6 6 6" />
          </svg>
        </span>
        <HeroAvatar face={face} />
      </div>
      {passed ? (
        <div className="board-copy mt-5 flex items-center justify-center gap-2">
          <PersonAvatar size="sm" name={passed.name} employeeId={passed.employeeId} storeId={passed.storeId} />
          <span className="text-[13px] font-bold text-t2" aria-hidden>
            →
          </span>
          <PersonAvatar size="sm" name={face.name} employeeId={face.employeeId} storeId={face.storeId} />
        </div>
      ) : null}
    </SceneFrame>
  );
}

function LevelEvent({
  face,
  store,
  caption,
  leaving,
}: {
  face: CelebrationFace | null;
  store: boolean;
  caption: string;
  leaving: boolean;
}) {
  const glow = store ? "var(--info)" : "var(--acc)";
  return (
    <SceneFrame leaving={leaving} glow={glow} caption={caption}>
      <div className={cn("relative mx-auto flex items-center justify-center", store ? "h-28 w-28" : "h-24 w-24")}>
        <Glow color={store ? "color-mix(in srgb, var(--info) 50%, transparent)" : "color-mix(in srgb, var(--acc) 50%, transparent)"} wide={store} />
        <span
          aria-hidden
          className="board-ring pointer-events-none absolute inset-0 rounded-full border-2"
          style={{ borderColor: glow }}
        />
        {face ? <HeroAvatar face={face} /> : null}
        <span
          className={cn(
            "z-10 flex items-center justify-center rounded-full",
            face ? "absolute -bottom-1 -right-1 h-11 w-11 bg-acc-soft text-acc" : "relative h-28 w-28 bg-info-soft text-info",
          )}
        >
          <TargetIcon size={face ? 22 : 52} />
        </span>
        {store ? (
          <span className="absolute -top-5 left-1/2 z-20 -translate-x-1/2">
            <BrandMark size={34} />
          </span>
        ) : null}
      </div>
    </SceneFrame>
  );
}

function ChallengeWinEvent({ face, caption, leaving }: { face: CelebrationFace; caption: string; leaving: boolean }) {
  return (
    <SceneFrame leaving={leaving} glow="var(--warn)" caption={caption}>
      <div className="relative mx-auto flex h-24 w-24 items-center justify-center">
        <Glow color="color-mix(in srgb, var(--warn) 55%, transparent)" />
        <Sparks color="var(--warn)" />
        <HeroAvatar face={face} />
        <span className="board-trophy absolute -right-4 -top-3 z-10 flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-warn-soft text-warn">
          <TrophyIcon size={26} />
          <span aria-hidden className="board-shine pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-white/50" />
        </span>
      </div>
    </SceneFrame>
  );
}

export function BoardCelebration({
  moment,
  leaving,
  face,
  passed,
  caption,
}: {
  moment: BoardMoment;
  leaving: boolean;
  face: CelebrationFace | null;
  passed: CelebrationFace | null;
  caption: string;
}) {
  const scene =
    moment.kind === "first" && face ? (
      <LeadershipEvent face={face} caption={caption} leaving={leaving} />
    ) : moment.kind === "overtake" && face ? (
      <OvertakeEvent face={face} passed={passed} caption={caption} leaving={leaving} />
    ) : moment.kind === "level" || moment.kind === "store-level" ? (
      <LevelEvent face={face} store={moment.kind === "store-level"} caption={caption} leaving={leaving} />
    ) : moment.kind === "challenge" && face ? (
      <ChallengeWinEvent face={face} caption={caption} leaving={leaving} />
    ) : null;

  if (!scene) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[120]">
      <style>{SCENE_STYLE}</style>
      <div className={cn("board-dim absolute inset-0 bg-black/20 backdrop-blur-[2px]", leaving && "board-dim-out")} />
      <div className="relative flex h-full items-center justify-center p-6">{scene}</div>
    </div>
  );
}
