//! Compressão real de PDFs:
//! 1) Se Ghostscript estiver instalado no sistema (PATH ou C:\Program Files\gs), usa `-dPDFSETTINGS=/ebook`.
//! 2) Caso contrário (motor próprio em Rust puro via `lopdf` + `image` multi-thread),
//!    recomprime imagens embutidas (DCTDecode, FlateDecode com/sem Predictor PNG, DeviceRGB, DeviceGray, DeviceCMYK e ICCBased)
//!    para JPEG otimizado (~100-130 DPI, qualidade 55%), mantendo texto e vetores 100% pesquisáveis.

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, GrayImage, ImageFormat, RgbImage};
use lopdf::{Document, Object};
use std::io::Cursor;

const MAX_IMG_DIM: u32 = 920;
const JPEG_QUALITY: u8 = 50;

fn obj_i64(obj: Option<&Object>) -> Option<i64> {
    match obj {
        Some(Object::Integer(n)) => Some(*n),
        _ => None,
    }
}

fn resolve_int(doc: &Document, obj: Option<&Object>) -> Option<i64> {
    match obj {
        Some(Object::Integer(n)) => Some(*n),
        Some(Object::Reference(id)) => match doc.objects.get(id)? {
            Object::Integer(n) => Some(*n),
            _ => None,
        },
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

/// Determina o número de canais de cor de uma imagem a partir de ColorSpace (DeviceRGB, DeviceGray, DeviceCMYK, ICCBased, CalRGB).
fn resolve_color_channels(doc: &Document, cs_obj: Option<&Object>) -> Option<usize> {
    let obj = match cs_obj {
        Some(Object::Reference(id)) => doc.objects.get(id)?,
        Some(o) => o,
        None => return None,
    };
    match obj {
        Object::Name(n) => match n.as_slice() {
            b"DeviceRGB" => Some(3),
            b"DeviceGray" => Some(1),
            b"DeviceCMYK" => Some(4),
            _ => None,
        },
        Object::Array(arr) => {
            let first = arr.first()?;
            if is_name(Some(first), b"ICCBased") {
                let second = arr.get(1)?;
                let stream = match second {
                    Object::Reference(id) => doc.objects.get(id)?.as_stream().ok()?,
                    Object::Stream(s) => s,
                    _ => return None,
                };
                let n = obj_i64(stream.dict.get(b"N").ok())?;
                match n {
                    1 => Some(1),
                    3 => Some(3),
                    4 => Some(4),
                    _ => None,
                }
            } else if is_name(Some(first), b"CalRGB") || is_name(Some(first), b"DeviceRGB") {
                Some(3)
            } else if is_name(Some(first), b"CalGray") || is_name(Some(first), b"DeviceGray") {
                Some(1)
            } else if is_name(Some(first), b"DeviceCMYK") {
                Some(4)
            } else {
                None
            }
        }
        _ => None,
    }
}

/// Desfaz filtros PNG (Predictor >= 10) presentes em streams FlateDecode de scanners e geradores de PDF.
fn unfilter_png(raw: &[u8], width: usize, height: usize, bpp: usize) -> Option<Vec<u8>> {
    let row_len = width.checked_mul(bpp)?;
    let stride = 1 + row_len;
    if raw.len() != stride.checked_mul(height)? {
        return None;
    }
    let mut out = vec![0u8; row_len * height];
    let mut prev_row = vec![0u8; row_len];

    for y in 0..height {
        let filter_type = raw[y * stride];
        let curr_raw = &raw[y * stride + 1..y * stride + stride];
        let curr_out_offset = y * row_len;
        let curr_out = &mut out[curr_out_offset..curr_out_offset + row_len];

        match filter_type {
            0 => {
                curr_out.copy_from_slice(curr_raw);
            }
            1 => {
                // Sub
                for x in 0..row_len {
                    let left = if x >= bpp { curr_out[x - bpp] } else { 0 };
                    curr_out[x] = curr_raw[x].wrapping_add(left);
                }
            }
            2 => {
                // Up
                for x in 0..row_len {
                    let up = prev_row[x];
                    curr_out[x] = curr_raw[x].wrapping_add(up);
                }
            }
            3 => {
                // Average
                for x in 0..row_len {
                    let left = if x >= bpp { curr_out[x - bpp] as u16 } else { 0 };
                    let up = prev_row[x] as u16;
                    let avg = ((left + up) / 2) as u8;
                    curr_out[x] = curr_raw[x].wrapping_add(avg);
                }
            }
            4 => {
                // Paeth
                for x in 0..row_len {
                    let a = if x >= bpp { curr_out[x - bpp] as i16 } else { 0 };
                    let b = prev_row[x] as i16;
                    let c = if x >= bpp { prev_row[x - bpp] as i16 } else { 0 };
                    let p = a + b - c;
                    let pa = (p - a).abs();
                    let pb = (p - b).abs();
                    let pc = (p - c).abs();
                    let pr = if pa <= pb && pa <= pc { a } else if pb <= pc { b } else { c } as u8;
                    curr_out[x] = curr_raw[x].wrapping_add(pr);
                }
            }
            _ => return None,
        }
        prev_row.copy_from_slice(curr_out);
    }
    Some(out)
}

struct ImageJob {
    id: (u32, u16),
    w: u32,
    h: u32,
    is_dct: bool,
    raw_content: Vec<u8>,
    channels: usize,
    predictor: i64,
}

struct ImageResult {
    id: (u32, u16),
    new_content: Vec<u8>,
    new_w: u32,
    new_h: u32,
}

fn compress_via_lopdf(bytes: &[u8]) -> Option<Vec<u8>> {
    let mut doc = Document::load_mem(bytes).ok()?;

    // Remove metadados pesados da raiz se existirem
    if let Ok(cat) = doc.catalog_mut() {
        cat.remove(b"Metadata");
        cat.remove(b"PieceInfo");
        cat.remove(b"StructTreeRoot");
    }

    // Coleta IDs de objetos protegidos (máscaras de transparência SMask/Mask e objetos que os referenciam)
    let mut protected_ids = std::collections::HashSet::new();
    for (&id, obj) in &doc.objects {
        let dict = match obj {
            Object::Dictionary(d) => Some(d),
            Object::Stream(s) => Some(&s.dict),
            _ => None,
        };
        if let Some(d) = dict {
            if let Ok(Object::Reference(ref_id)) = d.get(b"SMask") {
                protected_ids.insert(*ref_id);
                protected_ids.insert(id);
            }
            if let Ok(Object::Reference(ref_id)) = d.get(b"Mask") {
                protected_ids.insert(*ref_id);
                protected_ids.insert(id);
            }
        }
    }

    let mut jobs = Vec::new();
    let ids: Vec<_> = doc.objects.keys().copied().collect();

    for id in ids {
        if protected_ids.contains(&id) {
            continue;
        }

        let Some(Object::Stream(stream)) = doc.objects.get(&id) else {
            continue;
        };
        if !is_name(stream.dict.get(b"Subtype").ok(), b"Image") {
            continue;
        }
        // Não mexe em máscaras ou canais alfa separados
        if stream.dict.has(b"SMask") || stream.dict.has(b"Mask") {
            continue;
        }
        if let Ok(Object::Boolean(true)) = stream.dict.get(b"ImageMask") {
            continue;
        }

        let Some(w) = resolve_int(&doc, stream.dict.get(b"Width").ok()).and_then(|v| u32::try_from(v).ok()) else {
            continue;
        };
        let Some(h) = resolve_int(&doc, stream.dict.get(b"Height").ok()).and_then(|v| u32::try_from(v).ok()) else {
            continue;
        };
        if w == 0 || h == 0 {
            continue;
        }
        // Ícones, logos do app e ilustrações pequenas (<= 320x320 ou arquivos leves < 30KB)
        // devem ser preservados sem compressão lossy para garantir nitidez e não perder transparência
        if (w <= 320 && h <= 320) || stream.content.len() < 30_000 {
            continue;
        }
        let bpc = resolve_int(&doc, stream.dict.get(b"BitsPerComponent").ok()).unwrap_or(8);
        if bpc != 8 {
            continue;
        }

        let filter_obj = stream.dict.get(b"Filter").ok();
        let cs_obj = stream.dict.get(b"ColorSpace").ok();

        let is_dct = filter_is(filter_obj, b"DCTDecode");
        let is_flate = filter_is(filter_obj, b"FlateDecode");
        let is_uncompressed = filter_obj.is_none();

        if is_dct {
            // Recomprime se for maior que MAX_IMG_DIM ou JPEG com mais de 25 KB
            if w > MAX_IMG_DIM || h > MAX_IMG_DIM || stream.content.len() > 25_000 {
                jobs.push(ImageJob {
                    id,
                    w,
                    h,
                    is_dct: true,
                    raw_content: stream.content.clone(),
                    channels: 3,
                    predictor: 1,
                });
            }
        } else if is_flate || is_uncompressed {
            let Some(channels) = resolve_color_channels(&doc, cs_obj) else {
                continue;
            };
            if !matches!(channels, 1 | 3 | 4) {
                continue;
            }

            let predictor = stream
                .dict
                .get(b"DecodeParms")
                .ok()
                .and_then(|dp| match dp {
                    Object::Dictionary(d) => obj_i64(d.get(b"Predictor").ok()),
                    _ => None,
                })
                .unwrap_or(1);

            let raw = if is_flate {
                let Ok(d) = stream.decompressed_content() else {
                    continue;
                };
                d
            } else {
                stream.content.clone()
            };

            jobs.push(ImageJob {
                id,
                w,
                h,
                is_dct: false,
                raw_content: raw,
                channels,
                predictor,
            });
        }
    }

    if jobs.is_empty() {
        return None;
    }

    // Processamento paralelo multithread dos jobs de imagem
    let num_threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(8)
        .max(1);

    let chunk_size = (jobs.len() + num_threads - 1) / num_threads;
    let mut thread_results: Vec<Vec<ImageResult>> = Vec::new();

    std::thread::scope(|s| {
        let mut handles = Vec::new();
        for chunk in jobs.chunks(chunk_size) {
            let handle = s.spawn(move || {
                let mut res = Vec::new();
                for job in chunk {
                    if job.is_dct {
                        if let Ok(img) = image::load_from_memory_with_format(&job.raw_content, ImageFormat::Jpeg) {
                            let resized = downscale_if_needed(img).to_rgb8();
                            let nw = resized.width();
                            let nh = resized.height();
                            if let Some(new_jpeg) = encode_jpeg(&DynamicImage::ImageRgb8(resized)) {
                                if new_jpeg.len() + 512 < job.raw_content.len() {
                                    res.push(ImageResult {
                                        id: job.id,
                                        new_content: new_jpeg,
                                        new_w: nw,
                                        new_h: nh,
                                    });
                                }
                            }
                        }
                    } else {
                        let pixel_bytes = if job.predictor >= 10 {
                            unfilter_png(&job.raw_content, job.w as usize, job.h as usize, job.channels)
                        } else if job.raw_content.len() == (job.w as usize) * (job.h as usize) * job.channels {
                            Some(job.raw_content.clone())
                        } else {
                            None
                        };
                        let Some(pixels) = pixel_bytes else { continue };

                        let dyn_img = if job.channels == 3 {
                            let Some(rgb) = RgbImage::from_raw(job.w, job.h, pixels) else { continue };
                            DynamicImage::ImageRgb8(rgb)
                        } else if job.channels == 1 {
                            let Some(gray) = GrayImage::from_raw(job.w, job.h, pixels) else { continue };
                            DynamicImage::ImageLuma8(gray)
                        } else if job.channels == 4 {
                            let mut rgb_vec = Vec::with_capacity((job.w as usize) * (job.h as usize) * 3);
                            for cmyk in pixels.chunks_exact(4) {
                                let c = cmyk[0] as u32;
                                let m = cmyk[1] as u32;
                                let y = cmyk[2] as u32;
                                let k = cmyk[3] as u32;
                                let r = ((255 - c) * (255 - k) / 255) as u8;
                                let g = ((255 - m) * (255 - k) / 255) as u8;
                                let b = ((255 - y) * (255 - k) / 255) as u8;
                                rgb_vec.push(r);
                                rgb_vec.push(g);
                                rgb_vec.push(b);
                            }
                            let Some(rgb) = RgbImage::from_raw(job.w, job.h, rgb_vec) else { continue };
                            DynamicImage::ImageRgb8(rgb)
                        } else {
                            continue;
                        };

                        let resized = downscale_if_needed(dyn_img).to_rgb8();
                        let nw = resized.width();
                        let nh = resized.height();
                        if let Some(new_jpeg) = encode_jpeg(&DynamicImage::ImageRgb8(resized)) {
                            res.push(ImageResult {
                                id: job.id,
                                new_content: new_jpeg,
                                new_w: nw,
                                new_h: nh,
                            });
                        }
                    }
                }
                res
            });
            handles.push(handle);
        }
        for h in handles {
            if let Ok(r) = h.join() {
                thread_results.push(r);
            }
        }
    });

    let mut replaced_count = 0;
    for res_list in thread_results {
        for res in res_list {
            if let Some(Object::Stream(stream)) = doc.objects.get_mut(&res.id) {
                if res.new_content.len() + 256 < stream.content.len() {
                    stream.content = res.new_content;
                    stream.dict.set(b"Filter", Object::Name(b"DCTDecode".to_vec()));
                    stream.dict.set(b"Width", res.new_w as i64);
                    stream.dict.set(b"Height", res.new_h as i64);
                    stream.dict.set(b"Length", stream.content.len() as i64);
                    stream.dict.set(b"ColorSpace", Object::Name(b"DeviceRGB".to_vec()));
                    stream.dict.set(b"BitsPerComponent", 8);
                    stream.dict.remove(b"DecodeParms");
                    replaced_count += 1;
                }
            }
        }
    }

    let dedup_count = deduplicate_streams(&mut doc);

    if replaced_count == 0 && dedup_count == 0 {
        return None;
    }

    doc.prune_objects();
    doc.delete_zero_length_streams();
    doc.renumber_objects();

    let mut out = Vec::new();
    let mut cursor = Cursor::new(&mut out);
    doc.save_to(&mut cursor).ok()?;
    if out.len() > 100 && out.len() < bytes.len() {
        Some(out)
    } else {
        None
    }
}

/// Deduplica streams com o mesmo conteúdo binário (ex.: fontes e recursos repetidos em múltiplos PDFs).
fn deduplicate_streams(doc: &mut Document) -> usize {
    use std::collections::HashMap;
    let mut seen: HashMap<Vec<u8>, (u32, u16)> = HashMap::new();
    let mut replacements: HashMap<(u32, u16), (u32, u16)> = HashMap::new();

    for (&id, obj) in doc.objects.iter() {
        if let Object::Stream(s) = obj {
            if s.content.len() > 512 {
                match seen.entry(s.content.clone()) {
                    std::collections::hash_map::Entry::Occupied(e) => {
                        replacements.insert(id, *e.get());
                    }
                    std::collections::hash_map::Entry::Vacant(e) => {
                        e.insert(id);
                    }
                }
            }
        }
    }

    if replacements.is_empty() {
        return 0;
    }

    let count = replacements.len();
    for obj in doc.objects.values_mut() {
        replace_refs(obj, &replacements);
    }
    replace_refs_dict(&mut doc.trailer, &replacements);

    for stale_id in replacements.keys() {
        doc.objects.remove(stale_id);
    }
    count
}

fn replace_refs_dict(dict: &mut lopdf::Dictionary, map: &std::collections::HashMap<(u32, u16), (u32, u16)>) {
    for val in dict.iter_mut().map(|(_, v)| v) {
        replace_refs(val, map);
    }
}

fn replace_refs(obj: &mut Object, map: &std::collections::HashMap<(u32, u16), (u32, u16)>) {
    match obj {
        Object::Reference(id) => {
            if let Some(&new_id) = map.get(id) {
                *id = new_id;
            }
        }
        Object::Array(arr) => {
            for item in arr.iter_mut() {
                replace_refs(item, map);
            }
        }
        Object::Dictionary(dict) => {
            replace_refs_dict(dict, map);
        }
        Object::Stream(stream) => {
            replace_refs_dict(&mut stream.dict, map);
        }
        _ => {}
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

    let mut bins = vec![
        "gswin64c.exe".to_string(),
        "gswin32c.exe".to_string(),
        "gs".to_string(),
    ];
    for base in [r"C:\Program Files\gs", r"C:\Program Files (x86)\gs"] {
        if let Ok(entries) = std::fs::read_dir(base) {
            for entry in entries.flatten() {
                let bin64 = entry.path().join("bin").join("gswin64c.exe");
                if bin64.exists() {
                    bins.push(bin64.to_string_lossy().to_string());
                }
                let bin32 = entry.path().join("bin").join("gswin32c.exe");
                if bin32.exists() {
                    bins.push(bin32.to_string_lossy().to_string());
                }
            }
        }
    }

    let mut result = None;
    for bin in &bins {
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

    #[test]
    fn unfilter_png_correctly_reconstructs_sub_and_up() {
        let width = 2usize;
        let height = 2usize;
        let bpp = 3usize; // RGB
        // Stride = 1 + 6 = 7
        // Row 0: filter 1 (Sub)
        // Row 1: filter 2 (Up)
        let raw = vec![
            1u8, 10, 20, 30, 5, 5, 5, // row 0: pixel 0 = (10, 20, 30), pixel 1 = (15, 25, 35)
            2u8, 1, 2, 3, 4, 5, 6,    // row 1: pixel 0 = (11, 22, 33), pixel 1 = (19, 30, 41)
        ];
        let decoded = unfilter_png(&raw, width, height, bpp).expect("unfilter deve funcionar");
        assert_eq!(decoded.len(), 12);
        assert_eq!(&decoded[0..6], &[10, 20, 30, 15, 25, 35]);
        assert_eq!(&decoded[6..12], &[11, 22, 33, 19, 30, 41]);
    }

    #[test]
    fn preserves_smask_transparency_and_small_logo() {
        let mut doc = Document::with_version("1.7");
        let pages_id = doc.new_object_id();
        let page_id = doc.new_object_id();

        // Máscara DeviceGray (alfa)
        let mask_stream = Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => 120,
                "Height" => 120,
                "ColorSpace" => "DeviceGray",
                "BitsPerComponent" => 8,
            },
            vec![255u8; 120 * 120],
        );
        let mask_id = doc.add_object(mask_stream);

        // Logo PNG transparente (RGB + SMask)
        let logo_stream = Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => 120,
                "Height" => 120,
                "ColorSpace" => "DeviceRGB",
                "BitsPerComponent" => 8,
                "SMask" => mask_id,
            },
            vec![128u8; 120 * 120 * 3],
        );
        let _logo_id = doc.add_object(logo_stream);

        doc.objects.insert(
            page_id,
            Object::Dictionary(dictionary! {
                "Type" => "Page",
                "Parent" => pages_id,
                "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
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

        // Comprime: nem o logo nem a SMask devem ser destruídos ou convertidos para DCTDecode
        let out = compress_via_lopdf(&original);
        if let Some(res) = out {
            let res_doc = Document::load_mem(&res).unwrap();
            let mask = res_doc.objects.get(&mask_id).unwrap().as_stream().unwrap();
            assert_eq!(
                mask.dict.get(b"ColorSpace").unwrap().as_name().unwrap(),
                b"DeviceGray",
                "A SMask DEVE continuar DeviceGray"
            );
        }
    }
}
