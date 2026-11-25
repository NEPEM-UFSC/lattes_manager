<#
.SYNOPSIS
  Publica uma nova versão do Lattes Manager: atualiza a versão, faz o commit, cria a tag e envia.

.DESCRIPTION
  1. Confere o repositório (branch master, sem merge pela metade, sem alterações não commitadas,
     sincronizado com o GitHub).
  2. Atualiza a versão em tauri.conf.json, Cargo.toml e Cargo.lock, e transforma a seção
     "## Não publicado" do CHANGELOG.md em "## X.Y.Z".
  3. Roda cargo fmt --check e os testes (pule com -SkipTests).
  4. Commit "chore: versão X.Y.Z", tag vX.Y.Z, push do master e da tag. A tag dispara o
     workflow "Instaladores", que monta o rascunho da Release.

.EXAMPLE
  .\update_app v1.3.0
  .\update_app 1.3.1 -SkipTests
  .\update_app v1.3.0 -Force      # recria a tag v1.3.0 (ex.: tag criada no commit errado)
  .\update_app v1.4.0 -DryRun     # só mostra o que faria
#>
param(
  [Parameter(Mandatory = $true, Position = 0)][string]$Version,
  [switch]$SkipTests,
  [switch]$Force,
  [switch]$DryRun
)

# "Continue": git e cargo escrevem progresso na saída de erro, o que o PowerShell 5 trataria como
# falha; os erros de verdade são conferidos pelo código de saída ($LASTEXITCODE).
$ErrorActionPreference = "Continue"
$script:arquivos = @("tauri.conf.json", "Cargo.toml", "Cargo.lock", "CHANGELOG.md")
$script:alterou = $false   # arquivos de versão modificados e ainda sem commit
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$utf8 = New-Object System.Text.UTF8Encoding $false

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Fail($msg) {
  Write-Host "`nERRO: $msg" -ForegroundColor Red
  if ($script:alterou -and -not $DryRun) {
    & git checkout -- $script:arquivos 2>$null
    Write-Host "   (as mudanças de versão nos arquivos foram desfeitas)" -ForegroundColor Yellow
  }
  exit 1
}
function GitOut {
  # git com conferência do código de saída; devolve a saída como texto
  $out = & git @args
  if ($LASTEXITCODE -ne 0) { Fail "git $($args -join ' ') falhou." }
  return $out
}
function Run($what, [scriptblock]$cmd) {
  if ($DryRun) { Write-Host "   (simulação) $what" -ForegroundColor DarkGray; return }
  & $cmd
  if ($LASTEXITCODE -ne 0) { Fail "$what falhou." }
}
function ReadText($p) { [System.IO.File]::ReadAllText((Join-Path $root $p), $utf8) }
function WriteText($p, $t) {
  if (-not $DryRun) { [System.IO.File]::WriteAllText((Join-Path $root $p), $t, $utf8); $script:alterou = $true }
}

# ---------- versão ----------
$v = $Version.Trim().TrimStart('v', 'V')
if ($v -notmatch '^\d+\.\d+\.\d+$') { Fail "Versão inválida: '$Version'. Use o formato 1.3.0 ou v1.3.0." }
$tag = "v$v"
Write-Host "Lattes Manager - publicar $tag$(if ($DryRun) { ' (SIMULAÇÃO)' })" -ForegroundColor Green

# ---------- repositório ----------
Step "Conferindo o repositório"
$branch = (GitOut rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne "master") { Fail "Você está no branch '$branch'. Mude para o master (git checkout master)." }
if (Test-Path (Join-Path $root ".git\MERGE_HEAD")) { Fail "Há um merge pela metade. Conclua (git commit) ou cancele (git merge --abort) antes." }
$pend = GitOut status --porcelain
if ($pend) {
  Write-Host ($pend -join "`n")
  Fail "Há alterações não commitadas (acima). Faça o commit delas antes de publicar."
}
GitOut fetch origin --tags --force | Out-Null
$counts = (GitOut rev-list --left-right --count "HEAD...origin/master").Trim() -split '\s+'
$ahead = [int]$counts[0]; $behind = [int]$counts[1]
if ($behind -gt 0 -and $ahead -gt 0) { Fail "O master local e o do GitHub divergiram ($ahead à frente, $behind atrás). Rode 'git pull' e resolva antes." }
if ($behind -gt 0) {
  Write-Host "   O GitHub tem $behind commit(s) novo(s); atualizando (git pull --ff-only)..."
  Run "git pull" { git pull --ff-only origin master }
}

