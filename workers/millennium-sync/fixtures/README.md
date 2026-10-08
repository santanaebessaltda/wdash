# Fixtures

`sales-list.sample.json` — anonymized `VENDAS.Lista` payload for aggregator and client unit tests.

- Keep `COD_OPERACAO`, `DATA_H`, `VALOR_FINAL`, `QUANTIDADE`, `FILIAL`.
- Do not commit real customer/seller identifiers.
- `DATA` is present only to document the TZ trap; aggregators must use `DATA_H`.
