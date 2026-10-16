import { describe, expect, it } from "vitest";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_COPY,
  applyEnvelopeStatus,
  assignSeller,
  rematchAssignment,
  batchLabel,
  carryDraft,
  channelBlock,
  collaboratorRecipientId,
  confirmBlock,
  initialSigners,
  mergeSignerProgress,
  nextSignerStatus,
  progressForEnvelope,
  signerCaption,
  partialEnvelopeLabel,
  visibleSigners,
  contactFieldsToAsk,
  contactPatch,
  cpfDigits,
  categoryLabel,
  customDocumentName,
  defaultDraft,
  defaultSignatureMark,
  nextMarkSigner,
  settleDocumentSigners,
  deliveryFileName,
  documentPeople,
  documentPersonKey,
  markChoiceValue,
  markSignerId,
  archivePeople,
  archiveRefusal,
  inLibrary,
  isFiledStatus,
  signingPeople,
  documentIssue,
  findDocumentPerson,
  parsePersonRef,
  personMatchesQuery,
  preparationReason,
  preparationSituation,
  envelopeSignatures,
  fileName,
  firstCpf,
  folderSegments,
  folderTitle,
  displayTitle,
  groupPages,
  markAfterDrop,
  placementWarning,
  remainingPages,
  replicateSetup,
  resolveDrafts,
  sameCategory,
  resendVisible,
  saveCpf,
  saveEmail,
  saveWhatsapp,
  shouldSend,
  signatureDeadlineAt,
  signaturePositions,
  signedCount,
  signerHistory,
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
    expect(saveCpf("123")).toEqual({ ok: false, message: "Informe um CPF válido." });
  });
});

describe("saveWhatsapp", () => {
  it("stores 10 or 11 digits and clears an empty field", () => {
    expect(saveWhatsapp("(11) 98765-4321")).toEqual({ ok: true, whatsapp: "11987654321" });
    expect(saveWhatsapp("1132654321")).toEqual({ ok: true, whatsapp: "1132654321" });
    expect(saveWhatsapp("  ")).toEqual({ ok: true, whatsapp: null });
  });

  it("rejects a number that is not 10 or 11 digits", () => {
    expect(saveWhatsapp("123")).toEqual({ ok: false, message: "Informe um WhatsApp válido com DDD." });
  });
});

describe("saveEmail", () => {
  it("keeps an empty e-mail and rejects text without @", () => {
    expect(saveEmail("")).toEqual({ ok: true, email: null });
    expect(saveEmail("ana@loja.com")).toEqual({ ok: true, email: "ana@loja.com" });
    expect(saveEmail("ana-loja.com")).toEqual({ ok: false, message: "Informe um e-mail válido." });
  });
});

