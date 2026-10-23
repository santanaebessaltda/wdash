import { describe, expect, it } from "vitest";
import { buildWalletMonth, groupWalletPeople, managersForStore, splitEqualCents, walletInRange, type WalletCashDay, type WalletChallengeInput, type WalletGoalInput, type WalletPersonInput, type WalletPersonMonth } from "./wallet";

const people: WalletPersonInput[] = [
  { id: "ana", name: "ANA" },
  { id: "bia", name: "BIA" },
];

const goal = (over: Partial<WalletGoalInput> = {}): WalletGoalInput => ({
  name: "Outubro",
  endsOn: "2026-10-31",
  open: false,
  people: [
    { personId: "ana", prizeCents: 10_000, bonusCents: 5_000 },
    { personId: "bia", prizeCents: 0, bonusCents: 0 },
  ],
  ...over,
});

function month(over: {
  goals?: WalletGoalInput[];
  challenges?: WalletChallengeInput[];
  days?: WalletCashDay[];
  onlyPersonId?: string | null;
} = {}) {
  return buildWalletMonth({
    month: "2026-10",
    people,
    goals: over.goals ?? [],
    challenges: over.challenges ?? [],
    days: over.days ?? [],
    onlyPersonId: over.onlyPersonId,
  });
}

describe("buildWalletMonth", () => {
  it("puts prize and bonus in the month the goal ends", () => {
    const october = month({ goals: [goal(), goal({ name: "Novembro", endsOn: "2026-11-30", people: [{ personId: "ana", prizeCents: 99_00, bonusCents: 0 }] })] });
    const ana = october.people.find((row) => row.personId === "ana");
    expect(ana?.prizeCents).toBe(10_000);
    expect(ana?.bonusCents).toBe(5_000);
    expect(ana?.balanceCents).toBe(15_000);
    expect(ana?.lines.map((line) => line.kind)).toEqual(["prize", "bonus"]);
  });

  it("keeps an open goal as until now", () => {
    const view = month({ goals: [goal({ open: true, people: [{ personId: "ana", prizeCents: 2_000, bonusCents: 0 }] })] });
    const ana = view.people[0];
    expect(ana.openPrize).toBe(true);
    expect(ana.lines[0]).toMatchObject({ kind: "prize", cents: 2_000, open: true });
    expect(ana.balanceCents).toBe(2_000);
  });

  it("shows an open goal even when the prize is still zero", () => {
    const view = month({ goals: [goal({ open: true, people: [{ personId: "bia", prizeCents: 0, bonusCents: 0 }] })] });
    expect(view.people.map((row) => row.personId)).toEqual(["bia"]);
    expect(view.people[0].balanceCents).toBe(0);
    expect(view.people[0].lines[0].open).toBe(true);
  });

  it("adds challenge money and leaves an item prize out of the balance", () => {
    const view = month({
      challenges: [
        {
          name: "Perfume",
          endsOn: "2026-10-20",
          open: false,
          people: [
            { personId: "ana", moneyCents: 3_000, itemLabel: null },
            { personId: "bia", moneyCents: 0, itemLabel: "Kit" },
          ],
        },
        { name: "Novembro", endsOn: "2026-11-02", open: false, people: [{ personId: "ana", moneyCents: 8_000, itemLabel: null }] },
      ],
    });
    const ana = view.people.find((row) => row.personId === "ana");
    const bia = view.people.find((row) => row.personId === "bia");
    expect(ana?.challengeCents).toBe(3_000);
    expect(ana?.balanceCents).toBe(3_000);
    expect(bia?.challengeCents).toBe(0);
    expect(bia?.balanceCents).toBe(0);
    expect(bia?.lines[0].note).toBe("Kit");
  });

  it("shows an open challenge without adding it to the balance", () => {
    const view = month({
      challenges: [{ name: "Corrida", endsOn: "2026-10-31", open: true, people: [{ personId: "ana", moneyCents: 9_000, itemLabel: null }] }],
    });
    expect(view.people[0].challengeCents).toBe(0);
    expect(view.people[0].balanceCents).toBe(0);
    expect(view.people[0].lines[0]).toMatchObject({ open: true, note: "Em andamento", cents: 0 });
  });

  it("subtracts withdrawals and shortage, and keeps a break with no destination on the branch", () => {
    const view = month({
      goals: [goal()],
      days: [
        {
          day: "2026-10-03",
          withdrawals: [{ personId: "ana", cents: 4_000 }],
          shortage: [{ personId: "ana", cents: 1_000 }],
          unassignedShortageCents: 250,
        },
        {
          day: "2026-10-04",
          withdrawals: [{ personId: "bia", cents: 500 }],
          shortage: [],
          unassignedShortageCents: 0,
        },
      ],
    });
    const ana = view.people.find((row) => row.personId === "ana");
    expect(ana?.withdrawalCents).toBe(4_000);
    expect(ana?.shortageCents).toBe(1_000);
    expect(ana?.balanceCents).toBe(10_000 + 5_000 - 4_000 - 1_000);
    expect(view.unassignedShortageCents).toBe(250);
    expect(view.unassignedShortageDays).toEqual([{ day: "2026-10-03", cents: 250 }]);
    expect(view.people.map((row) => row.personId)).toEqual(["ana", "bia"]);
  });

  it("returns only one person and hides the branch break", () => {
    const view = month({
      goals: [goal()],
      days: [{ day: "2026-10-03", withdrawals: [{ personId: "bia", cents: 100 }], shortage: [], unassignedShortageCents: 900 }],
      onlyPersonId: "ana",
    });
    expect(view.people.map((row) => row.personId)).toEqual(["ana"]);
    expect(view.unassignedShortageCents).toBe(0);
    expect(view.unassignedShortageDays).toEqual([]);
    expect(view.people[0].prizeCents).toBe(10_000);
  });

  it("adds the manager share already split to earnings and the balance", () => {
    const view = month({
      goals: [
        goal({
          people: [{ personId: "ana", prizeCents: 0, bonusCents: 0, managementPrizeCents: 6_000, managementBonusCents: 1_000 }],
        }),
      ],
    });
    const ana = view.people[0];
    expect(ana.managementCents).toBe(7_000);
    expect(ana.balanceCents).toBe(7_000);
    expect(ana.prizeCents).toBe(0);
    expect(ana.lines.map((line) => line.kind)).toEqual(["management", "managementBonus"]);
  });

  it("keeps a challenge item for the manager outside the balance", () => {
    const view = month({
      challenges: [
        {
          name: "Outubro",
          endsOn: "2026-10-31",
          open: false,
          people: [{ personId: "ana", moneyCents: 0, itemLabel: "Kit", management: true }],
        },
      ],
    });
    const ana = view.people[0];
    expect(ana.managementCents).toBe(0);
    expect(ana.balanceCents).toBe(0);
    expect(ana.lines).toEqual([
      { kind: "management", title: "Outubro", day: "2026-10-31", cents: 0, open: false, note: "Kit" },
    ]);
  });

  it("gives the branch prize to the managers of that branch", () => {
    const managers = [
      { id: "joyce", name: "Joyce", storeIds: ["tres"] },
      { id: "laura", name: "Laura", storeIds: [] },
      { id: "luiz", name: "Luiz", storeIds: ["outra"] },
    ];
    expect(managersForStore(managers, "tres").map((manager) => manager.id)).toEqual(["joyce"]);
    expect(managersForStore(managers, "campo").map((manager) => manager.id)).toEqual(["laura"]);
    expect(managersForStore(managers, "outra").map((manager) => manager.id)).toEqual(["luiz"]);
  });

  it("splits cents equally and leaves the remainder on the first shares", () => {
    expect(splitEqualCents(1_000, 3)).toEqual([334, 333, 333]);
    expect(splitEqualCents(0, 2)).toEqual([0, 0]);
  });

  it("keeps only the lines inside the selected period", () => {
    const view = month({
      goals: [goal()],
      days: [{ day: "2026-10-03", withdrawals: [{ personId: "ana", cents: 400 }], shortage: [], unassignedShortageCents: 0 }],
    });
    const clipped = walletInRange([view], "2026-10-01", "2026-10-15");
    const ana = clipped.people.find((row) => row.personId === "ana");
    expect(ana?.lines.map((line) => line.kind)).toEqual(["withdrawal"]);
    expect(ana?.balanceCents).toBe(-400);
    const full = walletInRange([view], "2026-10-01", "2026-10-31");
    expect(full.people.find((row) => row.personId === "ana")?.balanceCents).toBe(15_000 - 400);
  });

  it("keeps an open goal inside the month when the period stops before it ends", () => {
    const view = month({ goals: [goal({ open: true })] });
    const clipped = walletInRange([view], "2026-10-01", "2026-10-23");
    const ana = clipped.people.find((row) => row.personId === "ana");
    expect(ana?.prizeCents).toBe(10_000);
    expect(ana?.lines.map((line) => line.kind)).toEqual(["prize", "bonus"]);
    expect(walletInRange([view], "2026-09-01", "2026-09-30").people).toEqual([]);
  });

  it("keeps the seller row when the month is empty", () => {
    const view = month({ onlyPersonId: "ana" });
    expect(view.people).toEqual([
      expect.objectContaining({ personId: "ana", balanceCents: 0, lines: [] }),
    ]);
  });
});

