import { Badge, Card, CardHero, ProgressBar, ProgressStanding, progressTextClass } from "@/components/ui";
import { BranchBadge, DeadlineBadge, PeriodBadge, PrizeBadge, RecordStatusBadge } from "@/components/wedash/RecordBadges";
import { PersonAvatar, PersonAvatarGroup } from "@/components/wedash/PersonAvatar";
import type { ChallengeMetric, ChallengeRecord } from "@/data/wedash/challengesRepo";
import { CHALLENGE_STATUS_LABEL, metricValueLabel, prizeLabel, type ChallengeParticipant, type ChallengeView } from "@/data/wedash/challengeView";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";
import { challengeCriterion, challengeHeadline, challengeMinimumLabel, challengeWonLabel, HeadlineText, mainPrizeLabel } from "@/pages/challenges/shared";
import { FlameIcon, TrophyIcon } from "@/pages/dashboards/icons";

/** P.A., ticket e índice só fecham no fim. O percentual substitui a barra. */
function settlesAtEnd(metric: ChallengeMetric): boolean {
  return metric === "PA" || metric === "TICKET" || metric === "INDEX";
}

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
  counter = null,
  secret = false,
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
  /** "1 / 3" quando o placar reveza os desafios. */
  counter?: string | null;
  /** Borra prêmio, resultado e percentual. Só o placar. */
  secret?: boolean;
}) {
  const prize = mainPrizeLabel(c);
  const ended = view.status === "ended";
  const statusLabel = CHALLENGE_STATUS_LABEL[view.status];
  const disputa = c.mode === "CONTEST";
  const minimum = challengeMinimumLabel(c);
  const people = view.participants.length;
  const reached =
    c.mode === "MINIMUM" && view.status !== "upcoming" && people > 0 ? challengeWonLabel(view.reachedCount, people) : null;
  const leader = Math.max(0, ...view.participants.map((person) => person.result ?? 0));
  if (floor) {
    const title = /^desafio\b/i.test(c.name) ? c.name : `Desafio ${c.name}`;
    const prize = boardPrizeLine(c);
    const wonLine = c.mode === "MINIMUM" && view.status !== "upcoming" && people > 0 ? boardWonCount(view.reachedCount, people) : null;
    const boardBadge = "!px-2.5 !py-1 !text-[12px]";
    return (
      <Card padding="sm" glass={view.status === "active" ? "var(--wpink-soft)" : "color-mix(in srgb, var(--t1) 28%, transparent)"} className="flex h-full min-h-0 w-full flex-col overflow-hidden text-left !px-2.5 !py-2.5">
        <div className="flex items-start gap-2">
          <CardHero compact tone={view.status === "active" ? "acc" : "muted"} color={view.status === "active" ? "var(--wpink)" : undefined} background={view.status === "active" ? "var(--wpink-soft)" : undefined}>
            <FlameIcon size={18} />
          </CardHero>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-[16px] font-extrabold leading-tight text-t0">{title}</p>
              <span className="flex shrink-0 items-center gap-1.5">
                {counter ? <span className="text-[12px] font-bold tabular-nums text-t2">{counter}</span> : null}
                <RecordStatusBadge label={statusLabel} className={boardBadge} />
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <PeriodBadge from={c.startsOn} to={c.endsOn} className={boardBadge} />
              {!ended && view.prazo ? <DeadlineBadge label={view.prazo} className={boardBadge} /> : null}
              {storeNameValue ? <BranchBadge name={storeNameValue} /> : null}
            </div>
            {prize || minimum ? (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] leading-snug">
                {prize ? (
                  <span className="inline-flex min-w-0 items-center gap-1.5 font-semibold text-t1">
                    <span className="shrink-0 text-acc">
                      <TrophyIcon size={14} />
                    </span>
                    <span className="truncate text-ok">{prize}</span>
                  </span>
                ) : null}
                {minimum ? <span className="font-medium text-t2">{minimum}</span> : null}
              </p>
            ) : null}
            {wonLine ? <p className={`mt-1 text-[13px] font-semibold ${people > 0 && view.reachedCount === people ? "text-acc" : "text-t1"}`}>{wonLine}</p> : null}
          </div>
        </div>
        {showPeople ? (
          <ul className="mt-2.5 min-h-0 flex-1 space-y-2.5 overflow-y-auto">
            {view.participants.length === 0 ? (
              <li className="text-[13px] text-t2">Nenhuma pessoa no desafio.</li>
            ) : (
              view.participants.map((person) => {
                const pct = challengeProgress(person.result, c.target, leader);
                const wonLook = !disputa && person.winner;
                const late = settlesAtEnd(c.metric);
                const floorTarget = c.target != null && c.target > 0 ? c.target : null;
                const above = floorTarget != null && person.result != null && person.result >= floorTarget;
                const resultClass = person.result == null ? "text-t2" : late && floorTarget != null ? (above ? "text-acc" : "text-t1") : person.result < 0 ? "text-bad" : late ? "text-t0" : "text-acc";
                const showTrack = !late || disputa || person.winner || (ended && person.result != null);
                return (
                  <li key={person.key} className={cn("min-w-0", hotKey === person.key && "rounded-lg bg-acc-soft px-1 py-1")}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-[13px] font-extrabold uppercase tracking-wide text-t0">{person.name}</span>
                      <span className={`shrink-0 text-[13px] font-bold ${resultClass}`} {...(secret && (c.metric === "VALUE" || c.metric === "TICKET") ? { "data-secret": "" } : {})}>{person.result == null ? "—" : metricValueLabel(c.metric, person.result)}</span>
                    </div>
                    {showTrack ? (
                      <div className={cn("mt-1 flex items-center gap-2", late && "justify-end")}>
                        {late ? null : (
                          <div className="min-w-0 flex-1">
                            <ProgressBar enter value={wonLook ? 100 : pct} height={10} />
                          </div>
                        )}
                        <BoardPersonMark person={person} disputa={disputa} ended={ended} pct={pct} late={late} />
                      </div>
                    ) : null}
                  </li>
                );
              })
            )}
          </ul>
        ) : null}
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
            view.status === "active" ? "bg-acc-soft text-acc" : "bg-bg-3 text-t1",
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
            reachedOk={people > 0 && view.reachedCount === people}
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
          <ChallengeSummary challenge={c} view={view} avatars={false} pinNote={false} />
          <ChallengePeople challenge={c} view={view} disputa={disputa} leader={leader} hotKey={hotKey} className="mt-4 border-t border-line pt-3" />
          <div className="flex-1" />
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
  minimumBadge = false,
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
  /** No placar, a regra entra na fileira de badges, em caixa alta. */
  minimumBadge?: boolean;
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
      {prizeLine ? (
        <span className="mt-2 flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-acc-soft text-acc">
            <TrophyIcon size={16} />
          </span>
          <span className="text-[16px] font-extrabold leading-snug text-t0">{prizeLine}</span>
        </span>
      ) : null}
      <span className="mt-2 flex flex-wrap items-center gap-1.5">
        <PeriodBadge from={startsOn} to={endsOn} />
        {storeNameValue ? <BranchBadge name={storeNameValue} /> : null}
        {minimum && minimumBadge ? (
          <Badge variant="neutral" className="uppercase">
            {minimum}
          </Badge>
        ) : null}
        {prize && !prizeLine ? <PrizeBadge label={prize} /> : null}
        {prazo ? <DeadlineBadge label={prazo} /> : null}
      </span>
      {minimum && !minimumBadge ? <span className="mt-1.5 block text-[12px] font-semibold text-t1">{minimum}</span> : null}
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
  hideCount = false,
}: {
  challenge: ChallengeRecord;
  view: ChallengeView;
  height?: number;
  /** No detalhe o prazo já está nos números do resumo. */
  showDeadline?: boolean;
  /** No detalhe o Resultado já mostra quantos ganharam. */
  hideCount?: boolean;
}) {
  const upcoming = view.status === "upcoming";
  const ended = view.status === "ended";
  const people = view.participants;
  const count = people.length;
  const won = people.filter((person) => person.winner).length;
  const best = Math.max(0, ...people.map((person) => person.result ?? 0));
  const leader = people.find((person) => person.position === 1);
  const index = c.metric === "INDEX";
  const collective = c.mode === "COLLECTIVE";
  const personGoal = c.target != null && c.target > 0 ? c.target : null;
  const managerGoal = view.management != null && view.management.target > 0 ? view.management.target : null;
  const cashierGoal = view.cashier != null && view.cashier.target > 0 ? view.cashier.target : null;
  const roleGoal = managerGoal ?? cashierGoal;
  // No índice a média de quem vendeu é sempre 100. Com gerência ou operador de caixa, a barra usa o índice da equipe.
  const hasAverage = view.teamAverage != null;
  const shown = hasAverage ? view.teamAverage : !upcoming && index && best > 0 ? (leader?.result ?? best) : null;
  const goal = hasAverage ? (index && !collective ? roleGoal : (personGoal ?? roleGoal)) : personGoal;
  const goalIsRole = !collective && hasAverage && goal != null && (index || personGoal == null);
  const roleGoalLabel = managerGoal != null ? "da meta da gerência" : "da meta do operador de caixa";
  const pct = upcoming || shown == null ? 0 : goal != null ? (shown / goal) * 100 : best > 0 ? (shown / best) * 100 : 0;
  const headcount = `${count} ${count === 1 ? "pessoa" : "pessoas"}`;
  const late = settlesAtEnd(c.metric);
  const hasFloor = goal != null && goal > 0;
  const left = upcoming ? (c.mode === "MINIMUM" ? challengeMinimumLabel(c) : challengeCriterion(c)) ?? "—" : shown != null ? metricValueLabel(c.metric, shown) : "Sem resultado";
  const everyone = count > 0 && won === count;
  const reached = hideCount || c.mode !== "MINIMUM" || upcoming || count === 0 ? null : challengeWonLabel(won, count);
  const prazo = showDeadline && !upcoming && !ended ? view.prazo : null;

  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn("min-w-0 truncate font-mono text-[13px] font-extrabold", shown != null && !upcoming ? (late ? (c.metric === "TICKET" ? (shown < 0 ? "text-bad" : "text-ok") : "text-t0") : c.metric === "VALUE" || c.metric === "TICKET" ? (shown < 0 ? "text-bad" : "text-ok") : progressTextClass(pct)) : "text-t0")}>{left}</span>
        <span className="shrink-0 text-right text-[11.5px] text-t2">
          {upcoming ? (
            view.prazo
          ) : shown != null && goal != null ? (
            <>
              <span className={`font-mono font-bold ${late ? (hasFloor && pct >= 100 ? "text-acc" : "text-t2") : progressTextClass(pct)}`}>{num(pct, 1)}%</span>
              {goalIsRole ? ` ${roleGoalLabel}` : ` de ${metricValueLabel(c.metric, goal)}`}
            </>
          ) : c.mode === "CONTEST" ? (
            leader?.name ?? "Ainda não há líder"
          ) : (
            headcount
          )}
        </span>
      </div>
      {late ? null : (
        <div className="mt-2">
          <ProgressBar value={pct} height={height} />
        </div>
      )}
      {reached || prazo ? (
        <p className="mt-2 text-[11.5px]">
          {reached ? <span className={`font-semibold ${everyone ? "text-ok" : "text-t1"}`}>{reached}</span> : null}
          {reached && prazo ? <span className="text-t2"> · </span> : null}
          {prazo ? <span className="text-t2">{prazo}</span> : null}
        </p>
      ) : null}
    </>
  );
}

