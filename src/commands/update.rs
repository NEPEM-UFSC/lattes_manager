// Verificação e instalação de atualizações.
//
// Fonte da verdade: a última release publicada no GitHub (rascunhos e pré-releases ficam de
// fora). A instalação automática usa o plugin updater do Tauri, que baixa o `latest.json` da
// release, confere a assinatura do instalador com a chave pública do `tauri.conf.json`, instala
// e reinicia o app. Onde ela não é possível (Linux instalado por .deb/.rpm, release sem
// `latest.json`, falha de rede no GitHub), o app oferece o download do instalador certo para o
// sistema.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

const REPO: &str = "NEPEM-UFSC/lattes_manager";

#[derive(Debug, Clone, Serialize, Default)]
pub struct UpdateInfo {
    /// versão instalada
    pub atual: String,
    /// última versão publicada
    pub versao: String,
    /// a versão publicada é maior que a instalada
    pub disponivel: bool,
    /// a atualização pode ser baixada e instalada dentro do app
    pub automatica: bool,
    /// notas da release (Markdown)
    pub notas: String,
    /// data de publicação (ISO 8601)
    pub data: String,
    /// página da release
    pub pagina: String,
    /// instalador para este sistema (download manual), se encontrado
    pub download: Option<String>,
    pub arquivo: Option<String>,
    /// "windows", "macos", "linux-appimage", "linux-deb", "linux-rpm"
    pub sistema: String,
}

#[derive(Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Deserialize)]
struct GhRelease {
    tag_name: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
    html_url: String,
    #[serde(default)]
    assets: Vec<GhAsset>,
}

/// "v1.10.2" → (1, 10, 2); partes ausentes ou não numéricas contam 0.
fn parse_version(v: &str) -> (u64, u64, u64) {
    let v = v.trim().trim_start_matches(['v', 'V']);
    let core = v.split(['-', '+']).next().unwrap_or("");
    let mut it = core
        .split('.')
        .map(|p| p.trim().parse::<u64>().unwrap_or(0));
    (
        it.next().unwrap_or(0),
        it.next().unwrap_or(0),
        it.next().unwrap_or(0),
    )
}

pub fn is_newer(publicada: &str, instalada: &str) -> bool {
    parse_version(publicada) > parse_version(instalada)
}

/// Tipo de instalação deste executável.
fn sistema() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if std::env::var_os("APPIMAGE").is_some() {
        "linux-appimage"
    } else if std::path::Path::new("/etc/debian_version").exists() {
        "linux-deb"
    } else {
        "linux-rpm"
    }
}

/// O plugin updater instala sozinho no Windows (NSIS), no macOS (.app) e no Linux só em AppImage.
fn instala_sozinho(sis: &str) -> bool {
    matches!(sis, "windows" | "macos" | "linux-appimage")
}

/// Instalador da release adequado ao sistema (para download manual).
fn escolher_asset<'a>(assets: &'a [(String, String)], sis: &str) -> Option<&'a (String, String)> {
    let arch_ok = |n: &str| {
        let n = n.to_lowercase();
        let arm = cfg!(target_arch = "aarch64");
        let tem_arm = n.contains("aarch64") || n.contains("arm64");
        if arm {
            tem_arm || !(n.contains("x64") || n.contains("x86_64") || n.contains("amd64"))
        } else {
            !tem_arm
        }
    };
    let ext: &[&str] = match sis {
        "windows" => &["-setup.exe", ".exe", ".msi"],
        "macos" => &[".dmg"],
        "linux-appimage" => &[".appimage"],
        "linux-deb" => &[".deb", ".appimage"],
        _ => &[".rpm", ".appimage"],
    };
    // prefere a arquitetura deste computador; sem ela, qualquer instalador da extensão
    // (ex.: Windows ARM roda o instalador x64 por emulação)
    for e in ext {
        let mut da_ext = assets.iter().filter(|(n, _)| n.to_lowercase().ends_with(e));
        let primeiro = da_ext.clone().next();
        if let Some(a) = da_ext.find(|(n, _)| arch_ok(n)).or(primeiro) {
            return Some(a);
        }
    }
    None
}