# versão atual e tag
$conf = ReadText "tauri.conf.json"
$atual = ([regex]'"version"\s*:\s*"([^"]+)"').Match($conf).Groups[1].Value
Write-Host "   versão atual: $atual  ->  nova: $v"
$parse = { param($s) $p = $s.Split('.') | ForEach-Object { [int]$_ }; $p[0] * 1000000 + $p[1] * 1000 + $p[2] }
if ((& $parse $v) -lt (& $parse $atual)) { Fail "A versão $v é menor que a atual ($atual)." }

$tagLocal = (& git tag --list $tag)
$tagRemota = (& git ls-remote --tags origin "refs/tags/$tag")
if (($tagLocal -or $tagRemota) -and -not $Force) {
  Fail "A tag $tag já existe$(if ($tagRemota) { ' no GitHub' }). Para recriá-la no commit novo, use -Force (só se a release $tag ainda não foi publicada)."
}

# ---------- arquivos ----------
Step "Atualizando a versão nos arquivos"
$mudou = $false

$novoConf = ([regex]'("version"\s*:\s*")[^"]+(")').Replace($conf, "`${1}$v`${2}", 1)
if ($novoConf -ne $conf) { WriteText "tauri.conf.json" $novoConf; $mudou = $true; Write-Host "   tauri.conf.json" }

$cargo = ReadText "Cargo.toml"
$novoCargo = ([regex]'(?m)^(version\s*=\s*")[^"]+(")').Replace($cargo, "`${1}$v`${2}", 1)
if ($novoCargo -ne $cargo) { WriteText "Cargo.toml" $novoCargo; $mudou = $true; Write-Host "   Cargo.toml" }

$cl = ReadText "CHANGELOG.md"
# (?=\r?$): o arquivo pode ter quebras de linha do Windows (CRLF)
if ($cl -match "(?m)^## $([regex]::Escape($v))[ \t]*(?=\r?$)") {
  Write-Host "   CHANGELOG.md já tem a seção $v"
} elseif ($cl -match '(?m)^## Não publicado[ \t]*(?=\r?$)') {
  $novoCl = ([regex]'(?m)^## Não publicado[ \t]*(?=\r?$)').Replace($cl, "## $v", 1)
  if ($novoCl -eq $cl) { Fail "Não consegui renomear a seção 'Não publicado' do CHANGELOG.md." }
  WriteText "CHANGELOG.md" $novoCl
  $mudou = $true
  Write-Host "   CHANGELOG.md: 'Não publicado' -> '$v'"
} else {
  Write-Host "   AVISO: o CHANGELOG.md não tem a seção '## Não publicado' nem '## $v'." -ForegroundColor Yellow
  $r = Read-Host "   Publicar mesmo assim, sem notas da versão? (s/N)"
  if (-not ("$r" -match '^[sS]')) { Fail "Cancelado. Escreva as novidades no CHANGELOG.md e rode de novo." }
}

if ($mudou -and -not $DryRun) {
  # atualiza o Cargo.lock com a versão nova (só o pacote do app, sem mexer nas dependências)
  & cargo update -p lattes-app --offline 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { & cargo check -q 2>&1 | Out-Null }
  if ($LASTEXITCODE -ne 0) { Fail "Não foi possível atualizar o Cargo.lock." }
}

# ---------- verificações ----------
if (-not $SkipTests) {
  Step "Formatação e testes (pule com -SkipTests)"
  Run "cargo fmt --check" { cargo fmt --check }
  Run "cargo test" { cargo test --lib -q }
}

# ---------- commit, tag e envio ----------
Step "Commit, tag e envio"
if ($mudou) {
  Run "git add" { git add tauri.conf.json Cargo.toml Cargo.lock CHANGELOG.md }
  Run "git commit" { git commit -q -m "chore: versão $v" }
  $script:alterou = $false
  Write-Host "   commit: chore: versão $v"
} else {
  Write-Host "   arquivos já estavam na versão $v (sem commit novo)"
}
Run "git push" { git push origin master }

if ($tagLocal) { Run "apagar tag local" { git tag -d $tag } }
if ($tagRemota) {
  Write-Host "   apagando a tag $tag antiga do GitHub (-Force)"
  Run "apagar tag remota" { git push origin ":refs/tags/$tag" }
}
Run "git tag" { git tag $tag }
Run "git push da tag" { git push origin $tag }

$repo = ((GitOut remote get-url origin).Trim() -replace '\.git$', '' -replace '^git@github\.com:', 'https://github.com/')
if ($DryRun) { Write-Host "`nSimulação concluída: nada foi alterado nem enviado." -ForegroundColor Green; exit 0 }
Write-Host "`nPronto! A tag $tag disparou o workflow 'Instaladores' (15-20 min):" -ForegroundColor Green
Write-Host "   $repo/actions"
Write-Host "Quando terminar, confira o rascunho (latest.json e .sig) e clique em 'Publish release':"
Write-Host "   $repo/releases"