function roleStanding(
  result: ChallengeView["management"],
  status: ChallengeView["status"],
  won: string,
  missed: string,
): { ok: boolean; label: string } | null {
  if (result == null || status === "upcoming") return null;
  if (result.atingiu) return { ok: true, label: won };
  if (status === "ended") return { ok: false, label: missed };
  return null;
}

/** Mesmo miolo do card de meta: a média da equipe, a barra até o mínimo e os avatares. */
export function ChallengeSummary({
  challenge: c,
  view,
  avatars = true,
  pinNote = true,
}: {
  challenge: ChallengeRecord;
  view: ChallengeView;
  avatars?: boolean;
  /** Empurra o mínimo para o fim do card. Com a lista de pessoas, o espaço fica abaixo dela. */
  pinNote?: boolean;
}) {
  const upcoming = view.status === "upcoming";
  const people = view.participants;
  const count = people.length;
  const rule = c.mode === "MINIMUM" || c.mode === "COLLECTIVE" ? challengeMinimumLabel(c) : challengeCriterion(c);
  const headcount = `${count} ${count === 1 ? "pessoa" : "pessoas"}`;
  const note = upcoming ? headcount : [rule, headcount].filter(Boolean).join(" · ");

  const standings = [
    c.mode === "COLLECTIVE"
      ? roleStanding(
          view.collective
            ? { result: view.collective.result, target: view.collective.target, periodPrevious: view.collective.periodPrevious, atingiu: view.collective.atingiu, prize: view.collective.prize }
            : null,
          view.status,
          "Equipe ganhou",
          "Equipe não ganhou",
        )
      : null,
    roleStanding(view.management, view.status, "Gerência ganhou", "Gerência não ganhou"),
    roleStanding(view.cashier, view.status, "Operador de caixa ganhou", "Operador de caixa não ganhou"),
  ].filter((item): item is { ok: boolean; label: string } => item != null);

  return (
    <>
      <div className="mt-3.5">
        <ChallengeProgress challenge={c} view={view} />
      </div>
      {standings.length > 0 ? (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {standings.map((item) => (
            <ProgressStanding key={item.label} ok={item.ok}>
              {item.label}
            </ProgressStanding>
          ))}
        </p>
      ) : null}
      {pinNote ? <div className="flex-1" /> : null}
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
  /** No placar, quem já levou mostra "Ganhou". O valor fica no cabeçalho. */
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
          const late = settlesAtEnd(c.metric);
          const above = c.target != null && c.target > 0 && person.result != null && person.result >= c.target;
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
                    <ChallengePersonStatus person={person} disputa={disputa} ended={view.status === "ended"} pct={pct} announcePrize={announcePrize} late={late} above={above} />
                  </span>
                  {late ? null : (
                    <span className="mt-1.5 block">
                      <ProgressBar value={pct} height={5} color={person.result == null ? "var(--line)" : undefined} />
                    </span>
                  )}
                </span>
              </span>
            </li>
          );
        })
      )}
    </ul>
  );
}

