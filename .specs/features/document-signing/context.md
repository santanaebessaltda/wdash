# Assinatura de documentos — Context

**Gathered:** 2026-10-14
**Spec:** `.specs/features/document-signing/spec.md`
**Status:** Ready for design

---

## Feature Boundary

O gestor envia PDFs digitais para assinatura, organizados por colaborador. Um PDF com vários CPFs é cortado no WDash. O Assina AI dispara o WhatsApp ou o e-mail e devolve o status. A tela guarda o arquivo na pasta da pessoa e mostra o lote para cobrar quem ainda não assinou.

---

## Implementation Decisions

### Corte do PDF

- O WDash corta PDF digital (texto selecionável). O Assina AI não faz esse corte: a API pública só cria um envelope por arquivo (`POST /api/v1/envelopes/create`, PDF até 5 MB).
- PDF escaneado (só imagem) fica de fora. A API não tem OCR.
- Um lote aceita vários PDFs. Todos compartilham mês, ano e categoria.
- Páginas do mesmo CPF, no mesmo lote, viram um PDF só. Um campo de assinatura no centro de cada página. Um link só.
- Dá para desligar essa unificação no lote. Aí cada documento segue em envelope separado.
- Página sem CPF, ou com CPF que não está no cadastro, para na revisão. Alguém escolhe o colaborador. Nada dispara sem destinatário.
- PDF unificado acima de 5 MB para na revisão. A pessoa desliga a unificação ou separa o arquivo.

### Cadastro

- O colaborador é o funcionário do Millennium já gravado em `store_seller`. A lista é a da loja, não só quem vende.
- CPF entra nesse cadastro. E-mail e WhatsApp já existem na tabela e são preenchidos no WDash.
- O canal do lote era WhatsApp ou e-mail para todo mundo. Em 2026-10-15 isso passou a ser por documento. Ver "Destinatários e marcas".

### Pastas

- A árvore vive no WDash. A pasta do Assina AI é rasa e não espelha Colaborador › Ano › Mês. O envelope sai com `folderId` nulo.
- Com uma filial no topo: Colaborador › Ano › Mês.
- Com todas as filiais: Filial › Colaborador › Ano › Mês. A filial é a da ficha do funcionário.
- O arquivo se chama pela categoria.
- Categorias: Holerite, Espelho de ponto, Adiantamento salarial, Vale transporte, Vale alimentação / refeição, Participação nos lucros (PLR), Informe de rendimentos, Outros.
- Dois arquivos da mesma categoria no mesmo mês ganham sufixo `(2)`, `(3)`. Sem pasta extra de categoria.

### Lote, status e cobrança

- Cada documento é Pendente ou Assinado. O lote também.
- O lote só fica Assinado quando todos os documentos dele estão Assinados.
- A lista de lotes é a tela de cobrança. Cada lote usa a barra de progresso da Meta (quantos já assinaram). Ao abrir, uma tabela com a pessoa e o selo Pendente ou Assinado.
- Recusado e Expirado aparecem na linha. O lote continua Pendente enquanto existir linha que não está Assinada.
- Reenviar fica na linha Pendente. A API faz isso em `POST /api/v1/envelopes/resend-signer-link/{envelopeId}/{recipientId}`, com `senderType` `EMAIL` ou `WHATSAPP`.
- A pasta continua para achar o arquivo da pessoa. O arquivo da pasta é a cópia guardada no WDash. O link do Assina AI expira (60 minutos no webhook, 90 no detalhe do envelope).

### Envio

- Revisão antes de confirmar. Prazo e lembrete continuam do lote. O canal deixou de ser do lote em 2026-10-15.
- Lembrete padrão: a cada 3 dias (`EVERY_3_DAYS`).
- Autenticação: assinatura na tela (`DEFAULT_SIGN`).
- Os 4 últimos dígitos do CPF para abrir o arquivo não existem na API publicada. Ficam de fora.
- Status chega por webhook: `DOCUMENT_CREATED`, `DOCUMENT_SIGNED`, `DOCUMENT_COMPLETED`. `eventId` deduplica.
- O colaborador assina no link do Assina AI. Não há tela de assinatura dentro do WDash.

### Agent's Discretion

- Composição visual do lote: `ProgressBar`, `DataTable`, `Badge` e `Card`, no mesmo desenho da Meta.
- `folderId` nulo no Assina AI.
- Sufixo `(2)` quando a categoria repete no mês.
- Arquivo acima de 5 MB segura a linha na revisão.

### Declined / Undiscussed Gray Areas → Assumptions

- Quem usa a tela no v1 é o gestor. O colaborador não entra no WDash para assinar. O link sai pelo Assina AI.
- A conexão é um card Assina AI em Conta › Integrações, com `/assinaai.png`. Um token para a empresa, não por filial.
- Documentos fica no menu do Gestor, fora de Gestão e fora de Configurações, em `/documents`.

---

## Destinatários e marcas

**Gathered:** 2026-10-15. Substitui o canal único do lote e a marca fixa no centro de cada página.

