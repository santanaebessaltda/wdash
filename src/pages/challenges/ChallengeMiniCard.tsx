import { Card, CardHero, ProgressBar, ProgressStanding, progressTextClass } from "@/components/ui";
import { BranchBadge, DeadlineBadge, PeriodBadge, PrizeBadge, RecordStatusBadge } from "@/components/wedash/RecordBadges";
import { PersonAvatar, PersonAvatarGroup } from "@/components/wedash/PersonAvatar";
import type { ChallengeRecord } from "@/data/wedash/challengesRepo";
import { CHALLENGE_STATUS_LABEL, metricValueLabel, prizeLabel, type ChallengeParticipant, type ChallengeView } from "@/data/wedash/challengeView";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";
import { challengeCriterion, challengeHeadline, challengeMinimumLabel, floorChallengeHeadline, floorPrizeLine, HeadlineText, mainPrizeLabel } from "@/pages/challenges/shared";
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
  const minimum = challengeMinimumLabel(c);
  const reached = c.mode === "MINIMUM" && view.status !== "upcoming" ? challengeHeadline(c, view).value : null;
  const leader = Math.max(0, ...view.participants.map((person) => person.result ?? 0));
  if (floor) {
    const lead = disputa ? floorLead(c, view) : null;
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
              prize={null}
              prizeLine={floorPrizeLine(c)}
              minimum={minimum}
              reached={reached}
              reachedOk={view.reachedCount > 0}
              prazo={ended ? null : view.prazo}
            />
          </span>
        </span>
        {lead ? (
          <div className="mt-4 border-t border-line pt-3">
            <p className="text-[13px] font-semibold text-t0">{lead}</p>
          </div>
        ) : null}
        {showPeople && (
          <ChallengePeople challenge={c} view={view} disputa={disputa} leader={leader} hotKey={hotKey} announcePrize className="mt-4" />
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
            minimum={showPeople ? null : minimum}
            reached={showPeople ? null : reached}
            reachedOk={view.reachedCount > 0}
            prazo={showPeople || ended ? null : view.prazo}
          />
          {disputa && !showPeople ? (
            <span className="mt-2 block min-w-0 truncate text-[13px] text-t1">
              <HeadlineText headline={destaque} />
            </span>
          ) : null}
        </span>
      </span>
      {showPeople ? (
        <>
          <ChallengeSummary challenge={c} view={view} avatars={false} />
          <ChallengePeople challenge={c} view={view} disputa={disputa} leader={leader} hotKey={hotKey} className="mt-4 border-t border-line pt-3" />
        </>
      ) : null}
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
  prizeLine = null,
  minimum,
  reached,
  reachedOk = false,
  prazo,
}: {
  name: string;
  nameClass: string;
  statusLabel: string;
  startsOn: string;
  endsOn: string;
  storeNameValue?: string;
  prize: string | null;
  /** Linha de destaque do placar. Quando existe, o badge do prêmio sai. */
  prizeLine?: string | null;
  minimum: string | null;
  reached: string | null;
  reachedOk?: boolean;
  prazo: string | null;
}) {
  return (
    <>
      <span className="flex items-start justify-between gap-2">
        <span className={nameClass}>{name}</span>
        <RecordStatusBadge label={statusLabel} />
      </span>
      {prizeLine ? <span className="mt-1 block text-[14px] font-bold leading-snug text-t0">{prizeLine}</span> : null}
      <span className="mt-2 flex flex-wrap items-center gap-1.5">
        <PeriodBadge from={startsOn} to={endsOn} />
        {storeNameValue ? <BranchBadge name={storeNameValue} /> : null}
        {prize && !prizeLine ? <PrizeBadge label={prize} /> : null}
        {prazo ? <DeadlineBadge label={prazo} /> : null}
      </span>
      {minimum ? <span className="mt-1.5 block text-[12px] font-semibold text-t1">{minimum}</span> : null}
      {reached ? <span className={`mt-2 block text-[12.5px] font-semibold ${reachedOk ? "text-ok" : "text-t1"}`}>{reached}</span> : null}
    </>
  );
}

/** Média da equipe, percentual e a barra até o mínimo. A mesma conta do card e do detalhe. */
export function ChallengeProgress({
  challenge: c,
  view,
  height = 5,
  showDeadline = true,
}: {
  challenge: ChallengeRecord;
  view: ChallengeView;
  height?: number;
  /** No detalhe o prazo já está nos números do resumo. */
  showDeadline?: boolean;
}) {
  const upcoming = view.status === "upcoming";
  const ended = view.status === "ended";
  const people = view.participants;
  const count = people.length;
  const won = people.filter((person) => person.winner).length;
  const best = Math.max(0, ...people.map((person) => person.result ?? 0));
  const leader = people.find((person) => person.position === 1);
  const index = c.metric === "INDEX";
  const personGoal = c.target != null && c.target > 0 ? c.target : null;
  const managerGoal = view.management != null && view.management.target > 0 ? view.management.target : null;
  // No índice a média de quem vendeu é sempre 100. Com gerência, a barra usa o índice da equipe.
  const hasAverage = view.teamAverage != null;
  const shown = hasAverage ? view.teamAverage : !upcoming && index && best > 0 ? (leader?.result ?? best) : null;
  const goal = hasAverage ? (index ? managerGoal : (personGoal ?? managerGoal)) : personGoal;
  const goalIsManager = hasAverage && goal != null && (index || personGoal == null);
  const pct = upcoming || shown == null ? 0 : goal != null ? (shown / goal) * 100 : best > 0 ? (shown / best) * 100 : 0;
  const headcount = `${count} ${count === 1 ? "pessoa" : "pessoas"}`;
  const left = upcoming ? (c.mode === "MINIMUM" ? challengeMinimumLabel(c) : challengeCriterion(c)) ?? "—" : shown != null ? metricValueLabel(c.metric, shown) : "Sem resultado";
  const reached =
    c.mode !== "MINIMUM" || upcoming
      ? null
      : won === 0
        ? "Ninguém atingiu"
        : won === 1
          ? "1 pessoa atingiu"
          : `${won} pessoas atingiram`;
  const prazo = showDeadline && !upcoming && !ended ? view.prazo : null;

  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn("min-w-0 truncate font-mono text-[13px] font-extrabold", shown != null && !upcoming ? progressTextClass(pct) : "text-t0")}>{left}</span>
        <span className="shrink-0 text-right text-[11.5px] text-t2">
          {upcoming ? (
            view.prazo
          ) : shown != null && goal != null ? (
            <>
              <span className={`font-mono font-bold ${progressTextClass(pct)}`}>{num(pct, 1)}%</span>
              {goalIsManager ? " da meta da gerência" : ` de ${metricValueLabel(c.metric, goal)}`}
            </>
          ) : c.mode === "CONTEST" ? (
            leader?.name ?? "Ainda não há líder"
          ) : (
            headcount
          )}
        </span>
      </div>
      <div className="mt-2">
        <ProgressBar value={pct} height={height} />
      </div>
      {reached || prazo ? (
        <p className="mt-2 text-[11.5px]">
          {reached ? <span className={`font-semibold ${won > 0 ? "text-acc" : "text-t1"}`}>{reached}</span> : null}
          {reached && prazo ? <span className="text-t2"> · </span> : null}
          {prazo ? <span className="text-t2">{prazo}</span> : null}
        </p>
      ) : null}
    </>
  );
}

