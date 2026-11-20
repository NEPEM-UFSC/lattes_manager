use regex::Regex;
use std::fs;
use std::path::Path;
use std::sync::LazyLock;

static PREFIX_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(\d{3,})_(.*)$").unwrap());
static SCAN_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(\d{3,})_").unwrap());

/// Matches regex `^(\d{3})_(.*)$` and strips the prefix (e.g. `"001_relatorio.pdf"` -> `"relatorio.pdf"`).
/// If no 3-digit prefix, returns the original filename.
pub fn strip_existing_prefix(filename: &str) -> String {
    if let Some(caps) = PREFIX_RE.captures(filename) {
        if let Some(m) = caps.get(2) {
            return m.as_str().to_string();
        }
    }
    filename.to_string()
}

/// Helper function to split extension from filename matching Python genericpath splitext behavior:
/// Extension is everything from the last dot to the end, ignoring leading dots.
fn split_ext(p: &str) -> (&str, &str) {
    if let Some(dot_idx) = p.rfind('.') {
        // Extension requires at least one non-dot character before the dot
        if p[..dot_idx].chars().any(|c| c != '.') {
            return (&p[..dot_idx], &p[dot_idx..]);
        }
    }
    (p, "")
}

/// Sanitizes a filename for Windows NTFS:
/// - Replaces invalid NTFS characters `\ / : * ? " < > |` with `_`.
/// - Removes control characters (`ord(c) < 32`).
/// - Strips trailing spaces and dots before extension (`"meu_arquivo . ...pdf"` -> `"meu_arquivo.pdf"`).
/// - Fallback to `"arquivo"` if base name becomes empty.
/// - Preserves Unicode Portuguese diacritics (`ç`, `ã`, `é`, `í`, `ó`, etc.).
/// - Truncates base filename to safe length (base + ext <= 245) to prevent NTFS OS error 123.
pub fn sanitize_windows_filename(name: &str) -> String {
    let filtered: String = name
        .chars()
        .filter(|&c| (c as u32) >= 32)
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            other => other,
        })
        .collect();

    let (base, ext) = split_ext(&filtered);
    let base_trimmed = base.trim_end_matches(['.', ' ']);
    let base_initial = if base_trimmed.is_empty() {
        "arquivo"
    } else {
        base_trimmed
    };

    // Safe truncation for NTFS 255-character limit:
    // With prefix like "001_" (4 chars) or "1000_" (5 chars), keep base + ext <= 245.
    let ext_chars = ext.chars().count();
    let max_base_chars = if ext_chars < 240 {
        240.min(245usize.saturating_sub(ext_chars))
    } else {
        1
    };

    let base_truncated: String = if base_initial.chars().count() > max_base_chars {
        base_initial.chars().take(max_base_chars).collect()
    } else {
        base_initial.to_string()
    };

    let base_final_trimmed = base_truncated.trim_end_matches(['.', ' ']);
    let base_final = if base_final_trimmed.is_empty() {
        "arquivo"
    } else {
        base_final_trimmed
    };

    format!("{}{}", base_final, ext)
}

/// Computes the next sequential filename in `target_folder`:
/// - Cleans original filename with `strip_existing_prefix` and `sanitize_windows_filename`.
/// - Creates `target_folder` if it does not exist.
/// - Scans `target_folder` entries with regex `^(\d{3})_` to find `max_prefix`.
/// - Returns `format!("{:03}_{}", max_prefix + 1, sanitized)`. Empty folder returns `001_<sanitized>`.
pub fn calculate_next_filename(
    target_folder: &Path,
    original_filename: &str,
) -> Result<String, String> {
    let clean_base = strip_existing_prefix(original_filename);
    let sanitized = sanitize_windows_filename(&clean_base);

    if !target_folder.exists() {
        fs::create_dir_all(target_folder)
            .map_err(|e| format!("Failed to create folder {}: {}", target_folder.display(), e))?;
    }

    let mut max_prefix = 0u32;
    if target_folder.is_dir() {
        for entry in fs::read_dir(target_folder)
            .map_err(|e| format!("Failed to read folder {}: {}", target_folder.display(), e))?
        {
            let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
            let fname = entry.file_name().to_string_lossy().to_string();
            if let Some(caps) = SCAN_RE.captures(&fname) {
                if let Some(m) = caps.get(1) {
                    if let Ok(num) = m.as_str().parse::<u32>() {
                        if num > max_prefix {
                            max_prefix = num;
                        }
                    }
                }
            }
        }
    }

    let next_prefix = max_prefix + 1;
    Ok(format!("{:03}_{}", next_prefix, sanitized))
}