function boardPrizeLine(c: ChallengeRecord): string | null {
  if (c.prizes.length === 0) return null;
  if (c.mode === "MINIMUM") {
    const prize = c.prizes[0];
    return prize ? `${prizeLabel(prize)} por pessoa` : null;
  }
  const place = ["1º", "2º", "3º"];
  return c.prizes.map((prize, index) => `${place[index] ?? `${index + 1}º`} ${prizeLabel(prize)}`).join(" · ");
}

function boardWonCount(won: number, people: number): string {
  return `${won} de ${people} ${won === 1 ? "ganhou" : "ganharam"}`;
}

function BoardPersonMark({
  person,
  disputa,
  ended,
  pct,
  late = false,
}: {
  person: ChallengeParticipant;
  disputa: boolean;
  ended: boolean;
  pct: number;
  late?: boolean;
}) {
  if (person.result == null) return <span className="shrink-0 text-[12px] font-semibold text-t3">—</span>;
  if (disputa) {
    if (ended && !person.winner) return <span className="shrink-0 text-[13px] font-semibold text-t1">Não ganhou</span>;
    if (person.position != null) return <ProgressStanding ok={Boolean(ended && person.winner)} tone="acc">{`${person.position}º lugar`}</ProgressStanding>;
    return ended ? <span className="shrink-0 text-[13px] font-semibold text-t1">Não ganhou</span> : <span className="shrink-0 text-[12px] text-t3">—</span>;
  }
  if (person.winner) return <span className="shrink-0 text-[14px] font-extrabold text-acc">Ganhou</span>;
  if (ended) return <span className="shrink-0 text-[13px] font-semibold text-t1">Não ganhou</span>;
  if (late) return null;
  return <span className={`shrink-0 font-mono text-[13px] font-bold tabular-nums ${progressTextClass(pct)}`}>{num(pct, 0)}%</span>;
}