fn ultima_release() -> Result<GhRelease, String> {
    let url = format!("https://api.github.com/repos/{}/releases/latest", REPO);
    let resp = ureq::get(&url)
        .set("Accept", "application/vnd.github+json")
        .set("User-Agent", "LattesManager-updater")
        .timeout(std::time::Duration::from_secs(15))
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(404, _) => "Nenhuma versão publicada ainda.".to_string(),
            ureq::Error::Status(403, _) | ureq::Error::Status(429, _) => {
                "O GitHub limitou as consultas; tente de novo mais tarde.".to_string()
            }
            other => format!("Sem conexão com o GitHub: {}", other),
        })?;
    resp.into_json::<GhRelease>()
        .map_err(|e| format!("Resposta inesperada do GitHub: {}", e))
}

/// Consulta a última release publicada e diz se há versão nova para este sistema.
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<UpdateInfo, String> {
    let atual = env!("CARGO_PKG_VERSION").to_string();
    let rel = tauri::async_runtime::spawn_blocking(ultima_release)
        .await
        .map_err(|e| e.to_string())??;
    let sis = sistema();
    let assets: Vec<(String, String)> = rel
        .assets
        .iter()
        .map(|a| (a.name.clone(), a.browser_download_url.clone()))
        .collect();
    let escolhido = escolher_asset(&assets, sis).cloned();
    let versao = rel.tag_name.trim_start_matches(['v', 'V']).to_string();
    let disponivel = is_newer(&versao, &atual);

    // a instalação automática exige o latest.json assinado da mesma versão
    let mut automatica = false;
    if disponivel && instala_sozinho(sis) {
        if let Ok(updater) = app.updater() {
            if let Ok(Some(up)) = updater.check().await {
                automatica = !is_newer(&versao, &up.version);
            }
        }
    }

    Ok(UpdateInfo {
        atual,
        versao,
        disponivel,
        automatica,
        notas: rel.body.unwrap_or_default(),
        data: rel.published_at.unwrap_or_default(),
        pagina: rel.html_url,
        arquivo: escolhido.as_ref().map(|a| a.0.clone()),
        download: escolhido.map(|a| a.1),
        sistema: sis.to_string(),
    })
}

#[derive(Clone, Serialize)]
struct Progresso {
    baixado: u64,
    total: Option<u64>,
    etapa: &'static str,
}

/// Baixa a atualização (com progresso no evento "update-progress"), confere a assinatura,
/// instala e reinicia o app.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| format!("Não foi possível consultar a atualização: {}", e))?
        .ok_or("Nenhuma atualização disponível.")?;
    let mut baixado: u64 = 0;
    let h1 = app.clone();
    let h2 = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                baixado += chunk as u64;
                let _ = h1.emit(
                    "update-progress",
                    Progresso {
                        baixado,
                        total,
                        etapa: "baixando",
                    },
                );
            },
            move || {
                let _ = h2.emit(
                    "update-progress",
                    Progresso {
                        baixado: 0,
                        total: None,
                        etapa: "instalando",
                    },
                );
            },
        )
        .await
        .map_err(|e| format!("Falha ao instalar a atualização: {}", e))?;
    // no Windows o instalador NSIS fecha o app sozinho; nos demais, reinicia aqui
    app.restart();
}

/// CHANGELOG embutido no executável: as notas da versão aparecem mesmo sem internet.
const CHANGELOG: &str = include_str!("../../CHANGELOG.md");

