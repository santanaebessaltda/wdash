import { Badge, Card, CardHero, ProgressBar } from "@/components/ui";
import { BranchBadge, PeriodBadge, PrizeBadge, RecordStatusBadge } from "@/components/wedash/RecordBadges";
import { PersonAvatar } from "@/components/wedash/PersonAvatar";
import type { ChallengeRecord } from "@/data/wedash/challengesRepo";
import { CHALLENGE_STATUS_LABEL, metricValueLabel, type ChallengeParticipant, type ChallengeView } from "@/data/wedash/challengeView";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";
import { challengeCriterion, challengeHeadline, floorChallengeHeadline, HeadlineText, mainPrizeLabel } from "@/pages/challenges/shared";
import { FlameIcon } from "@/pages/dashboards/icons";

/** Desafio na aba Desafios da Equipe: so leitura, clique abre o detalhe. */
export function ChallengeMiniCard({
  challenge: c,
  view,
  storeNameValue,
  onOpen,
  prominent = false,
  showPeople = false,
  hotKey = null,
  floor = false,
}: {
  challenge: ChallengeRecord;
  view: ChallengeView;
  storeNameValue?: string;
  /** Sem isto o card fica só leitura, como no placar da loja. */
  onOpen?: () => void;
  /** Mesmo ícone e tamanho do card de desafio da Gestão. */
  prominent?: boolean;
  /** Lista cada pessoa com o resultado e a barra, no mesmo desenho do placar. */
  showPeople?: boolean;
  hotKey?: string | null;
  /** Texto corrido, para o placar da loja. */
  floor?: boolean;
}) {
  const prize = mainPrizeLabel(c);
  const ended = view.status === "ended";
  const statusLabel = CHALLENGE_STATUS_LABEL[view.status];
  const disputa = c.mode === "CONTEST";
  const leader = Math.max(0, ...view.participants.map((person) => person.result ?? 0));
  if (floor) {
    const lead = floorLead(c, view);
    const detail = floorDetail(c, view.status === "upcoming");
    return (
      <Card padding="lg" glass="var(--warn-soft)" className="flex w-full flex-col text-left">
        <span className="flex items-start gap-3.5">
          <CardHero tone="warn">
            <FlameIcon size={22} />
          </CardHero>
          <span className="min-w-0 flex-1">
            <ChallengeIdentity
              name={c.name}
              nameClass="block min-w-0 truncate text-[15px] font-bold text-t0"
              statusLabel={statusLabel}
              startsOn={c.startsOn}
              endsOn={c.endsOn}
              storeNameValue={storeNameValue}
              prize={prize}
              prazo={ended ? null : view.prazo}
            />
          </span>
        </span>
        <div className="mt-4 border-t border-line pt-3">
          <p className="text-[13px] font-semibold text-t0">{lead}</p>
          {detail ? <p className="mt-0.5 text-[12px] text-t2">{detail}</p> : null}
        </div>
        {showPeople && (
          <ChallengePeople challenge={c} view={view} disputa={disputa} leader={leader} hotKey={hotKey} className="mt-4" />
        )}
      </Card>
    );
  }
  const destaque = challengeHeadline(c, view);
  const className = cn(
    "flex w-full flex-col border border-line text-left",
    prominent ? "rounded-2xl p-5 shadow-[var(--shadow-vela)]" : "rounded-xl p-4",
    ended ? "bg-bg-inset" : "bg-bg-2",
    onOpen && "cursor-pointer transition-colors hover:border-line-2 focus-visible:border-acc focus-visible:outline-none",
  );
  const body = (
    <>
      <span className="flex w-full items-start gap-3.5">
        <span
          className={cn(
            "flex shrink-0 items-center justify-center",
            prominent ? "h-[50px] w-[50px] rounded-[14px]" : "h-10 w-10 rounded-xl",
            ended ? "bg-bg-3 text-t2" : "bg-acc-soft text-acc",
          )}
        >
          <FlameIcon size={prominent ? 22 : 18} />
        </span>
        <span className="min-w-0 flex-1">
          <ChallengeIdentity
            name={c.name}
            nameClass={cn("min-w-0 truncate font-bold text-t0", prominent ? "text-[15px]" : "text-[14px]")}
            statusLabel={statusLabel}
            startsOn={c.startsOn}
            endsOn={c.endsOn}
            storeNameValue={storeNameValue}
            prize={prize}
            prazo={ended ? null : view.prazo}
          />
          <span className="mt-2 block min-w-0 truncate text-[13px] text-t1">
            <HeadlineText headline={destaque} />
          </span>
        </span>
      </span>
      {showPeople && (
        <ChallengePeople
          challenge={c}
          view={view}
          disputa={disputa}
          leader={leader}
          hotKey={hotKey}
          className="mt-3 border-t border-line pt-3"
        />
      )}
    </>
  );
  if (!onOpen) return <div className={className}>{body}</div>;
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      aria-label={`Ver detalhe do desafio ${c.name}`}
      className={className}
    >
      {body}
    </div>
  );
}

