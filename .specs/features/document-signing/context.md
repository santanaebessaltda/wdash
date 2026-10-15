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

- A árvore vive no WDash. A pasta do Assina AI é rasa e não espelha Pessoa › Ano › Mês. O envelope sai com `folderId` nulo.
- Com uma filial no topo: Pessoa › Ano › Mês.
- Com todas as filiais: Filial › Pessoa › Ano › Mês. O documento fica na filial, mesmo quando a pessoa tem acesso a mais de uma.
- A lista de pessoas em Documentos junta a equipe do Millennium com Gestores e Gerentes vinculados em Usuários. A mesma pessoa, pelo CPF ou pelo e-mail, aparece uma vez. Equipe e Usuários continuam cadastros separados. Quem só existe na WDash grava `employee_document.identity_id`; o colaborador do Millennium continua em `seller_id`.
- O arquivo se chama pela categoria.
- Categorias: Holerite, Espelho de ponto, Adiantamento salarial, Vale-transporte, Vale-alimentação / refeição, Participação nos lucros (PLR), Informe de rendimentos, Admissão, Rescisão, Outros. Nomes já gravados continuam como foram salvos.
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
- Cada signatário escolhe o próprio canal. No mesmo documento, um pode receber por WhatsApp e outro por e-mail. O canal do colaborador não é copiado para o documento seguinte. WhatsApp consome 1 crédito por signatário. E-mail não consome.
- CPF, e-mail e WhatsApp do colaborador aparecem no signatário e podem ser corrigidos na preparação. Não há botão de salvar: a gravação em `store_seller` acontece ao enviar o documento. O sync do Millennium não reescreve esses campos.
- A ação do destinatário é só assinar (`SIGN`). Cada signatário escolhe a autenticação. O padrão é assinatura na tela (`DEFAULT_SIGN`). Selfie e documento com selfie não consomem crédito. Código por SMS e certificado ICP-Brasil consomem 1 crédito cada.
- A página abre no tamanho do PDF, centralizada, sem esticar na coluna. As páginas continuam uma embaixo da outra. O clique na página adiciona uma marcação. Se o documento já tem colaborador, a marcação nova fica sem signatário até a pessoa escolher o colaborador ou um signatário que já está no documento. A mesma pessoa pode assinar mais de uma vez. "Nova pessoa" continua sendo uma escolha explícita, não nasce sozinha a cada clique. Não puxa usuário do sistema. Dá para arrastar, duplicar e apagar.
- O signatário extra é opcional e vale para aquele documento. É uma pessoa de fora: nome e contato deste envio, sem virar colaborador. O histórico oferece os últimos contatos que já foram enviados. O documento seguinte herda as marcações. Canal e autenticação ficam no signatário. O lembrete fica na revisão. O prazo enviado ao Assina AI é sempre de 30 dias a partir do envio.
- Prazo e lembrete são de cada documento. O lembrete do documento seguinte abre com o último valor. O `signatureDeadline` do Assina AI é sempre o fim do 30º dia depois do envio.
- A posição da assinatura também passa para o documento seguinte. Se a página marcada não existe nesse PDF, a marca fica na última página que ele tem, no mesmo ponto.
- O primeiro signatário é o colaborador do documento. Escolher essa pessoa na marcação grava o vínculo do arquivo. As outras marcações são adicionais.
- Revisar envio só abre quando todos os documentos do lote estão prontos. O que não vai é excluído na preparação, pela lixeira do documento. Sem marcação de colaborador, o vínculo do arquivo sai junto. O erro de envio aparece só na revisão, como alerta, com o motivo que o Assina AI devolveu. A linha que já tem envelope não é enviada de novo.
- O progresso do anexo fica em "Anexo pronto" ao voltar de Preparar para Anexar. O create manda o PDF como `application/pdf` e o envelope como `application/json`.
- O clique numa área livre do PDF cria a marcação, já como assinatura. O card escolhe quem assina entre o colaborador e os signatários já adicionados, e se é assinatura ou rubrica. Não há barra de signatário nem botões de tipo acima do PDF. O aviso fica num alerta da página, acima do PDF, enquanto o documento ainda pode ser preparado. Arrastar pela alça só move depois de um deslocamento real do ponteiro. A cópia nasce dentro da página e selecionada.
- A navegação é um controle só: anterior, "Documento N de T" com a lista, e próximo. Marca herdada só fica pronta depois que aquele PDF é aberto. O painel separa signatários, configurações de envio e a situação. A situação usa ícone de check ou X. Falta de contato aparece nesse ícone, sem a frase "Falta contato no cadastro."
- Excluir a única página pede confirmação, porque o documento sai do lote. A marcação que estava na página excluída deixa de valer.
- Na revisão fica o lembrete. O prazo de assinatura é de 30 dias a partir do envio. Sem documento marcado, o lembrete vale para todos os que ainda não foram enviados. Contato e canal não mudam. A lista não repete o status do grupo. O nome na tela é a categoria, sem o índice "(2)" gravado no arquivo. A lixeira tira do lote um documento que ainda não foi enviado.
- Os indicadores Enviados, Pendentes e Assinados são só leitura. A busca é por documento ou colaborador. Atalhos e pastas abrem a lista. Na preparação o documento está Pronto, Precisa de atenção ou Já enviado. O motivo da pendência é Sem colaborador, Contato incompleto, Falta marcação ou Revisar marcação.
- Na linha Pendente, o menu oferece Baixar PDF, Reenviar link, Copiar link, Mover e Excluir documento. Excluir tira o documento das listas e pastas, cancela o envelope no Assina AI e não pode ser desfeito. A linha e o PDF ficam só para auditoria. Se houver outro signatário, o aviso diz que a assinatura de todos será cancelada. Mover troca colaborador, mês ou ano no WDash e não altera a assinatura em andamento. Sucesso e erro dessas ações aparecem no toast.
- Cada página do documento pode ser apagada antes do envio, com a lixeira. Apagar a última página tira o documento do lote. Documento que já tem envelope não perde página.

### Agent's Discretion

- O lembrete fica no documento, e o seguinte herda o último valor. O prazo enviado é sempre de 30 dias.
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
