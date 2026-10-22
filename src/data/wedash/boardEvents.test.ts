import { describe, expect, it } from "vitest";
import { boardMoments, type BoardSnapshot } from "./boardEvents";

const empty = (): BoardSnapshot => ({
  ranks: [],
  levels: [],
  storeLevelNumber: null,
  storeLevelLabel: null,
  winners: [],
});

function rank(key: string, name: string, position: number) {
  return { key, name, position };
}

describe("boardMoments", () => {
  it("a primeira leitura não dispara faixa", () => {
    const next = empty();
    next.ranks = [rank("a", "Ana", 1)];
    expect(boardMoments(null, next)).toEqual([]);
  });

  it("sem mudança não dispara faixa", () => {
    const snap = empty();
    snap.ranks = [rank("a", "Ana", 1), rank("b", "Bia", 2)];
    snap.levels = [{ key: "a", name: "Ana", levelNumber: 1, levelLabel: "N1 · Meta" }];
    snap.storeLevelNumber = 1;
    snap.storeLevelLabel = "N1 · Meta";
    snap.winners = [{ challengeId: "c", challengeName: "Pizza", key: "a", name: "Ana" }];
    expect(boardMoments(snap, snap)).toEqual([]);
  });

  it("quem assume o 1º não ganha também a faixa de ultrapassagem", () => {
    const prev = empty();
    prev.ranks = [rank("a", "Ana", 1), rank("b", "Bia", 2)];
    const next = empty();
    next.ranks = [rank("b", "Bia", 1), rank("a", "Ana", 2)];
    expect(boardMoments(prev, next)).toEqual([{ kind: "first", key: "b", name: "Bia" }]);
  });

  it("ultrapassagem fora do 1º cita quem ficou para trás", () => {
    const prev = empty();
    prev.ranks = [rank("a", "Ana", 1), rank("b", "Bia", 2), rank("c", "Caio", 3)];
    const next = empty();
    next.ranks = [rank("a", "Ana", 1), rank("c", "Caio", 2), rank("b", "Bia", 3)];
    expect(boardMoments(prev, next)).toEqual([
      { kind: "overtake", key: "c", name: "Caio", passed: "Bia", position: 2 },
    ]);
  });

  it("pessoa nova no 3º não conta como ultrapassagem", () => {
    const prev = empty();
    prev.ranks = [rank("a", "Ana", 1)];
    const next = empty();
    next.ranks = [rank("a", "Ana", 1), rank("b", "Bia", 2)];
    expect(boardMoments(prev, next)).toEqual([]);
  });

  it("subir de nível só dispara se a pessoa já estava na leitura anterior", () => {
    const prev = empty();
    prev.levels = [{ key: "a", name: "Ana", levelNumber: null, levelLabel: null }];
    const next = empty();
    next.levels = [
      { key: "a", name: "Ana", levelNumber: 1, levelLabel: "N1 · Meta" },
      { key: "b", name: "Bia", levelNumber: 2, levelLabel: "N2 · Super" },
    ];
    expect(boardMoments(prev, next)).toEqual([{ kind: "level", key: "a", name: "Ana", level: "N1 · Meta" }]);
  });

  it("a loja mudando de nível dispara uma faixa", () => {
    const prev = empty();
    prev.storeLevelNumber = 1;
    prev.storeLevelLabel = "N1 · Meta";
    const next = empty();
    next.storeLevelNumber = 2;
    next.storeLevelLabel = "N2 · Super";
    expect(boardMoments(prev, next)).toEqual([{ kind: "store-level", level: "N2 · Super" }]);
  });

  it("prioriza liderança, ultrapassagem, nível, loja e desafio", () => {
    const prev = empty();
    prev.ranks = [rank("a", "Ana", 1), rank("b", "Bia", 2), rank("c", "Caio", 3)];
    prev.levels = [{ key: "b", name: "Bia", levelNumber: 1, levelLabel: "N1 · Meta" }];
    prev.storeLevelNumber = 1;
    prev.storeLevelLabel = "N1 · Meta";
    const next = empty();
    next.ranks = [rank("b", "Bia", 1), rank("c", "Caio", 2), rank("a", "Ana", 3)];
    next.levels = [{ key: "b", name: "Bia", levelNumber: 2, levelLabel: "N2 · Super" }];
    next.storeLevelNumber = 2;
    next.storeLevelLabel = "N2 · Super";
    next.winners = [{ challengeId: "c", challengeName: "Pizza", key: "b", name: "Bia" }];
    expect(boardMoments(prev, next).map((moment) => moment.kind)).toEqual(["first", "overtake", "level", "store-level", "challenge"]);
  });

  it("desafio já batido não toca de novo", () => {
    const prev = empty();
    prev.winners = [{ challengeId: "c", challengeName: "Pizza", key: "a", name: "Ana" }];
    const next = empty();
    next.winners = [
      { challengeId: "c", challengeName: "Pizza", key: "a", name: "Ana" },
      { challengeId: "c", challengeName: "Pizza", key: "b", name: "Bia" },
    ];
    expect(boardMoments(prev, next)).toEqual([
      { kind: "challenge", key: "b", name: "Bia", challenge: "Pizza" },
    ]);
  });
});