function ChallengeIdentity({
  name,
  nameClass,
  statusLabel,
  startsOn,
  endsOn,
  storeNameValue,
  prize,
  prazo,
}: {
  name: string;
  nameClass: string;
  statusLabel: string;
  startsOn: string;
  endsOn: string;
  storeNameValue?: string;
  prize: string | null;
  prazo: string | null;
}) {
  return (
    <>
      <span className="flex items-start justify-between gap-2">
        <span className={nameClass}>{name}</span>
        <RecordStatusBadge label={statusLabel} />
      </span>
      <span className="mt-2 flex flex-wrap items-center gap-1.5">
        <PeriodBadge from={startsOn} to={endsOn} />
        {prazo ? <span className="text-[12px] text-t2">{prazo}</span> : null}
        {storeNameValue ? <BranchBadge name={storeNameValue} /> : null}
        {prize ? <PrizeBadge label={prize} /> : null}
      </span>
    </>
  );
}

function ChallengePeople({
  challenge: c,
  view,
  disputa,
  leader,
  hotKey,
  className,
}: {
  challenge: ChallengeRecord;
  view: ChallengeView;
  disputa: boolean;
  leader: number;
  hotKey: string | null;
  className?: string;
}) {
  return (
    <ul className={cn(className, "space-y-3.5")}>
      {view.participants.length === 0 ? (
        <li className="text-[12.5px] text-t2">Nenhuma pessoa no desafio.</li>
      ) : (
        view.participants.map((person) => {
          const pct = challengeProgress(person.result, c.target, leader);
          return (
            <li key={person.key} className={cn("min-w-0", hotKey === person.key && "rounded-lg bg-acc-soft px-1.5 py-1")}>
              <span className="flex items-start gap-2">
                <PersonAvatar name={person.name} employeeId={person.key} storeId={c.storeId} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-t0">{person.name}</span>
                  <span className="mt-0.5 flex items-baseline justify-between gap-2">
                    <span className="font-mono text-[12px] font-bold tabular-nums text-t1">
                      {person.result == null ? "—" : metricValueLabel(c.metric, person.result)}
                    </span>
                    <ChallengePersonStatus person={person} disputa={disputa} pct={pct} />
                  </span>
                  <span className="mt-1.5 block">
                    <ProgressBar value={pct} height={5} color={person.result == null ? "var(--line)" : "var(--acc)"} />
                  </span>
                </span>
              </span>
            </li>
          );
        })
      )}
    </ul>
  );
}

function floorLead(c: ChallengeRecord, view: ChallengeView): string {
  if (view.status === "upcoming") return challengeCriterion(c);
  if (c.mode === "MINIMUM") {
    const n = view.reachedCount;
    const ended = view.status === "ended";
    if (n === 0) return ended ? "Ninguém atingiu o mínimo" : "Ninguém atingiu o mínimo ainda";
    if (n === 1) return "1 pessoa atingiu o mínimo";
    return `${n} pessoas atingiram o mínimo`;
  }
  return floorChallengeHeadline(c, view).value;
}

function floorDetail(c: ChallengeRecord, upcoming: boolean): string | null {
  const prize = mainPrizeLabel(c);
  if (upcoming) return prize;
  if (c.mode === "MINIMUM") {
    const minimum = c.target != null ? `Mínimo ${metricValueLabel(c.metric, c.target)}` : null;
    const prizePart = prize ? `Prêmio ${prize}` : null;
    return [minimum, prizePart].filter(Boolean).join(" · ") || null;
  }
  const minimum = c.target != null ? `Mínimo ${metricValueLabel(c.metric, c.target)}` : null;
  return [minimum, prize].filter(Boolean).join(" · ") || null;
}

function ChallengePersonStatus({ person, disputa, pct }: { person: ChallengeParticipant; disputa: boolean; pct: number }) {
  if (person.result == null) return <span className="shrink-0 text-[11px] font-semibold text-t3">Sem resultado</span>;
  if (disputa && person.position != null) {
    return (
      <Badge variant={person.winner ? "success" : "accent"} className="shrink-0">
        {person.position}º lugar
      </Badge>
    );
  }
  if (person.winner) return <Badge variant="accent" className="shrink-0">Atingiu</Badge>;
  return <span className="shrink-0 font-mono text-[12px] font-bold tabular-nums text-acc">{num(pct, 0)}%</span>;
}

/** Barra até a meta. Na disputa sem meta, a barra vai até quem está na frente. */
function challengeProgress(result: number | null, target: number | null, leader: number): number {
  if (result == null || result <= 0) return 0;
  const goal = target != null && target > 0 ? target : leader;
  if (goal <= 0) return 0;
  return Math.min(100, (result / goal) * 100);
}
