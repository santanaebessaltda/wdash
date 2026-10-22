/** Fatos do placar entre duas leituras. A primeira leitura não comemora o que já estava na tela. */

export interface BoardRank {
  key: string;
  name: string;
  position: number;
}

export interface BoardLevel {
  key: string;
  name: string;
  levelNumber: number | null;
  /** "N1 · Meta". null = ainda sem nível. */
  levelLabel: string | null;
}

export interface BoardWinner {
  challengeId: string;
  challengeName: string;
  key: string;
  name: string;
}

export interface BoardSnapshot {
  ranks: BoardRank[];
  levels: BoardLevel[];
  /** null = meta individual ou a loja ainda não entrou na escada. */
  storeLevelNumber: number | null;
  storeLevelLabel: string | null;
  winners: BoardWinner[];
}

export type BoardMoment =
  | { kind: "first"; key: string; name: string }
  | { kind: "store-level"; level: string }
  | { kind: "challenge"; key: string; name: string; challenge: string }
  | { kind: "level"; key: string; name: string; level: string }
  | { kind: "overtake"; key: string; name: string; passed: string; position: number };

function byKey<T extends { key: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.key, row]));
}

/** Quem esta pessoa deixou para trás: a que agora está logo atrás e antes estava na frente. */
function passedName(person: BoardRank, prev: Map<string, BoardRank>, next: BoardRank[]): string | null {
  const old = prev.get(person.key);
  if (!old || person.position >= old.position) return null;
  const victims = next.filter((other) => {
    if (other.key === person.key) return false;
    const was = prev.get(other.key);
    return was != null && was.position < old.position && other.position > person.position;
  });
  victims.sort((a, b) => a.position - b.position);
  return victims[0]?.name ?? null;
}

const MOMENT_RANK: Record<BoardMoment["kind"], number> = {
  first: 0,
  overtake: 1,
  level: 2,
  "store-level": 3,
  challenge: 4,
};

export function boardMoments(prev: BoardSnapshot | null, next: BoardSnapshot): BoardMoment[] {
  if (!prev) return [];
  const moments: BoardMoment[] = [];
  const prevRank = byKey(prev.ranks);
  const prevLevel = byKey(prev.levels);
  const leader = next.ranks.find((row) => row.position === 1);
  const prevLeader = prev.ranks.find((row) => row.position === 1);
  const tookFirst = leader != null && leader.key !== prevLeader?.key;
  if (tookFirst && leader) moments.push({ kind: "first", key: leader.key, name: leader.name });

  if (
    next.storeLevelNumber != null &&
    next.storeLevelLabel &&
    (prev.storeLevelNumber == null || next.storeLevelNumber > prev.storeLevelNumber)
  ) {
    moments.push({ kind: "store-level", level: next.storeLevelLabel });
  }

  const seenWinners = new Set(prev.winners.map((winner) => `${winner.challengeId}:${winner.key}`));
  const challenges = [...next.winners]
    .filter((winner) => !seenWinners.has(`${winner.challengeId}:${winner.key}`))
    .sort((a, b) => a.challengeName.localeCompare(b.challengeName, "pt-BR") || a.name.localeCompare(b.name, "pt-BR"));
  for (const winner of challenges) {
    moments.push({ kind: "challenge", key: winner.key, name: winner.name, challenge: winner.challengeName });
  }

  const levels = [...next.levels]
    .filter((level) => {
      if (level.levelNumber == null || !level.levelLabel) return false;
      const before = prevLevel.get(level.key);
      if (!before) return false;
      return before.levelNumber == null || level.levelNumber > before.levelNumber;
    })
    .sort((a, b) => (b.levelNumber ?? 0) - (a.levelNumber ?? 0) || a.name.localeCompare(b.name, "pt-BR"));
  for (const level of levels) {
    moments.push({ kind: "level", key: level.key, name: level.name, level: level.levelLabel! });
  }

  const overtakes: BoardMoment[] = [];
  for (const person of next.ranks) {
    if (tookFirst && person.key === leader?.key) continue;
    const passed = passedName(person, prevRank, next.ranks);
    if (!passed) continue;
    overtakes.push({ kind: "overtake", key: person.key, name: person.name, passed, position: person.position });
  }
  overtakes.sort((a, b) => (a.kind === "overtake" && b.kind === "overtake" ? a.position - b.position : 0));
  moments.push(...overtakes);
  moments.sort((a, b) => MOMENT_RANK[a.kind] - MOMENT_RANK[b.kind]);
  return moments;
}
