import { describe, expect, it, vi } from "vitest";
import {
  fetchStoreSellers,
  isSellerActive,
  isStoreSeller,
  departedOnForSync,
  parseAdmissionDate,
  parseFuncionarioFlags,
  parseFuncionarioGerador,
  parseFuncionariosLista,
} from "./millenniumSellers.ts";

const lista = {
  "odata.count": 2,
  value: [
    { FUNCIONARIO: 40585, COD_FUNCIONARIO: "0343", NOME: "GABRIELA SILVA", LOGIN: "gabi", CARGO: "VENDEDOR" },
    { FUNCIONARIO: 20656, COD_FUNCIONARIO: "0665", NOME: "MONISSA LIMA", LOGIN: "", CARGO: "VENDEDOR" },
    { FUNCIONARIO: null, NOME: "SEM ID" },
  ],
};

function consulta(flags: {
  desativado?: boolean;
  afastado?: boolean;
  naoMostrar?: boolean;
  inativo?: boolean;
  gerador?: number;
}) {
  return {
    value: [
      {
        INATIVO: flags.inativo ?? false,
        AFASTADO: flags.afastado ?? false,
        NAO_MOSTRAR_NO_EVENTO: flags.naoMostrar ?? false,
        DATA_ADMISSAO: "2026-05-01T03:00:00.000Z",
        GERADORES: [{ DESATIVADO: flags.desativado ?? false, GERADOR: flags.gerador ?? null }],
      },
    ],
  };
}

describe("parseFuncionariosLista", () => {
  it("lê id, código, nome e login; ignora linha sem id", () => {
    expect(parseFuncionariosLista(lista)).toEqual([
      { employeeId: 40585, code: "0343", name: "Gabriela Silva", login: "gabi", role: "VENDEDOR" },
      { employeeId: 20656, code: "0665", name: "Monissa Lima", login: null, role: "VENDEDOR" },
    ]);
  });
});

describe("isStoreSeller", () => {
  it("ativa só com cargo VENDEDOR; inativa de qualquer cargo (desativar vira INDEFINIDO)", () => {
    expect(isStoreSeller("VENDEDOR", true)).toBe(true);
    expect(isStoreSeller("INDEFINIDO", true)).toBe(false);
    expect(isStoreSeller("", true)).toBe(false);
    expect(isStoreSeller("INDEFINIDO", false)).toBe(true);
    expect(isStoreSeller("VENDEDOR", false)).toBe(true);
  });
});

describe("flags", () => {
  it("DESATIVADO vem de GERADORES[0]", () => {
    expect(parseFuncionarioFlags(consulta({ desativado: true })).desativado).toBe(true);
  });

  it("qualquer flag deixa inativa", () => {
    expect(isSellerActive(parseFuncionarioFlags(consulta({})))).toBe(true);
    expect(isSellerActive(parseFuncionarioFlags(consulta({ naoMostrar: true })))).toBe(false);
    expect(isSellerActive(parseFuncionarioFlags(consulta({ afastado: true })))).toBe(false);
  });
});

describe("fetchStoreSellers", () => {
  it("Lista sem cargo + Consulta; guarda todos com o cargo (gerência ativa e ex-vendedora INDEFINIDO)", async () => {
    const storeList = {
      value: [
        ...lista.value,
        { FUNCIONARIO: 162866, COD_FUNCIONARIO: "", NOME: "DONO DA LOJA", CARGO: null },
        { FUNCIONARIO: 102015, COD_FUNCIONARIO: "0100", NOME: "JULIANA", CARGO: "INDEFINIDO" },
      ],
    };
    const inativas = new Set([20656, 102015]);
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (url.includes("FUNCIONARIOS.Lista")) {
        expect(body).toMatchObject({ FILIAL: 8, CARGO: null });
        return new Response(JSON.stringify(storeList));
      }
      return new Response(JSON.stringify(consulta({ desativado: inativas.has(body.FUNCIONARIO) })));
    });
    const out = await fetchStoreSellers({
      session: "s",
      millenniumStoreId: 8,
      baseUrl: "http://erp.test/api",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out.map((s) => [s.employeeId, s.role, s.active])).toEqual([
      [40585, "VENDEDOR", true],
      [20656, "VENDEDOR", false],
      [162866, "", true],
      [102015, "INDEFINIDO", false],
    ]);
  });

  it("known: gerador salvo e mesmo cargo entra só pela Lista; cargo mudou → consulta de novo", async () => {
    const listaCargos = {
      value: [
        lista.value[0],
        { FUNCIONARIO: 20656, COD_FUNCIONARIO: "0665", NOME: "MONISSA LIMA", CARGO: "INDEFINIDO" },
      ],
    };
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (url.includes("FUNCIONARIOS.Lista")) return new Response(JSON.stringify(listaCargos));
      return new Response(JSON.stringify(consulta({ gerador: body.FUNCIONARIO + 1, desativado: true })));
    });
    const out = await fetchStoreSellers({
      session: "s",
      millenniumStoreId: 8,
      known: new Map([
        [40585, { role: "VENDEDOR", admittedOn: "2026-01-01" }],
        [20656, { role: "VENDEDOR", admittedOn: "2026-01-01" }],
      ]),
      baseUrl: "http://erp.test/api",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(out.map((s) => [s.employeeId, s.active, s.geradorId])).toEqual([
      [40585, null, null],
      [20656, false, 20657],
    ]);
  });
});

describe("datas", () => {
  it("lê a admissão em Brasília e ignora vazio", () => {
    expect(parseAdmissionDate(consulta({}))).toBe("2026-05-01");
    expect(parseAdmissionDate({ value: [{ DATA_ADMISSAO: null }] })).toBeNull();
  });

  it("grava a saída só na passagem de ativa para inativa", () => {
    expect(departedOnForSync({ active: true, departedOn: null }, false, "2026-10-16")).toBe("2026-10-16");
    expect(departedOnForSync({ active: false, departedOn: "2026-10-10" }, false, "2026-10-16")).toBe("2026-10-10");
    expect(departedOnForSync({ active: false, departedOn: null }, false, "2026-10-16")).toBeNull();
    expect(departedOnForSync({ active: false, departedOn: "2026-10-10" }, true, "2026-10-16")).toBeNull();
    expect(departedOnForSync(undefined, null, "2026-10-16")).toBeUndefined();
  });
});

describe("parseFuncionarioGerador", () => {
  it("lê GERADORES[0].GERADOR", () => {
    expect(parseFuncionarioGerador(consulta({ gerador: 66161 }))).toBe(66161);
    expect(parseFuncionarioGerador(consulta({}))).toBeNull();
  });
});
