import { describe, expect, it } from "vitest";
import { exportStoreLabel } from "./format";

describe("exportStoreLabel", () => {
  it("turns a technical store code into a readable name and keeps the code underneath", () => {
    expect(exportStoreLabel("LOJAWEPINK.CENTRO.CAMPOGRANDE", "LOJAWEPINK.CENTRO.CAMPOGRANDE")).toEqual({
      name: "Centro Campo Grande",
      detail: "LOJAWEPINK.CENTRO.CAMPOGRANDE",
    });
  });

  it("uses the fantasy name and keeps a different technical code as detail", () => {
    expect(exportStoreLabel("SHOPPING NORTE SUL PLAZA", "LOJAWEPINK.NORTE.SUL")).toEqual({
      name: "Shopping Norte Sul Plaza",
      detail: "LOJAWEPINK.NORTE.SUL",
    });
  });

  it("keeps a short acronym and hides the detail when there is no technical code", () => {
    expect(exportStoreLabel("SB EMPREENDIMENTOS")).toEqual({
      name: "SB Empreendimentos",
      detail: null,
    });
  });
});
