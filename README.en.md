# Lattes Manager

[🇧🇷 Português](README.md) · 🇬🇧 English

Desktop application for Brazilian researchers and university faculty to organize their [Lattes CV](https://lattes.cnpq.br) (the national academic CV platform maintained by CNPq) together with the documents that prove each entry. It runs locally and offline: data stays in a folder you choose, in a SQLite database. Available for Windows, macOS and Linux.

## Features

- Imports the official Lattes CV XML and shows what is new before saving.
- Adds publications by DOI or PDF, with metadata from Crossref/OpenAlex and a suggested Qualis journal rating.
- Links, renames and audits supporting documents (missing, orphaned and duplicated files).
- Classifies new documents (PDF or image, with OCR) into the right category.
- Generates a single PDF report with all supporting documents, plus indicators and Excel export.
- Simulates scores for faculty career progression and public hiring processes using configurable scoring tables.
- Full backup (database and documents) and restore.
- Checks for new versions and updates itself (Windows, macOS and Linux AppImage).

The user interface is in Brazilian Portuguese, since the Lattes CV is specific to Brazil.

## Download

Installers are available on the [Releases](https://github.com/NEPEM-UFSC/lattes_manager/releases) page:

| System | File |
|---|---|
| Windows | `.exe` |
| macOS (Intel and Apple Silicon) | `.dmg` |
| Linux | `.deb`, `.rpm` or `.AppImage` |

**Code signing:** Windows installers are signed for free by the [SignPath Foundation](https://signpath.org), with the service provided by [SignPath.io](https://about.signpath.io) (see the [code signing policy](#code-signing-policy)). macOS installers are not signed yet: open the app the first time with right-click › "Open".

### Verifying a download

Each release includes a `SHA256SUMS.txt` file and a GitHub build provenance attestation, which prove that the installer was built from this repository and has not been modified:

```sh
sha256sum -c SHA256SUMS.txt --ignore-missing                              # integrity (Linux/macOS)
gh attestation verify <installer> --repo NEPEM-UFSC/lattes_manager       # origin (GitHub CLI)
```

On Windows, `Get-FileHash <installer>` prints the checksum to compare with `SHA256SUMS.txt`.

## Building

Requirements: stable [Rust](https://rustup.rs) and Tauri CLI 2 (`cargo install tauri-cli --version "^2"` or `npm install -g @tauri-apps/cli`). On Linux, also install the WebKitGTK dependencies listed in [.github/workflows/ci.yml](.github/workflows/ci.yml).

```sh
cargo tauri dev                 # run the app in development mode
cargo test --all-targets        # tests
cargo tauri build               # installers in target/release/bundle/
```

The user interface lives in `ui/` (HTML, CSS and JavaScript, no bundler). The backend lives in `src/` (Rust).

## Releasing

1. Record the changes under `## Não publicado` (unreleased) in [CHANGELOG.md](CHANGELOG.md) and commit.
2. Run `.\update_app v1.3.0` in the project folder (Windows). The [scripts/release.ps1](scripts/release.ps1) script checks the repository, updates the version in `tauri.conf.json`, `Cargo.toml`, `Cargo.lock` and the changelog, runs the tests, commits, tags and pushes. Options: `-DryRun`, `-SkipTests` and `-Force` (recreates a tag that has not been released yet).
3. The "Instaladores" workflow builds the installers for all three systems into a draft Release; the Windows installer is sent to SignPath for signing.

## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

Windows installers are built from this public repository by the "Instaladores" GitHub Actions workflow, and only those files are submitted for signing.

- Committers and reviewers: [members of the NEPEM-UFSC organization](https://github.com/orgs/NEPEM-UFSC/people) with write access to the repository.
- Approver of each signing request: [Tiago Olivoto](https://github.com/TiagoOlivoto).

Every change is tested in CI, with dependency auditing and CodeQL, before a release is built.

### Privacy

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.

Network access happens only when the user uses a lookup feature, such as querying a DOI, ORCID or OpenAlex, or downloading the open-access PDF of an article. CV data and supporting documents stay on the user's computer. The app has no user accounts and no telemetry.

The only automatic connection is the update check: when the app starts (at most twice a day), it queries the public GitHub Releases API (`api.github.com`) to see whether a newer version exists. No user data is sent. The check can be turned off in Sobre (About) › "Verificar ao abrir o app".

## Author

Prof. Dr. Tiago Olivoto, LEMGAD/NEPEM/UFSC (Federal University of Santa Catarina, Brazil).

## License

[MIT](LICENSE). Third-party components bundled in `ui/vendor/` (pdf.js, tesseract.js, pdf-lib, fontkit and qrcode) keep the licenses of their original projects; the pdf.js license (Apache-2.0) is in `ui/vendor/pdfjs/LICENSE`.