function ChallengePersonStatus({
  person,
  disputa,
  ended,
  pct,
  announcePrize,
  late = false,
  above = false,
}: {
  person: ChallengeParticipant;
  disputa: boolean;
  ended: boolean;
  pct: number;
  announcePrize: boolean;
  late?: boolean;
  above?: boolean;
}) {
  if (person.result == null) return <span className="shrink-0 text-[11px] font-semibold text-t3">Sem resultado</span>;
  const won = announcePrize && person.winner && (!disputa || ended) ? "Ganhou" : null;
  if (won) return <span className="max-w-[11rem] text-right text-[12px] font-semibold leading-tight text-ok">{won}</span>;
  if (disputa && person.position != null) return <ProgressStanding ok={person.winner}>{`${person.position}º lugar`}</ProgressStanding>;
  if (person.winner) return <ProgressStanding ok>Ganhou</ProgressStanding>;
  if (!disputa && ended) return <ProgressStanding ok={false}>Não ganhou</ProgressStanding>;
  return <span className={`shrink-0 font-mono text-[12px] font-bold tabular-nums ${late ? (above ? "text-acc" : "text-t2") : progressTextClass(pct)}`}>{num(pct, 0)}%</span>;
}

/** Barra até a meta. Na disputa sem meta, a barra vai até quem está na frente. */
function challengeProgress(result: number | null, target: number | null, leader: number): number {
  if (result == null || result <= 0) return 0;
  const goal = target != null && target > 0 ? target : leader;
  if (goal <= 0) return 0;
  return Math.min(100, (result / goal) * 100);
}
