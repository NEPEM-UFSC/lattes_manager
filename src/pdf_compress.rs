//! Compressão real de PDFs:
//! 1) Se Ghostscript estiver instalado no sistema, usa `-dPDFSETTINGS=/ebook`.
//! 2) Caso contrário (padrão embutido em Rust puro via `lopdf` + `image`),
//!    recomprime imagens embutidas (`DCTDecode` e `FlateDecode` RGB/Gray > 1350 px ou pesadas)
//!    para JPEG (~150 DPI, qualidade 68%), remove metadados/objetos órfãos e aplica `compress()`.
//! Mantém todo o texto 100% vetorial e pesquisável.

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, GrayImage, ImageFormat, RgbImage};
use lopdf::{Document, Object};
use std::io::Cursor;

const MAX_IMG_DIM: u32 = 1350;
const JPEG_QUALITY: u8 = 68;

fn obj_i64(obj: Option<&Object>) -> Option<i64> {
    match obj {
        Some(Object::Integer(n)) => Some(*n),
        _ => None,
    }
}

fn is_name(obj: Option<&Object>, name: &[u8]) -> bool {
    match obj {
        Some(Object::Name(n)) => n.as_slice() == name,
        _ => false,
    }
}

fn filter_is(obj: Option<&Object>, name: &[u8]) -> bool {
    match obj {
        Some(Object::Name(n)) => n.as_slice() == name,
        Some(Object::Array(arr)) if arr.len() == 1 => is_name(arr.first(), name),
        _ => false,
    }
}

fn encode_jpeg(img: &DynamicImage) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let mut enc = JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY);
    enc.encode_image(img).ok()?;
    Some(out)
}

fn downscale_if_needed(img: DynamicImage) -> DynamicImage {
    let w = img.width();
    let h = img.height();
    if w > MAX_IMG_DIM || h > MAX_IMG_DIM {
        img.resize(MAX_IMG_DIM, MAX_IMG_DIM, FilterType::Triangle)
    } else {
        img
    }
}

fn compress_via_lopdf(bytes: &[u8]) -> Option<Vec<u8>> {
    let mut doc = Document::load_mem(bytes).ok()?;

    // Remove metadados pesados da raiz se existirem
    if let Ok(cat) = doc.catalog_mut() {
        cat.remove(b"Metadata");
        cat.remove(b"PieceInfo");
        cat.remove(b"StructTreeRoot");
    }

    let ids: Vec<_> = doc.objects.keys().copied().collect();
    for id in ids {
        let Some(Object::Stream(stream)) = doc.objects.get_mut(&id) else {
            continue;
        };
        if !is_name(stream.dict.get(b"Subtype").ok(), b"Image") {
            continue;
        }
        // Não mexe em máscaras ou imagens com canal alfa separado
        if stream.dict.has(b"SMask") || stream.dict.has(b"Mask") {
            continue;
        }
        if let Ok(Object::Boolean(true)) = stream.dict.get(b"ImageMask") {
            continue;
        }

        let Some(w) = obj_i64(stream.dict.get(b"Width").ok()).and_then(|v| u32::try_from(v).ok()) else {
            continue;
        };
        let Some(h) = obj_i64(stream.dict.get(b"Height").ok()).and_then(|v| u32::try_from(v).ok()) else {
            continue;
        };
        if w == 0 || h == 0 {
            continue;
        }
        let bpc = obj_i64(stream.dict.get(b"BitsPerComponent").ok()).unwrap_or(8);
        if bpc != 8 {
            continue;
        }

        let filter_obj = stream.dict.get(b"Filter").ok().cloned();
        let cs_obj = stream.dict.get(b"ColorSpace").ok().cloned();

        let is_dct = filter_is(filter_obj.as_ref(), b"DCTDecode");
        let is_flate = filter_is(filter_obj.as_ref(), b"FlateDecode");
        let is_uncompressed = filter_obj.is_none();

        if is_dct {
            // Só recomprime JPEG se for grande (> 30 KB) ou maior que MAX_IMG_DIM
            if stream.content.len() < 30_000 && w <= MAX_IMG_DIM && h <= MAX_IMG_DIM {
                continue;
            }
            let Ok(img) = image::load_from_memory_with_format(&stream.content, ImageFormat::Jpeg) else {
                continue;
            };
            let resized = downscale_if_needed(img).to_rgb8();
            let nw = resized.width();
            let nh = resized.height();
            let Some(new_jpeg) = encode_jpeg(&DynamicImage::ImageRgb8(resized)) else {
                continue;
            };
            if new_jpeg.len() + 256 < stream.content.len() {
                stream.content = new_jpeg;
                stream.dict.set(b"Width", nw as i64);
                stream.dict.set(b"Height", nh as i64);
                stream.dict.set(b"Length", stream.content.len() as i64);
                stream.dict.set(b"ColorSpace", Object::Name(b"DeviceRGB".to_vec()));
                stream.dict.set(b"BitsPerComponent", 8);
                stream.dict.remove(b"DecodeParms");
            }
        } else if is_flate || is_uncompressed {
            let channels = if is_name(cs_obj.as_ref(), b"DeviceRGB") {
                3usize
            } else if is_name(cs_obj.as_ref(), b"DeviceGray") {
                1usize
            } else {
                continue;
            };
            let raw = if is_flate {
                let Ok(d) = stream.decompressed_content() else {
                    continue;
                };
                d
            } else {
                stream.content.clone()
            };
            let expected = (w as usize).saturating_mul(h as usize).saturating_mul(channels);
            if raw.len() != expected {
                // Alguns FlateDecode usam Predictor PNG — não arrisca corromper se o tamanho não bater exato
                continue;
            }
            let dyn_img = if channels == 3 {
                let Some(rgb) = RgbImage::from_raw(w, h, raw) else { continue };
                DynamicImage::ImageRgb8(rgb)
            } else {
                let Some(gray) = GrayImage::from_raw(w, h, raw) else { continue };
                DynamicImage::ImageLuma8(gray)
            };
            let resized = downscale_if_needed(dyn_img).to_rgb8();
            let nw = resized.width();
            let nh = resized.height();
            let Some(new_jpeg) = encode_jpeg(&DynamicImage::ImageRgb8(resized)) else {
                continue;
            };
            if new_jpeg.len() + 256 < stream.content.len() {
                stream.content = new_jpeg;
                stream.dict.set(b"Filter", Object::Name(b"DCTDecode".to_vec()));
                stream.dict.set(b"Width", nw as i64);
                stream.dict.set(b"Height", nh as i64);
                stream.dict.set(b"Length", stream.content.len() as i64);
                stream.dict.set(b"ColorSpace", Object::Name(b"DeviceRGB".to_vec()));
                stream.dict.set(b"BitsPerComponent", 8);
                stream.dict.remove(b"DecodeParms");
            }
        }
    }

    doc.prune_objects();
    doc.delete_zero_length_streams();
    doc.renumber_objects();
    doc.compress();

    let mut out = Vec::new();
    let mut cursor = Cursor::new(&mut out);
    doc.save_to(&mut cursor).ok()?;
    if out.len() > 100 && out.len() < bytes.len() {
        Some(out)
    } else {
        None
    }
}

