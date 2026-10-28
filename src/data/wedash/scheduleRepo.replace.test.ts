import { describe, expect, it } from "vitest";
import { remapCompDue, remapGeneratorSnapshot } from "./scheduleRepo";
import type { GeneratorSnapshot } from "./scheduleGenerate";

describe("remapCompDue", () => {
  it("moves the slot to the new person and drops the new person's old dues", () => {
    expect(
      remapCompDue(
        [
          { personId: "jani", holiday: "2026-11-15", until: "2026-11-30", day: "2026-11-16" },
          { personId: "pati", holiday: "2026-11-02", until: "2026-11-30", day: "2026-11-03" },
          { personId: "other", holiday: "2026-11-20", until: "2026-11-30", day: null },
        ],
        "jani",
        "pati",
      ),
    ).toEqual([
      { personId: "pati", holiday: "2026-11-15", until: "2026-11-30", day: "2026-11-16" },
      { personId: "other", holiday: "2026-11-20", until: "2026-11-30", day: null },
    ]);
  });
});

describe("remapGeneratorSnapshot", () => {
  const base: GeneratorSnapshot = {
    version: 1,
    personIds: ["a", "jani", "c"],
    month: "2026-11",
    model: "6x1",
    employees: [
      { name: "A", sex: "F" },
      { name: "JANIELY", sex: "F" },
      { name: "C", sex: "F" },
    ],
    days: [],
    matrix: [],
    assignment: [],
    startWeek: 0,
    firstSpanish: 0,
    open: [],
    minimum: [],
    holidays: [],
    compDeadline: "seven",
    compensation: [],
  };

  it("swaps the id and name when the new person was not on the team", () => {
    expect(remapGeneratorSnapshot(base, "jani", "pati", "Patricia Vitoria", false)).toEqual({
      ...base,
      personIds: ["a", "pati", "c"],
      employees: [
        { name: "A", sex: "F" },
        { name: "PATRICIA VITORIA", sex: "F" },
        { name: "C", sex: "F" },
      ],
    });
  });

  it("clears the snapshot when the new person already had a slot", () => {
    expect(remapGeneratorSnapshot(base, "jani", "a", "Patricia", true)).toBeNull();
  });
});
