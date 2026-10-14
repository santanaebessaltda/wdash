import { describe, expect, it } from "vitest";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_COPY,
  applyEnvelopeStatus,
  assignSeller,
  batchLabel,
  channelBlock,
  confirmBlock,
  cpfDigits,
  customDocumentName,
  deliveryFileName,
  fileName,
  firstCpf,
  folderSegments,
  folderTitle,
  groupPages,
  resendVisible,
  saveCpf,
  saveEmail,
  saveWhatsapp,
  shouldSend,
  signaturePositions,
  signedCount,
  sourceRefusal,
} from "./documentSplit";

const VALID = "529.982.247-25";
const VALID_DIGITS = "52998224725";
const OTHER = "390.533.447-05";

describe("saveCpf", () => {
  it("stores 11 digits when the check digits match", () => {
    expect(saveCpf(VALID)).toEqual({ ok: true, cpf: VALID_DIGITS });
    expect(cpfDigits(VALID_DIGITS)).toBe(VALID_DIGITS);
  });

  it("rejects a CPF whose check digits fail", () => {
    expect(saveCpf("529.982.247-26")).toEqual({ ok: false, message: DOCUMENT_COPY.badCpf });
    expect(saveCpf("123")).toEqual({ ok: false, message: "CPF inválido." });
  });
});

describe("saveWhatsapp", () => {
  it("stores 10 or 11 digits and clears an empty field", () => {
    expect(saveWhatsapp("(11) 98765-4321")).toEqual({ ok: true, whatsapp: "11987654321" });
    expect(saveWhatsapp("1132654321")).toEqual({ ok: true, whatsapp: "1132654321" });
    expect(saveWhatsapp("  ")).toEqual({ ok: true, whatsapp: null });
  });

  it("rejects a number that is not 10 or 11 digits", () => {
    expect(saveWhatsapp("123")).toEqual({ ok: false, message: "WhatsApp inválido." });
  });
});

describe("saveEmail", () => {
  it("keeps an empty e-mail and rejects text without @", () => {
    expect(saveEmail("")).toEqual({ ok: true, email: null });
    expect(saveEmail("ana@loja.com")).toEqual({ ok: true, email: "ana@loja.com" });
    expect(saveEmail("ana-loja.com")).toEqual({ ok: false, message: "E-mail inválido." });
  });
});

describe("categories", () => {
  it("accepts only the payroll categories", () => {
    expect([...DOCUMENT_CATEGORIES]).toEqual([
      "Holerite",
      "Espelho de ponto",
      "Adiantamento salarial",
      "Vale transporte",
      "Vale alimentação / refeição",
      "Participação nos lucros (PLR)",
      "Informe de rendimentos",
      "Outros",
    ]);
  });
});

describe("groupPages", () => {
  const pages = [
    { sourceIndex: 0, pageNumber: 1, text: `Holerite ${VALID}` },
    { sourceIndex: 0, pageNumber: 2, text: `Vale ${VALID_DIGITS}` },
    { sourceIndex: 1, pageNumber: 1, text: `Ponto ${OTHER}` },
    { sourceIndex: 1, pageNumber: 2, text: "sem documento" },
  ];

  it("builds one PDF per CPF when unify is on, and leaves a page without CPF alone", () => {
    expect(groupPages(pages, true)).toEqual([
      {
        cpf: VALID_DIGITS,
        pages: [
          { sourceIndex: 0, pageNumber: 1 },
          { sourceIndex: 0, pageNumber: 2 },
        ],
      },
      { cpf: "39053344705", pages: [{ sourceIndex: 1, pageNumber: 1 }] },
      { cpf: null, pages: [{ sourceIndex: 1, pageNumber: 2 }] },
    ]);
  });

  it("builds one PDF when the same CPF appears in two source files", () => {
    expect(
      groupPages(
        [
          { sourceIndex: 0, pageNumber: 1, text: `Holerite ${VALID}` },
          { sourceIndex: 1, pageNumber: 3, text: `Outro ${VALID}` },
        ],
        true,
      ),
    ).toEqual([
      {
        cpf: VALID_DIGITS,
        pages: [
          { sourceIndex: 0, pageNumber: 1 },
          { sourceIndex: 1, pageNumber: 3 },
        ],
      },
    ]);
  });

  it("builds one PDF per page when unify is off", () => {
    const groups = groupPages(pages.slice(0, 2), false);
    expect(groups).toHaveLength(2);
    expect(groups.every((group) => group.pages.length === 1)).toBe(true);
    expect(groups[0].cpf).toBe(VALID_DIGITS);
  });

  it("uses the first valid CPF when a page has two", () => {
    expect(firstCpf(`ruim 123.456.789-00 depois ${OTHER}`)).toBe("39053344705");
  });
});

describe("assignSeller", () => {
  it("assigns the only employee with that CPF", () => {
    expect(assignSeller([{ id: "ana" }])).toBe("ana");
  });

  it("leaves the page unassigned when nobody or more than one employee matches", () => {
    expect(assignSeller([])).toBeNull();
    expect(assignSeller([{ id: "ana" }, { id: "bia" }])).toBeNull();
  });
});

describe("fileName", () => {
  it("names the first file with the category and the next with a suffix", () => {
    expect(fileName("Holerite", [])).toBe("Holerite.pdf");
    expect(fileName("Holerite", ["Holerite.pdf"])).toBe("Holerite (2).pdf");
    expect(fileName("Holerite", ["Holerite.pdf", "Holerite (2).pdf"])).toBe("Holerite (3).pdf");
  });
});