#[cfg(target_os = "windows")]
fn compress_via_ghostscript(bytes: &[u8]) -> Option<Vec<u8>> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let tmp_dir = std::env::temp_dir().join("LattesManager");
    let _ = std::fs::create_dir_all(&tmp_dir);
    let stamp = chrono::Local::now().format("%Y%m%d%H%M%S%3f").to_string();
    let in_path = tmp_dir.join(format!("in_{}.pdf", stamp));
    let out_path = tmp_dir.join(format!("out_{}.pdf", stamp));
    std::fs::write(&in_path, bytes).ok()?;

    let mut result = None;
    for bin in ["gswin64c.exe", "gswin32c.exe", "gs"] {
        let status = std::process::Command::new(bin)
            .creation_flags(CREATE_NO_WINDOW)
            .args([
                "-sDEVICE=pdfwrite",
                "-dCompatibilityLevel=1.4",
                "-dPDFSETTINGS=/ebook",
                "-dNOPAUSE",
                "-dQUIET",
                "-dBATCH",
                &format!("-sOutputFile={}", out_path.display()),
                &in_path.to_string_lossy(),
            ])
            .status();
        if let Ok(st) = status {
            if st.success() {
                if let Ok(out_bytes) = std::fs::read(&out_path) {
                    if out_bytes.len() > 100 && out_bytes.len() < bytes.len() {
                        result = Some(out_bytes);
                    }
                }
                break;
            }
        }
    }
    let _ = std::fs::remove_file(&in_path);
    let _ = std::fs::remove_file(&out_path);
    result
}

#[cfg(not(target_os = "windows"))]
fn compress_via_ghostscript(_bytes: &[u8]) -> Option<Vec<u8>> {
    None
}

/// Comprime os bytes de um PDF mantendo o texto pesquisável e devolvendo a versão menor.
pub fn compress_pdf_bytes(bytes: Vec<u8>) -> Vec<u8> {
    if let Some(gs) = compress_via_ghostscript(&bytes) {
        return gs;
    }
    if let Some(lo) = compress_via_lopdf(&bytes) {
        return lo;
    }
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{dictionary, Stream};

    #[test]
    fn compresses_heavy_rgb_image_inside_pdf() {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let page_id = doc.new_object_id();

        // Imagem RGB 1600x1600 (~7.6 MB brutos)
        let w = 1600u32;
        let h = 1600u32;
        let mut raw = vec![0u8; (w * h * 3) as usize];
        for (i, b) in raw.iter_mut().enumerate() {
            *b = ((i * 37) % 251) as u8;
        }
        let img_stream = Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => w as i64,
                "Height" => h as i64,
                "ColorSpace" => "DeviceRGB",
                "BitsPerComponent" => 8,
            },
            raw,
        );
        let img_id = doc.add_object(img_stream);

        let content = Stream::new(dictionary! {}, b"q 500 0 0 500 50 200 cm /Im0 Do Q".to_vec());
        let content_id = doc.add_object(content);
        let resources_id = doc.add_object(dictionary! {
            "XObject" => dictionary! { "Im0" => img_id },
        });
        doc.objects.insert(
            page_id,
            Object::Dictionary(dictionary! {
                "Type" => "Page",
                "Parent" => pages_id,
                "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
                "Contents" => content_id,
                "Resources" => resources_id,
            }),
        );
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => vec![page_id.into()],
                "Count" => 1,
            }),
        );
        let cat_id = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        doc.trailer.set("Root", cat_id);

        let mut original = Vec::new();
        doc.save_to(&mut original).unwrap();
        let compressed = compress_pdf_bytes(original.clone());
        assert!(
            compressed.len() < original.len() / 3,
            "Esperava redução significativa: {} -> {}",
            original.len(),
            compressed.len()
        );
    }
}