/// Letra sem acento (ASCII) para nomes de arquivo seguros.
pub fn fold(c: char) -> Option<&'static str> {
    Some(match c {
        'á' | 'à' | 'â' | 'ã' | 'ä' | 'å' | 'Á' | 'À' | 'Â' | 'Ã' | 'Ä' | 'Å' => "a",
        'é' | 'è' | 'ê' | 'ë' | 'É' | 'È' | 'Ê' | 'Ë' => "e",
        'í' | 'ì' | 'î' | 'ï' | 'Í' | 'Ì' | 'Î' | 'Ï' => "i",
        'ó' | 'ò' | 'ô' | 'õ' | 'ö' | 'Ó' | 'Ò' | 'Ô' | 'Õ' | 'Ö' => "o",
        'ú' | 'ù' | 'û' | 'ü' | 'Ú' | 'Ù' | 'Û' | 'Ü' => "u",
        'ç' | 'Ç' => "c",
        'ñ' | 'Ñ' => "n",
        'ß' => "ss",
        'æ' | 'Æ' => "ae",
        'ø' | 'Ø' => "o",
        _ => return None,
    })
}

/// "Análise de Trilha: milho (2024)" → "analise_de_trilha_milho_2024" (minúsculas, ASCII, `_`,
/// cortado em `max` caracteres no limite de uma palavra).
pub fn slugify(s: &str, max: usize) -> String {
    let mut flat = String::with_capacity(s.len());
    for c in s.chars() {
        if let Some(f) = fold(c) {
            flat.push_str(f);
        } else if c.is_ascii_alphanumeric() {
            flat.push(c.to_ascii_lowercase());
        } else {
            flat.push(' ');
        }
    }
    let mut out = String::new();
    for w in flat.split_whitespace() {
        let extra = if out.is_empty() { w.len() } else { w.len() + 1 };
        if !out.is_empty() && out.len() + extra > max {
            break;
        }
        if !out.is_empty() {
            out.push('_');
        }
        out.push_str(&w[..w.len().min(max)]);
    }
    out
}

fn push_part(parts: &mut Vec<String>, val: Option<String>) {
    if let Some(v) = val {
        let trimmed = v.trim();
        if trimmed.is_empty() {
            return;
        }
        let lower = trimmed.to_lowercase();
        // Não adiciona se for idêntico ou se já estiver contido em alguma parte existente
        if !parts.iter().any(|p| {
            let p_lower = p.to_lowercase();
            p_lower == lower || (lower.len() >= 6 && p_lower.contains(&lower))
        }) {
            parts.push(trimmed.to_string());
        }
    }
}

