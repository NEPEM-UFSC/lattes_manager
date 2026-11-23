# Histórico de versões

## Não lançado

### Distribuição
- Licença MIT.
- Cada release traz `SHA256SUMS.txt` e um atestado de origem do GitHub (`gh attestation verify`) para os instaladores dos três sistemas.

## 1.2.0

### Funcionalidade
- Pacote do interstício (Simulador de Pontuação): exporta a planilha de pontuação e abre o gerador de comprovantes já restrito aos registros que pontuam no período, com o título do barema e o período na capa. Projetos e atividades que começaram antes do interstício e terminam dentro dele também entram, como na pontuação.
- Qualis oficial da CAPES (Ferramentas › Produções): lê a planilha do Qualis exportada da Plataforma Sucupira (.xlsx, .xls, .ods ou .csv, com detecção automática das colunas e da área de avaliação), compara com os artigos pelo ISSN ou, sem ISSN, pelo nome da revista, e grava os estratos depois de uma prévia com seleção item a item.
- Produção com discentes (Ferramentas › Produções): mostra quais produções têm orientados como coautores, por ano e nível, com comparação aproximada de nomes (nome completo, nome de citação, iniciais), aviso para casos duvidosos ou fora do período da orientação, confirmação ou descarte de cada ligação (fica salvo) e exportação para Excel.

### Dados
- Campo ISSN nas produções, preenchido pela planilha do Qualis ou buscado na OpenAlex a partir do DOI (também pela sincronização de métricas da OpenAlex).
- Autores das produções: a importação do XML do Lattes passa a guardá-los, e o botão "Atualizar autores pelo XML" completa as produções já cadastradas.
- O banco é atualizado sozinho na primeira abertura (colunas novas em Produções e Orientações), com uma cópia de segurança em `backups/` antes da mudança.

### Identificação de comprovantes (PDF e imagem)
- O papel descrito no documento (ouvinte, apresentação de trabalho, palestra, organização, avaliação, banca de TCC/mestrado/doutorado/qualificação, coorientação) escolhe o tipo dentro da categoria e aparece entre as informações encontradas.
- Comprovante com DOI é ligado direto à produção de mesmo DOI ("mesmo DOI"), e a busca por registros parecidos olha as três categorias mais prováveis.
- Aviso quando o documento não cita o seu nome (do Perfil), no cadastro e na importação em lote.
- O ano sugerido passa a ser o da atividade ("realizado em", "no período de", "defendida no dia"), não o da emissão do certificado.
- OCR em qualquer PDF digitalizado: a página é renderizada com o pdf.js antes do reconhecimento, então funcionam também os scanners que gravam a imagem em CCITT, JBIG2 ou PNG (antes só JPEG). Se a 1ª página traz pouco texto, a 2ª também é lida.
- Pistas pelo emissor: certificados da Even3, Doity e Sympla apontam para Eventos; Sigaa (turmas) para Disciplinas; Sigpex para Projetos.

### Cadastro
- Orientações com situação (em andamento / concluída) e papel (orientação / coorientação): lidos do XML do Lattes na importação, editáveis no formulário e indicados na tabela. As já cadastradas recebem a situação pela pasta (orientações em andamento ou concluídas).
- Aviso, ainda no formulário, quando já existe um registro com título muito parecido na mesma categoria (ano igual ou vizinho).
- Produções: ao escolher a revista, o ISSN já usado com ela é preenchido (e vice-versa).

### Ferramentas
- Diagnóstico da classificação (Ferramentas › Comprovantes): cada comprovante vinculado é classificado por um modelo treinado com os demais, mostrando o acerto de categoria e tipo, o acerto por categoria, as confusões mais comuns e os comprovantes classificados errado (com atalho para abrir).

## 1.1.0

### Funcionalidade
- Painel de pendências (Ferramentas › Sincronização): lista os registros sem comprovante, com arquivo ausente no disco, artigos sem DOI ou Qualis e registros sem ano ou título, com atalho para abrir o registro ou a ferramenta que resolve. A tela inicial mostra quantos registros têm pendência.

### Correções
- Linux e macOS: vincular um arquivo pelo caminho absoluto e aplicar a Vassoura de Comprovantes voltaram a funcionar (antes, o caminho era tratado como relativo e a subpasta era criada com `\` no nome).

### Distribuição
- CI com formatação (rustfmt) e lint (clippy) obrigatórios e versão do Rust fixa.
- Actions do GitHub fixadas por hash de commit e atualizadas pelo Dependabot; `tauri-action` 1.0.0, `checkout` 7 e `upload-artifact` 7.

## 1.0.0

Primeira versão pública.

### Segurança
- Abrir arquivo, mostrar na pasta, abrir pasta, excluir anexo e renomear em lote não aceitam mais caminhos fora da pasta do currículo (`..` ou unidade/caminho absoluto).
- Política de segurança de conteúdo (CSP) ativada na janela do app.
- "Mostrar na pasta" e "Abrir" aceitam caminho absoluto dentro da pasta do currículo e, fora dela, apenas os arquivos que o próprio app acabou de gravar (relatório em PDF, planilha, painel e backup).

### Desempenho
- Comandos que usam o banco ou percorrem arquivos (importações, conferência e renomeação de arquivos, duplicados, exportação, backup) rodam fora da thread da interface, e a janela não congela mais.
- Cache dos registros usados pelos indicadores, pelo relatório e pelas ferramentas.
- Índices por ano e tipo em todas as categorias.

### Funcionalidade
- Foto de perfil (PNG ou JPG) em Dados Gerais, com opção de incluí-la na capa do relatório de comprovantes, enquadrada em 3 × 4.
- Gerador de comprovantes mais largo, com subcategorias aninhadas (recolhidas por padrão) e ordem das seções e subcategorias definida arrastando; a ordem fica salva e vale para o PDF.
- Opção "Gerar QR codes dos links" no relatório: seção no fim do PDF com uma grade de QR codes (3 a 6 colunas) por seção, só para itens com DOI ou endereço http(s); cada cartão também é clicável.
- Ferramenta "Extrair DOI dos artigos": varre as produções sem DOI, lê o DOI declarado dentro do PDF anexado e, para as restantes, procura pelo título na Crossref. Prévia com conferência item a item antes de gravar.
- Filtro "Com DOI/URL · Sem DOI/URL" na barra da tabela, em todas as categorias, independente do filtro de comprovante — dá para combinar "sem comprovante + com DOI/URL".
- Campo opcional "URL" em todas as categorias, inclusive as personalizadas (vazio por padrão). Aceita só http(s); sem esquema, completa com https:// e um DOI solto vira link do doi.org. Na tabela, o botão 🔗 abre o link, e o QR code do relatório usa essa URL antes do DOI.
- A busca ignora acentos e maiúsculas: "formacao" encontra "FORMAÇÃO".
- Migrações de esquema versionadas. Antes de atualizar o banco, o app guarda uma cópia em `backups/`.

### Aparência
- Cores de texto secundário, de status e de destaque ajustadas para contraste mínimo de 4,5:1 (WCAG AA) nos temas claros e escuros.

### Distribuição
- Corrigido o empacotamento no macOS (binário universal).
- CI com testes em Windows, macOS e Linux e auditoria de dependências.
