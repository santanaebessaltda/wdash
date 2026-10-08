import { describe, expect, it } from "vitest";
import { parseStoneConciliation, stonePaymentMethod } from "./stoneConciliation";

const xml = `<?xml version="1.0"?><Conciliation><Header><ReferenceDate>20261007</ReferenceDate></Header><FinancialTransactions>
<Transaction><Events><Captures>1</Captures></Events><AcquirerTransactionKey>C1</AcquirerTransactionKey><AuthorizationDateTime>20261007122028</AuthorizationDateTime><AccountType>2</AccountType><NumberOfInstallments>1</NumberOfInstallments><CapturedAmount>219.08</CapturedAmount><IssuerAuthorizationCode>333732</IssuerAuthorizationCode><BrandId>2</BrandId></Transaction>
<Transaction><Events><Captures>1</Captures></Events><AcquirerTransactionKey>D1</AcquirerTransactionKey><AuthorizationDateTime>20261007153000</AuthorizationDateTime><AccountType>1</AccountType><CapturedAmount>10.00</CapturedAmount><BrandId>1</BrandId></Transaction>
<Transaction><Events><Captures>1</Captures></Events><AcquirerTransactionKey>D3</AcquirerTransactionKey><AuthorizationDateTime>20261007153100</AuthorizationDateTime><AccountType>3</AccountType><CapturedAmount>6.50</CapturedAmount></Transaction>
<Transaction><Events><Captures>0</Captures><Payments>1</Payments></Events><AcquirerTransactionKey>OLD</AcquirerTransactionKey><AuthorizationDateTime>20261006115702</AuthorizationDateTime><EntryMode>1</EntryMode></Transaction>
</FinancialTransactions></Conciliation>`;

describe("parseStoneConciliation", () => {
  it("guarda a captura do dia e deixa de fora a liquidação de venda anterior", () => {
    const { referenceDay, captures } = parseStoneConciliation(xml);
    expect(referenceDay).toBe("2026-10-07");
    expect(captures.map((c) => c.acquirerKey)).toEqual(["C1", "D1", "D3"]);
    expect(captures[0]).toMatchObject({
      occurredAt: "2026-10-07T12:20:28.000Z",
      accountType: 2,
      paymentMethod: "Cartão de crédito",
      brandId: 2,
      capturedCents: 21908,
      authorizationCode: "333732",
      installments: 1,
    });
    expect(captures[1]?.paymentMethod).toBe("Cartão de débito");
    expect(captures[2]).toMatchObject({ paymentMethod: "Cartão de débito", capturedCents: 650, brandId: null });
  });

  it("conta 2 é crédito e contas 1 e 3 são débito", () => {
    expect(stonePaymentMethod(2)).toBe("Cartão de crédito");
    expect(stonePaymentMethod(1)).toBe("Cartão de débito");
    expect(stonePaymentMethod(3)).toBe("Cartão de débito");
    expect(stonePaymentMethod(4)).toBe("Outros");
  });
});