/// Nome-base do comprovante a partir do registro (sem prefixo numérico nem extensão).
/// Concatena de forma rica os campos mais descritivos para cada categoria (instituição, vínculo, cargo, título, descrição, orientando, etc.).
pub fn record_base_name(category: &str, rec: &serde_json::Value) -> Option<String> {
    let g = |k: &str| {
        rec.get(k)
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from)
    };
    let ano = rec.get("ano").and_then(|v| {
        v.as_i64()
            .or_else(|| v.as_str().and_then(|s| s.trim().parse().ok()))
    });

    let mut parts = Vec::new();

    match category {
        "orientacoes" | "bancas" => {
            push_part(&mut parts, g("aluno"));
            push_part(&mut parts, g("titulo").or_else(|| g("descricao")));
            if parts.is_empty() {
                push_part(&mut parts, g("tipo"));
            }
        }
        "disciplinas" => {
            push_part(&mut parts, g("curso"));
            push_part(&mut parts, g("disciplina"));
            if let Some(y) = ano {
                parts.push(y.to_string());
            }
        }
        "producoes" => {
            push_part(&mut parts, g("titulo"));
            push_part(&mut parts, g("journal"));
            if parts.is_empty() {
                push_part(&mut parts, g("tipo"));
            }
        }
        "formacao" => {
            push_part(&mut parts, g("tipo"));
            push_part(&mut parts, g("curso"));
            push_part(&mut parts, g("instituicao"));
            push_part(&mut parts, g("descricao"));
        }
        "eventos" => {
            push_part(&mut parts, g("tipo"));
            push_part(&mut parts, g("descricao").or_else(|| g("titulo")));
        }
        "patentes" => {
            push_part(&mut parts, g("tipo"));
            push_part(&mut parts, g("descricao").or_else(|| g("titulo")));
        }
        "projetos" => {
            push_part(&mut parts, g("instituicao").or_else(|| g("orgao")));
            push_part(&mut parts, g("titulo").or_else(|| g("descricao")));
            if parts.is_empty() {
                push_part(&mut parts, g("tipo"));
            }
        }
        "inovacao" => {
            push_part(&mut parts, g("instituicao"));
            push_part(&mut parts, g("titulo"));
            push_part(&mut parts, g("descricao"));
            if parts.is_empty() {
                push_part(&mut parts, g("tipo"));
            }
        }
        "educacao_popularizacao" => {
            push_part(&mut parts, g("instituicao"));
            push_part(&mut parts, g("titulo"));
            push_part(&mut parts, g("descricao"));
            if parts.is_empty() {
                push_part(&mut parts, g("tipo"));
            }
        }
        "dadosgerais" => {
            push_part(&mut parts, g("tipo"));
            push_part(&mut parts, g("instituicao"));
            push_part(&mut parts, g("descricao"));
        }
        _ => {
            // "atuacao", "encargos" e categorias customizadas
            push_part(&mut parts, g("instituicao"));
            push_part(
                &mut parts,
                g("enquadramento")
                    .or_else(|| g("vinculo"))
                    .or_else(|| g("cargo")),
            );
            push_part(&mut parts, g("descricao").or_else(|| g("titulo")));
            if parts.is_empty() {
                push_part(&mut parts, g("tipo"));
            }
        }
    }

    if parts.is_empty() {
        return None;
    }

    let text = parts.join(" ");
    let s = slugify(&text, 80);
    (s.len() >= 3).then_some(s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;

    #[test]
    fn test_strip_existing_prefix() {
        assert_eq!(strip_existing_prefix("001_relatorio.pdf"), "relatorio.pdf");
        assert_eq!(strip_existing_prefix("042_tese.docx"), "tese.docx");
        assert_eq!(strip_existing_prefix("relatorio.pdf"), "relatorio.pdf");
        assert_eq!(
            strip_existing_prefix("01_relatorio.pdf"),
            "01_relatorio.pdf"
        );
        assert_eq!(strip_existing_prefix("1000_relatorio.pdf"), "relatorio.pdf");
    }

    #[test]
    fn test_sanitize_windows_filename() {
        assert_eq!(
            sanitize_windows_filename("meu_arquivo . ...pdf"),
            "meu_arquivo.pdf"
        );
        assert_eq!(
            sanitize_windows_filename("Relatório: Análise/Projeto *2025*?<test>|final.pdf"),
            "Relatório_ Análise_Projeto _2025___test__final.pdf"
        );
        assert_eq!(sanitize_windows_filename("   "), "arquivo");
        assert_eq!(sanitize_windows_filename(""), "arquivo");
        assert_eq!(sanitize_windows_filename("..."), "arquivo");
        assert_eq!(
            sanitize_windows_filename("arquivo.tar.gz"),
            "arquivo.tar.gz"
        );
        assert_eq!(
            sanitize_windows_filename("dissertação_avaliação.pdf"),
            "dissertação_avaliação.pdf"
        );
    }

    #[test]
    fn slugs_are_safe() {
        assert_eq!(
            slugify("Análise de Trilha: milho (2024)", 60),
            "analise_de_trilha_milho_2024"
        );
        assert_eq!(
            slugify(
                "MGIDI: toward an effective multivariate selection in biological experiments",
                30
            ),
            "mgidi_toward_an_effective"
        );
        let rec = serde_json::json!({"aluno": "João da Silva", "titulo": "Seleção genômica"});
        assert_eq!(
            record_base_name("bancas", &rec).as_deref(),
            Some("joao_da_silva_selecao_genomica")
        );
        let rec = serde_json::json!({"disciplina": "Genética", "ano": 2024});
        assert_eq!(
            record_base_name("disciplinas", &rec).as_deref(),
            Some("genetica_2024")
        );
        let rec = serde_json::json!({
            "instituicao": "UFSC",
            "enquadramento": "Supervisão de Laboratório",
            "descricao": "Supervisão do Laboratório de Experimentação"
        });
        assert_eq!(
            record_base_name("atuacao", &rec).as_deref(),
            Some("ufsc_supervisao_de_laboratorio_supervisao_do_laboratorio_de_experimentacao")
        );
    }

    #[test]
    fn test_calculate_next_filename_empty_and_populated() {
        let temp_dir = std::env::temp_dir().join("lattes_test_naming");
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();

        // Empty folder
        let next = calculate_next_filename(&temp_dir, "documento.pdf").unwrap();
        assert_eq!(next, "001_documento.pdf");

        // Add 001_
        File::create(temp_dir.join("001_documento.pdf")).unwrap();
        File::create(temp_dir.join("005_artigo.pdf")).unwrap();
        File::create(temp_dir.join("008_comprovante.pdf")).unwrap();

        let next2 = calculate_next_filename(&temp_dir, "novo.pdf").unwrap();
        assert_eq!(next2, "009_novo.pdf");

        // Existing prefix in incoming file
        let next3 = calculate_next_filename(&temp_dir, "005_artigo.pdf").unwrap();
        assert_eq!(next3, "009_artigo.pdf");

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