describe("deliveryFileName", () => {
  it("keeps the short name in the folder and adds the person, month and year for the file that leaves", () => {
    expect(folderTitle("Holerite.pdf")).toBe("Holerite");
    expect(deliveryFileName("Holerite.pdf", "Maria Eduarda", 10, 2026)).toBe("Holerite-Maria-Eduarda-Outubro-2026.pdf");
    expect(deliveryFileName("Termo de férias.pdf", "Maria Eduarda", 10, 2026)).toBe("Termo de férias-Maria-Eduarda-Outubro-2026.pdf");
  });

  it("accepts a custom name for Outros and rejects an empty one", () => {
    expect(customDocumentName("  Termo de férias.pdf ")).toEqual({ ok: true, name: "Termo de férias" });
    expect(customDocumentName("   ").ok).toBe(false);
  });
});

describe("folderSegments", () => {
  it("starts at the employee for one store and at the store when all stores are selected", () => {
    expect(folderSegments({ allStores: false, storeName: "Campo Grande", employeeName: "Ana", year: 2026, month: 10 })).toEqual([
      "Ana",
      "2026",
      "Outubro",
    ]);
    expect(folderSegments({ allStores: true, storeName: "Campo Grande", employeeName: "Ana", year: 2026, month: 10 })).toEqual([
      "Campo Grande",
      "Ana",
      "2026",
      "Outubro",
    ]);
  });
});

describe("batchLabel", () => {
  it("is Assinado only when every document is Assinado", () => {
    expect(batchLabel(["SIGNED", "SIGNED"])).toBe("Assinado");
    expect(batchLabel(["SIGNED", "PENDING"])).toBe("Pendente");
    expect(batchLabel(["SIGNED", "DECLINED"])).toBe("Pendente");
    expect(batchLabel(["SIGNED", "EXPIRED"])).toBe("Pendente");
    expect(batchLabel([])).toBe("Pendente");
    expect(signedCount(["SIGNED", "DECLINED", "EXPIRED"])).toBe(1);
  });
});

describe("sourceRefusal", () => {
  const ok = { mime: "application/pdf", bytes: 1000, pages: 2, hasText: true, alreadyAccepted: 0 };

  it("refuses a file that is not a PDF, a sixth file, an oversized file, or a scan", () => {
    expect(sourceRefusal({ ...ok, mime: "image/png" })).toBe("Envie apenas PDF.");
    expect(sourceRefusal({ ...ok, alreadyAccepted: 5 })).toBe("O lote aceita até 5 PDFs.");
    expect(sourceRefusal({ ...ok, bytes: 15 * 1024 * 1024 + 1 })).toBe("Cada PDF de origem aceita até 15 MB e 1.000 páginas.");
    expect(sourceRefusal({ ...ok, pages: 1001 })).toBe("Cada PDF de origem aceita até 15 MB e 1.000 páginas.");
    expect(sourceRefusal({ ...ok, hasText: false })).toBe(DOCUMENT_COPY.scanned);
    expect(sourceRefusal(ok)).toBeNull();
  });
});

describe("confirm and resend", () => {
  it("blocks confirm without a token, a deadline, a contact, or a PDF over 5 MB", () => {
    expect(confirmBlock({ deadline: "2026-11-13", hasToken: false, sizeBytes: 10 })).toBe(DOCUMENT_COPY.noToken);
    expect(confirmBlock({ deadline: null, hasToken: true, sizeBytes: 10 })).toBe("Informe a data limite.");
    expect(confirmBlock({ deadline: "2026-11-13", hasToken: true, sizeBytes: 5 * 1024 * 1024 + 1 })).toBe(DOCUMENT_COPY.overEnvelope);
    expect(channelBlock("WHATSAPP", { email: "a@b.com", whatsapp: null })).toBe("Sem WhatsApp neste cadastro.");
    expect(channelBlock("EMAIL", { email: null, whatsapp: "11987654321" })).toBe("Sem e-mail neste cadastro.");
    expect(confirmBlock({ deadline: "2026-11-13", hasToken: true, sizeBytes: 10 })).toBeNull();
  });

  it("does not create a second envelope and does not resend a signed row", () => {
    expect(shouldSend({ envelopeId: "env", sellerId: "ana", block: null })).toBe(false);
    expect(shouldSend({ envelopeId: null, sellerId: null, block: null })).toBe(false);
    expect(shouldSend({ envelopeId: null, sellerId: "ana", block: "Sem e-mail neste cadastro." })).toBe(false);
    expect(shouldSend({ envelopeId: null, sellerId: "ana", block: null })).toBe(true);
    expect(resendVisible("PENDING")).toBe(true);
    expect(resendVisible("SIGNED")).toBe(false);
    expect(resendVisible("DECLINED")).toBe(false);
    expect(resendVisible("EXPIRED")).toBe(false);
  });

  it("keeps Assinado when a later webhook arrives and maps CANCELED to Recusado", () => {
    expect(applyEnvelopeStatus("PENDING", "COMPLETED")).toBe("SIGNED");
    expect(applyEnvelopeStatus("PENDING", "DECLINED")).toBe("DECLINED");
    expect(applyEnvelopeStatus("PENDING", "EXPIRED")).toBe("EXPIRED");
    expect(applyEnvelopeStatus("PENDING", "CANCELED")).toBe("DECLINED");
    expect(applyEnvelopeStatus("SIGNED", "DECLINED")).toBe("SIGNED");
    expect(applyEnvelopeStatus("SIGNED", "EXPIRED")).toBe("SIGNED");
    expect(applyEnvelopeStatus("PENDING", "SENT_FOR_SIGNATURE")).toBe("PENDING");
  });

  it("places one signature at the center of every page", () => {
    expect(signaturePositions(2)).toEqual([
      { pageNumber: 1, x: 50, y: 50, element: "SIGNATURE" },
      { pageNumber: 2, x: 50, y: 50, element: "SIGNATURE" },
    ]);
  });
});