/// Seção "## X.Y.Z" do CHANGELOG (sem o título), ou None se não houver.
pub fn changelog_section(changelog: &str, versao: &str) -> Option<String> {
    let v = versao.trim().trim_start_matches(['v', 'V']);
    let mut dentro = false;
    let mut linhas = Vec::new();
    for l in changelog.lines() {
        if let Some(t) = l.strip_prefix("## ") {
            if dentro {
                break;
            }
            dentro = t.trim() == v;
            continue;
        }
        if dentro {
            linhas.push(l);
        }
    }
    let txt = linhas.join("\n").trim().to_string();
    (dentro || !txt.is_empty())
        .then_some(txt)
        .filter(|t| !t.is_empty())
}

/// Notas da versão instalada (ou de outra), tiradas do CHANGELOG embutido.
#[tauri::command]
pub fn get_release_notes(versao: Option<String>) -> Option<String> {
    let v = versao.unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());
    changelog_section(CHANGELOG, &v)
}

/// Traz a janela principal para a frente (depois de atualizar, o instalador às vezes a
/// reabre minimizada ou atrás das outras).
#[tauri::command]
pub fn focus_main_window(app: AppHandle) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notas_da_versao() {
        let cl = "# Hist\n\n## 1.3.0\n\n### Formação\n- A\n- B\n\n## 1.2.0\n\n- C\n";
        assert_eq!(
            changelog_section(cl, "v1.3.0").as_deref(),
            Some("### Formação\n- A\n- B")
        );
        assert_eq!(changelog_section(cl, "1.2.0").as_deref(), Some("- C"));
        assert_eq!(changelog_section(cl, "1.1.0"), None);
        // o CHANGELOG real tem a versão atual
        assert!(
            get_release_notes(None).is_some(),
            "CHANGELOG.md sem a seção da versão {}",
            env!("CARGO_PKG_VERSION")
        );
    }

    #[test]
    fn compara_versoes() {
        assert!(is_newer("v1.3.0", "1.2.9"));
        assert!(is_newer("1.10.0", "1.9.9"));
        assert!(is_newer("2.0", "1.99.99"));
        assert!(!is_newer("v1.2.0", "1.2.0"));
        assert!(!is_newer("1.1.0", "1.2.0"));
        assert!(!is_newer("1.2.0-beta", "1.2.0"));
    }

    #[test]
    fn escolhe_instalador_do_sistema() {
        let a: Vec<(String, String)> = [
            "Lattes.Manager_1.3.0_x64-setup.exe",
            "Lattes.Manager_1.3.0_x64-setup.exe.sig",
            "Lattes.Manager_1.3.0_universal.dmg",
            "Lattes.Manager_1.3.0_amd64.deb",
            "Lattes.Manager-1.3.0-1.x86_64.rpm",
            "Lattes.Manager_1.3.0_amd64.AppImage",
            "latest.json",
        ]
        .iter()
        .map(|n| (n.to_string(), format!("https://x/{}", n)))
        .collect();
        let nome = |s: &str| escolher_asset(&a, s).map(|x| x.0.as_str());
        assert_eq!(nome("windows"), Some("Lattes.Manager_1.3.0_x64-setup.exe"));
        assert_eq!(nome("macos"), Some("Lattes.Manager_1.3.0_universal.dmg"));
        assert_eq!(nome("linux-deb"), Some("Lattes.Manager_1.3.0_amd64.deb"));
        assert_eq!(nome("linux-rpm"), Some("Lattes.Manager-1.3.0-1.x86_64.rpm"));
        assert_eq!(
            nome("linux-appimage"),
            Some("Lattes.Manager_1.3.0_amd64.AppImage")
        );

        // com versões para as duas arquiteturas, escolhe a deste computador
        let duas: Vec<(String, String)> = ["App_1.0_aarch64.AppImage", "App_1.0_amd64.AppImage"]
            .iter()
            .map(|n| (n.to_string(), n.to_string()))
            .collect();
        let esperado = if cfg!(target_arch = "aarch64") {
            "App_1.0_aarch64.AppImage"
        } else {
            "App_1.0_amd64.AppImage"
        };
        assert_eq!(
            escolher_asset(&duas, "linux-appimage").map(|x| x.0.as_str()),
            Some(esperado)
        );
    }
}