describe("categories", () => {
  it("accepts only the payroll categories", () => {
    expect([...DOCUMENT_CATEGORIES]).toEqual([
      "Holerite",
      "Espelho de ponto",
      "Adiantamento salarial",
      "Vale-transporte",
      "Vale-alimentação / refeição",
      "Participação nos lucros (PLR)",
      "Informe de rendimentos",
      "Documentos admissionais",
      "Documentos rescisórios",
      "Outros",
    ]);
    expect(categoryLabel("Admissão")).toBe("Documentos admissionais");
    expect(categoryLabel("Rescisão")).toBe("Documentos rescisórios");
    expect(sameCategory("Admissão", "Documentos admissionais")).toBe(true);
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

  it("joins pages without a CPF when the batch has one collaborator", () => {
    expect(
      groupPages(
        [
          { sourceIndex: 0, pageNumber: 1, text: "Contrato sem documento" },
          { sourceIndex: 1, pageNumber: 1, text: `Holerite ${VALID}` },
          { sourceIndex: 2, pageNumber: 1, text: "Ficha sem documento" },
        ],
        true,
      ),
    ).toEqual([
      {
        cpf: VALID_DIGITS,
        pages: [
          { sourceIndex: 0, pageNumber: 1 },
          { sourceIndex: 1, pageNumber: 1 },
          { sourceIndex: 2, pageNumber: 1 },
        ],
      },
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

describe("rematchAssignment", () => {
  const sellers = [
    { id: "ana", cpf: "39053344705" },
    { id: "bia", cpf: "15350946056" },
  ];

  it("links the only employee of the new branch with that CPF", () => {
    expect(rematchAssignment("390.533.447-05", sellers, [], "store-b")).toEqual({
      sellerId: "ana",
      identityId: null,
      storeId: "store-b",
    });
  });

  it("keeps the document on the new branch when nobody matches", () => {
    expect(rematchAssignment("11144477735", sellers, [], "store-b")).toEqual({
      sellerId: null,
      identityId: null,
      storeId: "store-b",
    });
  });

  it("does not pick a person when two employees share the CPF", () => {
    expect(
      rematchAssignment("39053344705", [sellers[0], { id: "ana-2", cpf: "39053344705" }], [], "store-b"),
    ).toEqual({ sellerId: null, identityId: null, storeId: "store-b" });
  });
});

describe("fileName", () => {
  it("names the first file with the category and the next with a suffix", () => {
    expect(fileName("Holerite", [])).toBe("Holerite.pdf");
    expect(fileName("Holerite", ["Holerite.pdf"])).toBe("Holerite (2).pdf");
    expect(fileName("Holerite", ["Holerite.pdf", "Holerite (2).pdf"])).toBe("Holerite (3).pdf");
    expect(displayTitle("Holerite (12).pdf")).toBe("Holerite");
    expect(displayTitle("Holerite.pdf")).toBe("Holerite");
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

describe("signatureDeadlineAt", () => {
  it("ends thirty days after the send date", () => {
    expect(signatureDeadlineAt(new Date("2026-10-15T17:12:48.000Z"))).toBe("2026-11-14T23:59:59.000Z");
    expect(signatureDeadlineAt(new Date("2026-12-15T03:00:00.000Z"))).toBe("2027-01-14T23:59:59.000Z");
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
    expect(sourceRefusal({ ...ok, mime: "image/png" })).toBe("Envie apenas arquivos PDF.");
    expect(sourceRefusal({ ...ok, alreadyAccepted: 5 })).toBe("Você pode anexar até 5 PDFs por vez.");
    expect(sourceRefusal({ ...ok, bytes: 15 * 1024 * 1024 + 1 })).toBe("Cada PDF pode ter até 15 MB e 1.000 páginas.");
    expect(sourceRefusal({ ...ok, pages: 1001 })).toBe("Cada PDF pode ter até 15 MB e 1.000 páginas.");
    expect(sourceRefusal({ ...ok, hasText: false })).toBe(DOCUMENT_COPY.scanned);
    expect(sourceRefusal(ok)).toBeNull();
  });
});

describe("archiveRefusal", () => {
  const ok = { mime: "application/pdf", bytes: 1000, pages: 2, alreadyAccepted: 0 };

  it("keeps a scanned PDF and refuses a file that is not a PDF", () => {
    expect(archiveRefusal(ok)).toBeNull();
    expect(archiveRefusal({ ...ok, pages: 1 })).toBeNull();
    expect(archiveRefusal({ ...ok, mime: "image/png" })).toBe("Envie apenas arquivos PDF.");
    expect(archiveRefusal({ ...ok, pages: 0 })).toBe("Envie apenas arquivos PDF.");
    expect(archiveRefusal({ ...ok, alreadyAccepted: 5 })).toBe("Você pode anexar até 5 PDFs por vez.");
    expect(archiveRefusal({ ...ok, bytes: 15 * 1024 * 1024 + 1 })).toBe("Cada PDF pode ter até 15 MB e 1.000 páginas.");
  });
});

describe("library membership", () => {
  it("shows a sent document and a filed document, and hides an unsent draft", () => {
    expect(inLibrary({ envelopeId: "env", status: "PENDING" })).toBe(true);
    expect(inLibrary({ envelopeId: null, status: "ARCHIVED" })).toBe(true);
    expect(inLibrary({ envelopeId: null, status: "EXTERNAL_SIGNED" })).toBe(true);
    expect(inLibrary({ envelopeId: null, status: "UNASSIGNED" })).toBe(false);
    expect(isFiledStatus("ARCHIVED")).toBe(true);
    expect(isFiledStatus("EXTERNAL_SIGNED")).toBe(true);
    expect(isFiledStatus("SIGNED")).toBe(false);
    expect(applyEnvelopeStatus("ARCHIVED", "COMPLETED")).toBe("ARCHIVED");
    expect(applyEnvelopeStatus("EXTERNAL_SIGNED", "DECLINED")).toBe("EXTERNAL_SIGNED");
  });
});

describe("confirm and resend", () => {
  it("blocks confirm without a token, a contact, or a PDF over 5 MB", () => {
    expect(confirmBlock({ deadline: "2026-11-13", hasToken: false, sizeBytes: 10 })).toBe(DOCUMENT_COPY.noToken);
    expect(confirmBlock({ deadline: null, hasToken: true, sizeBytes: 10 })).toBeNull();
    expect(confirmBlock({ deadline: "2026-11-13", hasToken: true, sizeBytes: 5 * 1024 * 1024 + 1 })).toBe(DOCUMENT_COPY.overEnvelope);
    expect(channelBlock("WHATSAPP", { email: "a@b.com", whatsapp: null })).toBe("Informe o WhatsApp para enviar este documento.");
    expect(channelBlock("EMAIL", { email: null, whatsapp: "11987654321" })).toBe("Informe o e-mail para enviar este documento.");
    expect(confirmBlock({ deadline: "2026-11-13", hasToken: true, sizeBytes: 10 })).toBeNull();
  });

  it("does not create a second envelope and does not resend a signed row", () => {
    expect(shouldSend({ envelopeId: "env", sellerId: "ana", block: null })).toBe(false);
    expect(shouldSend({ envelopeId: null, sellerId: null, block: null })).toBe(false);
    expect(shouldSend({ envelopeId: null, sellerId: "ana", block: "Informe o e-mail para enviar este documento." })).toBe(false);
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

const PROFILE = { cpf: VALID_DIGITS, email: "ana@loja.com", whatsapp: "11987654321" };

describe("contact fields", () => {
  it("asks for nothing when the profile already has the CPF and the channel contact", () => {
    expect(contactFieldsToAsk(PROFILE, "EMAIL")).toEqual({ cpf: false, email: false, whatsapp: false });
    expect(contactFieldsToAsk(PROFILE, "WHATSAPP")).toEqual({ cpf: false, email: false, whatsapp: false });
    expect(contactFieldsToAsk({ cpf: "  ", email: "", whatsapp: null }, "EMAIL")).toEqual({
      cpf: true,
      email: true,
      whatsapp: false,
    });
  });

  it("shows only the contact of the chosen channel, and the CPF only when it is missing", () => {
    expect(contactFieldsToAsk({ cpf: null, email: "ana@loja.com", whatsapp: null }, "WHATSAPP")).toEqual({
      cpf: true,
      email: false,
      whatsapp: true,
    });
    expect(contactFieldsToAsk({ cpf: VALID_DIGITS, email: null, whatsapp: "11987654321" }, "EMAIL")).toEqual({
      cpf: false,
      email: true,
      whatsapp: false,
    });
  });

  it("patches only the keys that were shown", () => {
    expect(contactPatch({ whatsapp: "(11) 98765-4321" })).toEqual({ ok: true, patch: { whatsapp: "11987654321" } });
    expect(contactPatch({})).toEqual({ ok: true, patch: {} });
    expect(contactPatch({ cpf: "123.456.789-00" })).toEqual({ ok: false, message: DOCUMENT_COPY.badCpf });
  });
});

describe("replicate and marks", () => {
  it("copies the channel and the marks and leaves the person's contact behind", () => {
    const source = {
      channel: "WHATSAPP" as const,
      marks: [{ pageNumber: 2, x: 10, y: 80, element: "SIGNATURE" as const }],
      cpf: VALID_DIGITS,
      email: "ana@loja.com",
      whatsapp: "11987654321",
    };
    const copy = replicateSetup(source);
    expect(copy).toEqual({ channel: "WHATSAPP", marks: source.marks });
    expect(copy).not.toHaveProperty("cpf");
    expect(copy).not.toHaveProperty("email");
    expect(copy).not.toHaveProperty("whatsapp");
    copy.marks[0].x = 1;
    expect(source.marks[0].x).toBe(10);
  });

  it("starts the signature at the center of the last page and drops a mark on a missing page", () => {
    expect(defaultSignatureMark(4)).toEqual({ pageNumber: 4, x: 50, y: 50, element: "SIGNATURE" });
    expect(defaultSignatureMark(0)).toEqual({ pageNumber: 1, x: 50, y: 50, element: "SIGNATURE" });
    const marks = [{ pageNumber: 4, x: 50, y: 50, element: "SIGNATURE" as const }];
    expect(placementWarning(marks, 2)).toBe(DOCUMENT_COPY.missingPage);
    expect(placementWarning(marks, 4)).toBeNull();
  });

  it("drops one page and removes the document when that page was the last one", () => {
    expect(remainingPages(10, 3)).toBe(9);
    expect(remainingPages(1, 1)).toBeNull();
    expect(remainingPages(10, 11)).toBe(10);
    const mark = { pageNumber: 8, x: 20, y: 30, element: "SIGNATURE" as const };
    expect(markAfterDrop(mark, 2, 9)).toEqual({ pageNumber: 7, x: 20, y: 30, element: "SIGNATURE" });
    expect(markAfterDrop(mark, 8, 9)).toBeNull();
  });
});

describe("envelope recipients", () => {
  const seller = { name: "Ana Lima", cpf: VALID_DIGITS, email: "ana@loja.com", whatsapp: "11987654321" };
  const mark = { pageNumber: 2, x: 40, y: 70, element: "SIGNATURE" as const };

  it("puts the collaborator first and the extra signer second, both as SIGN", () => {
    const signatures = envelopeSignatures({
      seller,
      channel: "EMAIL",
      marks: [mark, { pageNumber: 9, x: 1, y: 1, element: "SIGNATURE" }],
      pageCount: 2,
      extra: { name: "  Bruno  ", channel: "WHATSAPP", email: "bruno@loja.com", whatsapp: "21988887777", marks: [mark] },
    });
    expect(signatures).toEqual([
      {
        recipient: {
          name: "Ana Lima",
          email: "ana@loja.com",
          phone: "",
          cpf: VALID,
          routingOrder: 1,
          action: "SIGN",
          senderType: "EMAIL",
          authenticationType: "DEFAULT_SIGN",
          signaturePositions: [mark],
        },
      },
      {
        recipient: {
          name: "Bruno",
          email: "",
          phone: "21988887777",
          cpf: "",
          routingOrder: 2,
          action: "SIGN",
          senderType: "WHATSAPP",
          authenticationType: "DEFAULT_SIGN",
          signaturePositions: [mark],
        },
      },
    ]);
    const mixed = envelopeSignatures({
      seller,
      channel: "EMAIL",
      authentication: "DEFAULT_SIGN",
      marks: [mark],
      pageCount: 2,
      extra: { name: "Bruno", channel: "WHATSAPP", email: null, whatsapp: "21988887777", marks: [mark], authentication: "SMS" },
    });
    expect(mixed[0].recipient.senderType).toBe("EMAIL");
    expect(mixed[0].recipient.authenticationType).toBe("DEFAULT_SIGN");
    expect(mixed[1].recipient.senderType).toBe("WHATSAPP");
    expect(mixed[1].recipient.authenticationType).toBe("SMS");
    expect(mixed[1].recipient.phone).toBe("21988887777");
  });

  it("omits a blank extra signer and keeps the collaborator id when the extra signer is listed first", () => {
    expect(envelopeSignatures({ seller, channel: "WHATSAPP", marks: [mark], pageCount: 2, extra: null })).toHaveLength(1);
    expect(
      envelopeSignatures({
        seller,
        channel: "WHATSAPP",
        marks: [mark],
        pageCount: 2,
        extra: { name: "   ", channel: "EMAIL", email: "bruno@loja.com", whatsapp: null, marks: [mark] },
      }),
    ).toHaveLength(1);
    expect(
      collaboratorRecipientId([
        { routingOrder: 2, recipient: { id: "extra" } },
        { routingOrder: 1, recipient: { id: "ana" } },
      ]),
    ).toBe("ana");
    expect(collaboratorRecipientId([{ id: "only" }])).toBe("only");
    expect(collaboratorRecipientId([])).toBeNull();
  });
});

describe("signer progress", () => {
  it("keeps each signer and attaches the recipient even when the extra is listed first", () => {
    const signers = initialSigners({
      ownerName: "Maria Eduarda",
      ownerChannel: "WHATSAPP",
      extras: [{ name: "Petania", channel: "EMAIL" }],
      signatures: [
        { routingOrder: 2, recipient: { id: "petania", name: "Petania" } },
        { routingOrder: 1, status: "PENDING", recipient: { id: "maria", name: "Maria Eduarda" } },
      ],
    });
    expect(signers).toEqual([
      { name: "Maria Eduarda", order: 1, recipientId: "maria", channel: "WHATSAPP", status: "PENDING" },
      { name: "Petania", order: 2, recipientId: "petania", channel: "EMAIL", status: "PENDING" },
    ]);
    expect(signerCaption(signers)).toBe("Maria Eduarda pendente · Petania pendente");
  });

  it("marks only the signer the envelope says has signed", () => {
    const current = initialSigners({
      ownerName: "Maria Eduarda",
      ownerChannel: "WHATSAPP",
      extras: [{ name: "Petania", channel: "EMAIL" }],
      signatures: [
        { routingOrder: 1, recipient: { id: "maria" } },
        { routingOrder: 2, recipient: { id: "petania" } },
      ],
    });
    const next = mergeSignerProgress(current, "PARTIALLY_SIGNED", [
      { routingOrder: 2, status: "PENDING", recipient: { id: "petania" } },
      { routingOrder: 1, status: "SIGNED", recipient: { id: "maria" } },
    ]);
    expect(next.map((item) => item.status)).toEqual(["SIGNED", "PENDING"]);
    expect(signerCaption(next)).toBe("Maria Eduarda assinou · Petania pendente");
    expect(nextSignerStatus("SIGNED", "", "PARTIALLY_SIGNED")).toBe("SIGNED");
  });

  it("closes every signer when the envelope is completed and keeps a stored name", () => {
    const next = progressForEnvelope({
      stored: [{ name: "Maria Eduarda", order: 1, recipientId: "maria", channel: "WHATSAPP", status: "PENDING" }],
      envelopeStatus: "COMPLETED",
      signatures: [{ routingOrder: 1, recipient: { id: "maria", name: "Outro nome" } }],
      ownerChannel: "WHATSAPP",
      extras: [],
    });
    expect(next).toEqual([{ name: "Maria Eduarda", order: 1, recipientId: "maria", channel: "WHATSAPP", status: "SIGNED" }]);
  });

  it("shows the person and the extra as pending when the envelope progress is still empty", () => {
    const signers = visibleSigners({
      signers: [],
      personName: "Petania Chimenes Valim",
      extras: { name: "Maria Eduarda Bessa", channel: "WHATSAPP" },
    });
    expect(signerCaption(signers)).toBe("Petania Chimenes Valim pendente · Maria Eduarda Bessa pendente");
  });

  it("keeps a stored signature when the extra is already listed", () => {
    const signers = visibleSigners({
      signers: [
        { name: "Petania Chimenes Valim", order: 1, recipientId: "petania", channel: "WHATSAPP", status: "SIGNED" },
        { name: "Maria Eduarda Bessa", order: 2, recipientId: "maria", channel: "WHATSAPP", status: "PENDING" },
      ],
      personName: "Petania Chimenes Valim",
      extras: { name: "Maria Eduarda Bessa", channel: "WHATSAPP" },
    });
    expect(signerCaption(signers)).toBe("Petania Chimenes Valim assinou · Maria Eduarda Bessa pendente");
    expect(signers[1]?.recipientId).toBe("maria");
    expect(partialEnvelopeLabel("PENDING", signers)).toBe("Em andamento");
    expect(partialEnvelopeLabel("PENDING", signers.map((item) => ({ ...item, status: "PENDING" })))).toBeNull();
    expect(partialEnvelopeLabel("SIGNED", signers)).toBeNull();
  });
});

describe("carryDraft", () => {
  const previous = {
    channel: "EMAIL" as const,
    fields: [
      { id: "seller-mark", pageNumber: 4, x: 12, y: 30, element: "SIGNATURE" as const, signerId: "seller" },
      { id: "user-mark", pageNumber: 4, x: 12, y: 70, element: "RUBRIC" as const, signerId: "user:bruno" },
    ],
    deadline: "2026-11-01",
    reminder: "EVERY_WEEK" as const,
    guests: [],
  };

  it("carries deadline, reminder, user marks and position onto the pages the next document has", () => {
    const next = carryDraft(previous, 2);
    expect(next.channel).toBe("WHATSAPP");
    expect(next.deadline).toBe("2026-11-01");
    expect(next.reminder).toBe("EVERY_WEEK");
    expect(next.fields[0]).toEqual({ id: "seller-mark", pageNumber: 2, x: 12, y: 30, element: "SIGNATURE", signerId: "seller" });
    expect(next.fields[1]).toMatchObject({ pageNumber: 2, element: "RUBRIC", signerId: "user:bruno" });
    expect(next.fields).not.toBe(previous.fields);
  });

  it("keeps a document already set and carries that version to the one after it", () => {
    const saved = { ...defaultDraft(1), deadline: "2026-12-01", channel: "EMAIL" as const };
    const resolved = resolveDrafts(
      [
        { id: "a", pageCount: 1 },
        { id: "b", pageCount: 1 },
        { id: "c", pageCount: 1 },
      ],
      { a: previous, b: saved },
    );
    expect(resolved[0].deadline).toBe("2026-11-01");
    expect(resolved[0].fields).toHaveLength(2);
    expect(resolved[1]).toMatchObject({ deadline: "2026-12-01", channel: "EMAIL" });
    expect(resolved[1].fields).toEqual([]);
    expect(resolved[2].deadline).toBe("2026-12-01");
    expect(resolved[2].channel).toBe("WHATSAPP");
    expect(resolved[2].fields).toEqual([]);
  });

  it("starts without a mark and keeps an empty document empty", () => {
    expect(defaultDraft(4).fields).toEqual([]);
    expect(resolveDrafts([{ id: "a", pageCount: 4 }], {})[0].fields).toEqual([]);
    expect(carryDraft({ ...previous, fields: [] }, 3).fields).toEqual([]);
  });

  it("rotates the next mark through the signers already placed", () => {
    const seller = { signerId: "seller" };
    const extra = { signerId: "guest:g1" };
    const third = { signerId: "guest:g2" };
    expect(nextMarkSigner([], "ana")).toBe("seller");
    expect(nextMarkSigner([seller], "ana")).toBe("seller");
    expect(nextMarkSigner([seller, extra], "ana")).toBe("seller");
    expect(nextMarkSigner([seller, extra, seller], "ana")).toBe("guest:g1");
    expect(nextMarkSigner([seller, extra, third], "ana")).toBe("seller");
    expect(nextMarkSigner([seller, extra, third, seller], "ana")).toBe("guest:g1");
  });

  it("turns the first person on the marks into the document collaborator", () => {
    const base = defaultDraft(1);
    const maria = { id: "m", pageNumber: 1, x: 10, y: 10, element: "SIGNATURE" as const, signerId: "seller:maria" };
    const petania = { id: "p", pageNumber: 1, x: 20, y: 20, element: "SIGNATURE" as const, signerId: "seller:petania" };
    const open = settleDocumentSigners({ ...base, fields: [maria, petania] }, null);
    expect(open.assignId).toBe("maria");
    expect(open.ownerId).toBe("maria");
    expect(open.draft.fields.map((field) => field.signerId)).toEqual(["seller", "seller:petania"]);
    const kept = settleDocumentSigners(open.draft, "maria");
    expect(kept.assignId).toBeNull();
    expect(kept.draft.fields.map((field) => field.signerId)).toEqual(["seller", "seller:petania"]);
    const prefixed = settleDocumentSigners({ ...base, fields: [{ ...maria, signerId: "seller:ana" }, petania] }, "ana");
    expect(prefixed.assignId).toBeNull();
    expect(prefixed.ownerId).toBe("ana");
    expect(prefixed.draft.fields.map((field) => field.signerId)).toEqual(["seller", "seller:petania"]);
  });

  it("asks for a collaborator, a missing contact, or a user with e-mail before send", () => {
    const draft = {
      ...defaultDraft(1),
      fields: [{ id: "seller-mark", pageNumber: 1, x: 50, y: 50, element: "SIGNATURE" as const, signerId: "seller" }],
    };
    expect(documentIssue(null, draft, 1)).toBe("Escolha a pessoa.");
    expect(documentIssue({ cpf: VALID_DIGITS, email: null, whatsapp: null }, draft, 1)).toBe("Falta contato no cadastro.");
    expect(
      documentIssue(
        { cpf: VALID_DIGITS, email: "ana@loja.com", whatsapp: "11987654321" },
        { ...draft, fields: [...draft.fields, { id: "extra", pageNumber: 1, x: 20, y: 20, element: "SIGNATURE", signerId: "user:missing" }] },
        1,
        [],
      ),
    ).toBe("O signatário adicional precisa ser um usuário com e-mail.");
    const guest = {
      ...draft,
      guests: [{ id: "g1", name: "", email: "", whatsapp: "" }],
      fields: [...draft.fields, { id: "guest-mark", pageNumber: 1, x: 20, y: 80, element: "SIGNATURE" as const, signerId: "guest:g1" }],
    };
    expect(documentIssue({ cpf: VALID_DIGITS, email: "ana@loja.com", whatsapp: "11987654321" }, guest, 1)).toBe("Informe o nome de quem vai assinar.");
    const blank = { ...draft, fields: [{ ...draft.fields[0], signerId: "" }] };
    expect(documentIssue({ cpf: VALID_DIGITS, email: "ana@loja.com", whatsapp: "11987654321" }, blank, 1)).toBe("Escolha quem assina esta marcação.");
    expect(preparationSituation({ cpf: VALID_DIGITS, email: "ana@loja.com", whatsapp: "11987654321" }, blank, 1)).toBe("Precisa de atenção");
    expect(preparationReason({ cpf: VALID_DIGITS, email: "ana@loja.com", whatsapp: "11987654321" }, blank, 1)).toBe("Falta marcação");
    expect(documentIssue({ cpf: VALID_DIGITS, email: "ana@loja.com", whatsapp: "11987654321" }, draft, 1, [], [], 5 * 1024 * 1024 + 1)).toBe("O PDF passa de 5 MB depois da separação. Separe o arquivo e tente novamente.");
    expect(preparationSituation(null, draft, 1)).toBe("Precisa de atenção");
    expect(preparationReason(null, draft, 1)).toBe("Sem pessoa");
    expect(preparationReason({ cpf: VALID_DIGITS, email: "ana@loja.com", whatsapp: "11987654321" }, draft, 1, [], [], null, 0, false)).toBe("Revisar marcação");
    expect(preparationSituation({ cpf: VALID_DIGITS, email: "ana@loja.com", whatsapp: "11987654321" }, draft, 1)).toBe("Pronto");
    expect(preparationSituation({ cpf: VALID_DIGITS, email: "ana@loja.com", whatsapp: "11987654321" }, draft, 1, [], [], "env")).toBe("Já enviado");
  });
});

describe("signerHistory", () => {
  it("keeps the latest external contacts and skips a repeated phone", () => {
    const history = signerHistory([
      { sentAt: "2026-10-01T00:00:00.000Z", extra: { name: "Bruno", email: "bruno@loja.com", whatsapp: "11999990000" } },
      { sentAt: "2026-10-02T00:00:00.000Z", extra: [{ name: "Bruno Lima", email: "", whatsapp: "(11) 99999-0000" }, { name: "Carla", email: "carla@loja.com", whatsapp: "" }] },
    ]);
    expect(history.map((item) => item.name)).toEqual(["Bruno Lima", "Carla"]);
  });
});

describe("documentPeople", () => {
  const team = [
    person("seller-maria", "centro", "Maria Silva", "Vendedor", VALID_DIGITS, "maria@loja.com"),
    person("seller-ana", "centro", "Ana Paula Souza", "Gerente", "39053344705", "ana@loja.com"),
  ];

  it("adds a gestor linked to the branch and keeps the same person in each branch", () => {
    const people = documentPeople(
      team,
      [user("mem-romeu", "id-romeu", "Romeu Fernandes", "OWNER", [], "romeu@wedash.app")],
      ["centro", "norte"],
    );
    expect(people.filter((item) => item.storeId === "centro").map((item) => item.name)).toEqual([
      "Ana Paula Souza",
      "Maria Silva",
      "Romeu Fernandes",
    ]);
    expect(people.filter((item) => item.name === "Romeu Fernandes").map((item) => item.storeId)).toEqual(["centro", "norte"]);
    expect(people.find((item) => item.name === "Romeu Fernandes")?.roleLabel).toBe("Gestor");
  });

  it("shows a gerente only in the branches linked on Usuários", () => {
    const people = documentPeople(
      team,
      [user("mem-ana-user", "id-carla", "Carla Lima", "MANAGER", ["norte"], "carla@wedash.app")],
      ["centro", "norte"],
    );
    expect(people.filter((item) => item.name === "Carla Lima").map((item) => item.storeId)).toEqual(["norte"]);
    expect(people.find((item) => item.name === "Carla Lima")?.roleLabel).toBe("Gerente");
  });

  it("keeps one person when the same CPF or e-mail exists in both sources", () => {
    const duplicated = documentPeople(
      team,
      [user("mem-ana", "id-ana", "Ana Paula Souza", "MANAGER", ["centro", "norte"], "ana@loja.com", "39053344705")],
      ["centro", "norte"],
    );
    expect(duplicated.filter((item) => item.storeId === "centro" && item.name === "Ana Paula Souza")).toEqual([
      expect.objectContaining({ id: "seller-ana", source: "team" }),
    ]);
    expect(duplicated.find((item) => item.storeId === "norte" && item.name === "Ana Paula Souza")?.source).toBe("user");
    const byEmail = documentPeople(
      team,
      [user("mem-ana", "id-ana", "Ana Paula Souza", "MANAGER", ["centro"], "ANA@loja.com", null)],
      ["centro"],
    );
    expect(byEmail.filter((item) => item.storeId === "centro")).toHaveLength(2);
  });

  it("does not merge two people who only share a name", () => {
    const people = documentPeople(
      team,
      [user("mem-other", "id-other", "Ana Paula Souza", "MANAGER", ["centro"], "outra@wedash.app", "11144477735")],
      ["centro"],
    );
    expect(people.filter((item) => item.name === "Ana Paula Souza")).toHaveLength(2);
  });

  it("treats a suspended user as inactive and skips a pending invite", () => {
    const people = documentPeople(
      [],
      [
        { ...user("mem-off", "id-off", "Paula", "MANAGER", ["centro"], "paula@wedash.app"), status: "SUSPENDED" },
        { ...user("mem-wait", "id-wait", "", "MANAGER", ["centro"], "convite@wedash.app"), status: "ACTIVE" },
      ],
      ["centro"],
    );
    expect(people).toEqual([expect.objectContaining({ name: "Paula", active: false, source: "user" })]);
  });
});

describe("markSignerId", () => {
  it("keeps another person on the card that changed", () => {
    expect(markSignerId("seller", "ana")).toBe("seller");
    expect(markSignerId("ana", "ana")).toBe("seller");
    expect(markSignerId("gestor", "ana")).toBe("seller:gestor");
    expect(markChoiceValue("seller", "ana")).toBe("seller");
    expect(markChoiceValue("seller:gestor", "ana")).toBe("gestor");
    expect(markChoiceValue("seller", null)).toBe("");
    expect(markChoiceValue("guest:1", "ana")).toBe("guest:1");
  });
});

describe("signingPeople", () => {
  it("keeps active sellers and shows a manager once even when she belongs to two branches", () => {
    const centro = person("seller-maria", "centro", "Maria Silva", "Vendedor", VALID_DIGITS, "maria@loja.com");
    const cashier = { ...person("seller-joao", "centro", "João Santos", "Operador de caixa", null, null), active: true };
    const inactive = { ...person("seller-off", "centro", "Pedro", "Vendedor", null, null), active: false };
    const managerCentro = person("seller-ana", "centro", "Ana Paula", "Gerente", "39053344705", "ana@loja.com");
    const managerNorte = { ...managerCentro, id: "seller-ana-norte", storeId: "norte" };
    const gestorCentro = {
      ...person("user:id-romeu:centro", "centro", "Romeu Fernandes", "Gestor", null, "romeu@wedash.app"),
      source: "user" as const,
      identityId: "id-romeu",
    };
    const gestorNorte = { ...gestorCentro, id: "user:id-romeu:norte", storeId: "norte" };
    const branchUser = person("seller-filial", "centro", "Camila Rocha", "Usuário da filial", null, null);
    const list = signingPeople([centro, cashier, inactive, managerCentro, managerNorte, gestorCentro, gestorNorte, branchUser], null);
    expect(list.map((item) => `${item.name} · ${item.roleLabel}`)).toEqual(["Ana Paula · Gerente", "Maria Silva · Vendedor", "Romeu Fernandes · Gestor"]);
  });

  it("limits the list to the document branch", () => {
    const centro = person("seller-maria", "centro", "Maria Silva", "Vendedor", VALID_DIGITS, "maria@loja.com");
    const norte = person("seller-carla", "norte", "Carla Lima", "Vendedor", null, "carla@loja.com");
    const manager = person("seller-ana", "norte", "Ana Paula", "Gerente", "39053344705", "ana@loja.com");
    expect(signingPeople([centro, norte, manager], "centro").map((item) => item.name)).toEqual(["Maria Silva"]);
  });

  it("adds the branch user to the folder list and still leaves the cashier out", () => {
    const centro = person("seller-maria", "centro", "Maria Silva", "Vendedor", VALID_DIGITS, "maria@loja.com");
    const inactive = { ...person("seller-off", "centro", "Pedro", "Vendedor", null, null), active: false };
    const cashier = person("seller-joao", "centro", "João Santos", "Operador de caixa", null, null);
    const branchUser = person("seller-filial", "centro", "Camila Rocha", "Usuário da filial", null, null);
    const list = archivePeople([centro, inactive, cashier, branchUser], "centro");
    expect(list.map((item) => item.name)).toEqual(["Camila Rocha", "Maria Silva", "Pedro"]);
    expect(signingPeople([centro, inactive, cashier, branchUser], "centro").map((item) => item.name)).toEqual(["Maria Silva"]);
  });
});

describe("document person key", () => {
  it("keeps a millennium document on the seller and a user document on the branch", () => {
    expect(documentPersonKey({ sellerId: "seller-ana", identityId: null, storeId: "centro" })).toBe("seller-ana");
    expect(documentPersonKey({ sellerId: null, identityId: "id-romeu", storeId: "norte" })).toBe("user:id-romeu:norte");
    expect(parsePersonRef("user:id-romeu:norte")).toEqual({ sellerId: "", identityId: "id-romeu", storeId: "norte" });
    expect(parsePersonRef("seller-ana")).toEqual({ sellerId: "seller-ana", identityId: "", storeId: "" });
    expect(findDocumentPerson([{ id: "user:id-romeu:norte" }], { sellerId: null, identityId: "id-romeu", storeId: "norte" })?.id).toBe(
      "user:id-romeu:norte",
    );
  });

  it("matches name, cpf and e-mail", () => {
    const person = { name: "Ana Paula", cpf: VALID_DIGITS, email: "ana@loja.com" };
    expect(personMatchesQuery(person, "paula")).toBe(true);
    expect(personMatchesQuery(person, "529.982")).toBe(true);
    expect(personMatchesQuery(person, "ana@loja")).toBe(true);
    expect(personMatchesQuery(person, "xyz")).toBe(false);
  });
});

function person(id: string, storeId: string, name: string, roleLabel: string, cpf: string | null, email: string | null) {
  return {
    id,
    storeId,
    name,
    cpf,
    email,
    whatsapp: null,
    active: true,
    inErp: true,
    source: "team" as const,
    roleLabel,
    identityId: null,
    membershipId: null,
  };
}

function user(
  membershipId: string,
  identityId: string,
  name: string,
  role: "OWNER" | "MANAGER",
  storeIds: string[],
  email: string,
  cpf: string | null = null,
) {
  return {
    membershipId,
    identityId,
    name,
    email,
    cpf,
    whatsapp: null,
    role,
    status: "ACTIVE" as const,
    storeIds,
  };
}
