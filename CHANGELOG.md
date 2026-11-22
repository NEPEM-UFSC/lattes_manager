# Histórico de versões

## Não lançado

### Funcionalidade
- Qualis oficial da CAPES (Ferramentas › Produções): lê a planilha do Qualis exportada da Plataforma Sucupira (.xlsx, .xls, .ods ou .csv, com detecção automática das colunas e da área de avaliação), compara com os artigos pelo ISSN ou, sem ISSN, pelo nome da revista, e grava os estratos depois de uma prévia com seleção item a item.
- Campo ISSN nas produções. A ferramenta do Qualis e a sincronização de métricas da OpenAlex preenchem o ISSN que falta a partir do DOI.
- Pacote do interstício (Simulador de Pontuação): exporta a planilha de pontuação e abre o gerador de comprovantes já restrito aos registros que pontuam no período, com o título do barema e o período na capa. Projetos e atividades que começaram antes do interstício e terminam dentro dele também entram, como na pontuação.

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