- O wizard fica em três passos: Anexar, Preparar e Revisar. Preparar abre o PDF, vincula o colaborador do documento e posiciona as marcações. Revisar lista o lote e só então envia.
- Cada documento escolhe o próprio canal, ao lado da página. Quem não tem WhatsApp pode ir por e-mail, e o contrário, no mesmo lote. O canal não é copiado para o documento seguinte.
- CPF, e-mail e WhatsApp só são pedidos uma vez. Se a ficha já tem o CPF e o contato do canal escolhido, a tela não mostra campo: o envio usa o cadastro. O campo some depois de gravar, inclusive no próximo lote. O que for preenchido grava em `store_seller` e o sync do Millennium não reescreve. Trocar o canal só pede o contato daquele canal se a ficha ainda não tiver.
- A ação do destinatário é só assinar (`SIGN`). Autenticação continua assinatura na tela (`DEFAULT_SIGN`), sem seletor.
- A página abre no tamanho do PDF, centralizada, sem esticar na coluna. As páginas continuam uma embaixo da outra. O clique na página adiciona uma marcação. A primeira marcação é do colaborador e essa escolha vincula o documento. As outras são pessoas de fora, digitadas na hora ou escolhidas no histórico dos últimos envios. Não puxa usuário do sistema nem um segundo colaborador. Dá para arrastar, duplicar e apagar.
- O signatário extra é opcional e vale para aquele documento. É uma pessoa de fora: nome e contato deste envio, sem virar colaborador. O histórico oferece os últimos contatos que já foram enviados. O documento seguinte herda as marcações. O painel mostra canal, lembrete, prazo e o contato.
- Prazo e lembrete são de cada documento. O documento seguinte abre com o último valor. Data limite vazia não bloqueia o envio.
- A posição da assinatura também passa para o documento seguinte. Se a página marcada não existe nesse PDF, a marca fica na última página que ele tem, no mesmo ponto.
- O primeiro signatário é o colaborador do documento. Escolher essa pessoa na marcação grava o vínculo do arquivo. As outras marcações são adicionais.
- Enviar fica na etapa Revisar. O botão diz quantos documentos vão. Se outros ainda precisam de correção, a tela confirma o que fica de fora. A linha que já tem envelope não é enviada de novo.
- O clique numa área livre do PDF cria a marcação, já como assinatura, sem signatário automático quando o documento ainda não tem colaborador. O card escolhe o signatário e se é assinatura ou rubrica. Não há barra de signatário nem botões de tipo acima do PDF. O aviso fica num alerta da página, acima do PDF, enquanto o documento ainda pode ser preparado. Arrastar pela alça só move depois de um deslocamento real do ponteiro. A cópia nasce dentro da página e selecionada.
- A navegação é um controle só: anterior, "Documento N de T" com a lista, e próximo. Marca herdada só fica pronta depois que aquele PDF é aberto. O painel separa signatários, configurações de envio e a situação. A situação usa ícone de check ou X. Falta de contato aparece nesse ícone, sem a frase "Falta contato no cadastro."
- Excluir a única página pede confirmação, porque o documento sai do lote. A marcação que estava na página excluída deixa de valer.
- Na revisão dá para aplicar lembrete e prazo aos documentos selecionados. Contato e canal não mudam.
- A Home abre listas ao clicar nos indicadores. A busca encontra colaborador e documento. A ação do arquivo é Baixar PDF. Reenviar link só aparece em pendente.
- Cada página do documento pode ser apagada antes do envio, com a lixeira. Apagar a última página tira o documento do lote. Documento que já tem envelope não perde página.

### Agent's Discretion

- Prazo e lembrete ficam no documento, e o seguinte herda o último valor.
- A marca inicial é o centro da última página, não o centro de todas.
- Reenviar continua o link do colaborador, não o do signatário extra.

### Declined / Undiscussed Gray Areas → Assumptions

- Reconhecer, Testemunhar, Revisar, Aprovar, checkbox, data e texto ficam de fora. O dono pediu só assinar e, às vezes, rubrica.
- Sem seletor de país no telefone. O WhatsApp segue 10 ou 11 dígitos, como a ficha já grava.

---

## Specific References

- Tela de pastas no jeito do File Manager do Vela (`src/pages/apps/FileManager.tsx`), com navegação de pasta como no Drive.
- Envio em massa do Assina AI só como referência de fluxo: mês, ano, tipo, unificar o mesmo CPF, revisão, WhatsApp ou e-mail, prazo e lembrete. Os componentes são os do Vela.
- Barra e tabela de pessoas no jeito da Meta (`src/pages/team/goalBlocks.tsx`).
- Documentação publicada em 27/04/2026: [docs.assinaai.com](https://docs.assinaai.com/). Coleção Postman `2sBXc7LjGn`. Não há endpoint de lote, OCR ou split por CPF.

---

## Deferred Ideas

- OCR de PDF escaneado.
- Exigir os 4 últimos dígitos do CPF para abrir o documento.
- Espelhar a árvore de pastas dentro do Assina AI.
- Portal do colaborador dentro do WDash.