function placed(person: WalletPersonMonth, storeId: string, storeName: string) {
  return { ...person, storeId, storeName };
}

function walletPerson(over: Partial<WalletPersonMonth> & Pick<WalletPersonMonth, "personId" | "name">): WalletPersonMonth {
  return {
    prizeCents: 0,
    bonusCents: 0,
    managementCents: 0,
    challengeCents: 0,
    withdrawalCents: 0,
    shortageCents: 0,
    balanceCents: 0,
    openPrize: false,
    lines: [],
    ...over,
  };
}

describe("groupWalletPeople", () => {
  it("sums one manager across branches and keeps each branch", () => {
    const santana = walletPerson({
      personId: "joyce",
      name: "JOYCE",
      prizeCents: 1_000,
      withdrawalCents: 100,
      balanceCents: 900,
      lines: [{ kind: "prize", title: "Meta", day: "2026-10-31", cents: 1_000, open: false, note: null }],
    });
    const centro = walletPerson({
      personId: "joyce",
      name: "JOYCE",
      managementCents: 2_500,
      balanceCents: 2_500,
      openPrize: true,
      lines: [{ kind: "management", title: "Meta", day: "2026-10-31", cents: 2_500, open: true, note: null }],
    });
    const ana = walletPerson({
      personId: "ana",
      name: "ANA",
      prizeCents: 500,
      balanceCents: 500,
      lines: [{ kind: "prize", title: "Meta", day: "2026-10-31", cents: 500, open: false, note: null }],
    });
    const rows = groupWalletPeople([
      placed(santana, "santana", "Santana"),
      placed(ana, "santana", "Santana"),
      placed(centro, "centro", "Centro"),
    ]);
    expect(rows.map((row) => row.personId)).toEqual(["joyce", "ana"]);
    const joyce = rows[0];
    expect(joyce?.storeName).toBe("2 filiais");
    expect(joyce?.prizeCents).toBe(1_000);
    expect(joyce?.managementCents).toBe(2_500);
    expect(joyce?.withdrawalCents).toBe(100);
    expect(joyce?.balanceCents).toBe(3_400);
    expect(joyce?.openPrize).toBe(true);
    expect(joyce?.branches.map((branch) => branch.storeName)).toEqual(["Centro", "Santana"]);
    expect(joyce?.branches.map((branch) => branch.person.balanceCents)).toEqual([2_500, 900]);
    expect(rows[1]?.storeName).toBe("Santana");
    expect(rows[1]?.branches).toHaveLength(1);
  });
});
