import { describe, expect, it } from "vitest";
import { buildProductLineIndex, fragranceOf } from "./productLines";

const CATALOG = [
  "DESOD COL OBSESSED 100ML - WEPINK",
  "DESOD COL OBSESSED DELUXE 100 ML - WEPINK",
  "DESOD COL OBSESSED INTENSE 100ML - WEPINK",
  "BODY SPLASH OBSESSED 200ML - WEPINK",
  "BODY CREAM OBSESSED GOLD 200ML - WEPINK",
  "THE CREAM OBSESSED LOÇÃO CORPORAL 130 ML - WEPINK",
  "BODY SPLASH ONE TOUCH LATTE 200ML - WEPINK",
  "DESOD COL ONE TOUCH SILK 100ML - WEPINK",
  "DESODORANTE ROLL-ON ONE TOUCH LATTE 50ML - WEPINK",
  "BODY SPLASH FUSION FOR HER 200ML - WEPINK",
  "DESOD COL FUSION FOR HIM 100ML - WEPINK",
  "DESOD COL MY WE BELLE 100 ML - WEPINK",
  "DESOD MY KIDS MARSHMALLOW 100ML - WEPINK",
  "AGUA DE COLONIA MY KIDS RAWR 100 ML - WEPINK",
  "DESOD COL GHADAN LIGHT 100 ML - WEPINK",
  "BODY SPLASH GADHAN LIGHT 200ML - WEPINK",
  "DESOD COL WONBLOOM CHARM100ML - WEPINK",
  "DESOD COL VF 27 75ML - WEPINK",
  "BODY SPLASH VF GOLDEN  200 ML - WEPINK",
  "BODY SPLASH RUBY WE PINK 200 ML",
  "SHAMPOO MY HAIR ULTRA REPAIR 250ML - WEPINK",
];

describe("fragranceOf", () => {
  it("tira tipo, tamanho e marca", () => {
    expect(fragranceOf("DESOD COL OBSESSED DELUXE 100 ML - WEPINK")).toEqual({ name: "OBSESSED DELUXE", kind: "Desodorante colônia" });
    expect(fragranceOf("DESODORANTE ROLL-ON MY PROTECTION VF GOLDEN 50 ML - WEPINK")?.name).toBe("VF GOLDEN");
    expect(fragranceOf("DESOD COL VENICE BREEZE - 100 ML - WEPINK")?.name).toBe("VENICE BREEZE");
    expect(fragranceOf("DESOD COL WONBLOOM CHARM100ML - WEPINK")?.name).toBe("WONBLOOM CHARM");
    expect(fragranceOf("BODY SPLASH RUBY WE PINK 200 ML")?.name).toBe("RUBY");
    expect(fragranceOf("THE CREAM LIBERTE LOÇÃO CORPORAL 130 ML - WEPINK")?.name).toBe("LIBERTE");
  });

  it("produto sem fragrância fica sem linha", () => {
    expect(fragranceOf("SHAMPOO MY HAIR ULTRA REPAIR 250ML - WEPINK")).toBeNull();
    expect(fragranceOf("THE CREAM LOÇÃO CORPORAL 130ML - WEPINK")).toBeNull();
    expect(fragranceOf("WHEY 3W PAÇOCA - WP 1KG")).toBeNull();
  });
});

describe("buildProductLineIndex", () => {
  const idx = buildProductLineIndex(CATALOG);
  const line = (d: string) => idx.lineOf(d)?.line ?? null;

  it("agrupa a mesma fragrância em todos os tipos", () => {
    expect(line("DESOD COL OBSESSED DELUXE 100 ML - WEPINK")).toBe("OBSESSED");
    expect(line("DESOD COL OBSESSED INTENSE 100ML - WEPINK")).toBe("OBSESSED");
    expect(line("BODY CREAM OBSESSED GOLD 200ML - WEPINK")).toBe("OBSESSED");
    expect(line("THE CREAM OBSESSED LOÇÃO CORPORAL 130 ML - WEPINK")).toBe("OBSESSED");
    expect(line("BODY SPLASH VF GOLDEN  200 ML - WEPINK")).toBe("VF");
  });

  it("nome da linha = começo comum (várias palavras) e sem conectivo no fim", () => {
    expect(line("DESODORANTE ROLL-ON ONE TOUCH LATTE 50ML - WEPINK")).toBe("ONE TOUCH");
    expect(line("DESOD COL FUSION FOR HIM 100ML - WEPINK")).toBe("FUSION");
  });

  it("1ª palavra genérica usa duas palavras; grafias do ERP unificadas", () => {
    expect(line("DESOD COL MY WE BELLE 100 ML - WEPINK")).toBe("MY WE BELLE");
    expect(line("AGUA DE COLONIA MY KIDS RAWR 100 ML - WEPINK")).toBe("MY KIDS");
    expect(line("BODY SPLASH GADHAN LIGHT 200ML - WEPINK")).toBe("GHADAN LIGHT");
    expect(line("SHAMPOO MY HAIR ULTRA REPAIR 250ML - WEPINK")).toBeNull();
  });

  it("produto fora do catálogo cai na linha do grupo", () => {
    expect(line("BODY SPLASH OBSESSED NOVO 200ML - WEPINK")).toBe("OBSESSED");
  });
});