/** Mesmo miolo do card de meta: a média da equipe, a barra até o mínimo e os avatares. */
export function ChallengeSummary({ challenge: c, view, avatars = true }: { challenge: ChallengeRecord; view: ChallengeView; avatars?: boolean }) {
  const upcoming = view.status === "upcoming";
  const people = view.participants;
  const count = people.length;
  const rule = c.mode === "MINIMUM" ? challengeMinimumLabel(c) : challengeCriterion(c);
  const headcount = `${count} ${count === 1 ? "pessoa" : "pessoas"}`;
  const note = upcoming ? headcount : [rule, headcount].filter(Boolean).join(" · ");

  return (
    <>
      <div className="mt-3.5">
        <ChallengeProgress challenge={c} view={view} />
      </div>
      <div className="flex-1" />
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="min-w-0 text-[12px] text-t2">{note}</p>
        {avatars && count > 0 ? (
          <div className="shrink-0">
            <PersonAvatarGroup people={avatarPeople(c, view)} max={3} />
          </div>
        ) : null}
      </div>
    </>
  );
}

function avatarPeople(c: ChallengeRecord, view: ChallengeView) {
  return view.participants.map((person) => {
    const code = person.key.startsWith("e:") ? Number(person.key.slice(2)) : NaN;
    return { name: person.name, storeId: c.storeId, employeeId: Number.isFinite(code) ? code : undefined };
  });
}

function ChallengePeople({
  challenge: c,
  view,
  disputa,
  leader,
  hotKey,
  announcePrize = false,
  className,
}: {
  challenge: ChallengeRecord;
  view: ChallengeView;
  disputa: boolean;
  leader: number;
  hotKey: string | null;
  /** No placar, quem já levou mostra "Ganhou" com o prêmio. */
  announcePrize?: boolean;
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
                    <ChallengePersonStatus person={person} disputa={disputa} ended={view.status === "ended"} pct={pct} announcePrize={announcePrize} />
                  </span>
                  <span className="mt-1.5 block">
                    <ProgressBar value={pct} height={5} color={person.result == null ? "var(--line)" : undefined} />
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
  return floorChallengeHeadline(c, view).value;
}

function ChallengePersonStatus({
  person,
  disputa,
  ended,
  pct,
  announcePrize,
}: {
  person: ChallengeParticipant;
  disputa: boolean;
  ended: boolean;
  pct: number;
  announcePrize: boolean;
}) {
  if (person.result == null) return <span className="shrink-0 text-[11px] font-semibold text-t3">Sem resultado</span>;
  const won = announcePrize && person.winner && person.prize && (!disputa || ended) ? `Ganhou ${prizeLabel(person.prize)}` : null;
  if (won) return <span className="max-w-[11rem] text-right text-[12px] font-semibold leading-tight text-ok">{won}</span>;
  if (disputa && person.position != null) return <ProgressStanding ok={person.winner}>{`${person.position}º lugar`}</ProgressStanding>;
  if (person.winner) return <ProgressStanding ok>Atingiu</ProgressStanding>;
  if (!disputa && ended) return <ProgressStanding ok={false}>Não atingiu</ProgressStanding>;
  return <span className={`shrink-0 font-mono text-[12px] font-bold tabular-nums ${progressTextClass(pct)}`}>{num(pct, 0)}%</span>;
}

/** Barra até a meta. Na disputa sem meta, a barra vai até quem está na frente. */
function challengeProgress(result: number | null, target: number | null, leader: number): number {
  if (result == null || result <= 0) return 0;
  const goal = target != null && target > 0 ? target : leader;
  if (goal <= 0) return 0;
  return Math.min(100, (result / goal) * 100);
}
