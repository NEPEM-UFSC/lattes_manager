# Lattes Manager

🇧🇷 Português · [🇬🇧 English](README.en.md)

Aplicativo de desktop para organizar o Currículo Lattes e os comprovantes de cada item. Roda local e offline (os dados ficam numa pasta sua, num banco SQLite), com versões para Windows, macOS e Linux.

## O que faz

- Importa o XML do Currículo Lattes e mostra o que é novo antes de gravar.
- Cadastra produções por DOI ou PDF, com metadados da Crossref/OpenAlex e sugestão de Qualis.
- Vincula, renomeia e confere os comprovantes (arquivos ausentes, órfãos e duplicados).
- Classifica documentos novos (PDF ou imagem, com OCR) na categoria certa.
- Gera um relatório único em PDF com os comprovantes, além de indicadores e exportação para Excel.
- Faz backup completo (banco e comprovantes) e restauração.
- Avisa quando há versão nova e se atualiza sozinho (Windows, macOS e Linux AppImage).

## Download

Os instaladores estão em [Releases](https://github.com/NEPEM-UFSC/lattes_manager/releases):

| Sistema | Arquivo |
|---|---|
| Windows | `.exe` |
| macOS (Intel e Apple Silicon) | `.dmg` |
| Linux | `.deb`, `.rpm` ou `.AppImage` |

**Assinatura de código:** os instaladores do Windows são assinados gratuitamente pela [SignPath Foundation](https://signpath.org), com serviço da [SignPath.io](https://about.signpath.io) (veja a [política de assinatura](#política-de-assinatura-de-código)). Os instaladores do macOS ainda não são assinados: abra o app pela primeira vez com clique direito › "Abrir".

### Conferir um download

Cada release traz o arquivo `SHA256SUMS.txt` e um atestado de origem do GitHub, que comprovam que o instalador foi gerado por este repositório e não foi alterado:

```sh
sha256sum -c SHA256SUMS.txt --ignore-missing                              # integridade (Linux/macOS)
gh attestation verify <instalador> --repo NEPEM-UFSC/lattes_manager      # origem (GitHub CLI)
```

No Windows, `Get-FileHash <instalador>` mostra a soma para comparar com o `SHA256SUMS.txt`.

## Compilar

Requisitos: [Rust](https://rustup.rs) estável e o Tauri CLI 2 (`cargo install tauri-cli --version "^2"` ou `npm install -g @tauri-apps/cli`). No Linux, instale também as dependências do WebKitGTK listadas em [.github/workflows/ci.yml](.github/workflows/ci.yml).

```sh
cargo tauri dev                 # abre o app em modo de desenvolvimento
cargo test --all-targets        # testes
cargo tauri build               # instaladores em target/release/bundle/
```

No Windows, `powershell -ExecutionPolicy Bypass -File scripts\instalador-local.ps1` gera o instalador e o copia para `instaladores/`.

A interface fica em `ui/` (HTML, CSS e JavaScript, sem bundler). O backend fica em `src/` (Rust).

## Publicar uma versão

1. Registre as mudanças na seção `## Não publicado` do [CHANGELOG.md](CHANGELOG.md) e faça o commit.
2. Rode `.\update_app v1.3.0` na pasta do projeto (Windows). O script [scripts/release.ps1](scripts/release.ps1) confere o repositório, atualiza a versão em `tauri.conf.json`, `Cargo.toml`, `Cargo.lock` e no CHANGELOG, roda os testes, faz o commit, cria a tag e envia tudo. Opções: `-DryRun` (só mostra o que faria), `-SkipTests` e `-Force` (recria uma tag que ainda não virou release).
3. O workflow "Instaladores" monta um rascunho de Release com os arquivos dos três sistemas; o instalador do Windows é enviado ao SignPath para assinatura. Confira o rascunho e clique em "Publish release".

## Política de assinatura de código

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

Assinatura de código gratuita fornecida pela SignPath.io, com certificado da SignPath Foundation. Os instaladores do Windows são compilados a partir deste repositório público pelo workflow "Instaladores" do GitHub Actions, e só esses arquivos são enviados para assinatura.

- Autores (committers) e revisores: [membros da organização NEPEM-UFSC](https://github.com/orgs/NEPEM-UFSC/people) com permissão de escrita no repositório.
- Aprovador de cada assinatura: [Tiago Olivoto](https://github.com/TiagoOlivoto).

Toda mudança passa pelos testes do CI, com auditoria de dependências e CodeQL, antes de gerar uma versão.

### Privacidade

Este programa não envia nenhuma informação a outros sistemas em rede, a menos que o usuário peça. Isso acontece apenas quando o usuário usa as funções de busca, como consultar um DOI, o ORCID ou o OpenAlex, ou baixar o PDF de acesso aberto de um artigo. Os dados do currículo e os comprovantes ficam no computador do usuário.

A única conexão automática é a verificação de atualizações: ao abrir, no máximo duas vezes por dia, o app consulta a página pública de versões do GitHub (`api.github.com`) para saber se há versão nova. Nenhum dado do usuário é enviado. A verificação pode ser desligada em Sobre › "Verificar ao abrir o app".

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.

## Autoria

Prof. Dr. Tiago Olivoto, LEMGAD/NEPEM/UFSC.

## Licença

[MIT](LICENSE). Os componentes de terceiros incluídos em `ui/vendor/` (pdf.js, tesseract.js, pdf-lib, fontkit e qrcode) mantêm as licenças dos seus projetos de origem; a do pdf.js (Apache-2.0) está em `ui/vendor/pdfjs/LICENSE`.
