//! Compressão avançada e ultrarrápida de PDFs:
//! 1) Se Ghostscript estiver instalado no sistema (PATH ou C:\Program Files\gs), usa `-dPDFSETTINGS=/ebook`.
//! 2) Motor nativo em Rust puro (`lopdf` + `image` multi-thread):
//!    - Otimiza e enxuga fontes TrueType/OpenType embutidas (`FontFile2`): remove tabelas pesadas desnecessárias
//!      para renderização PDF (`GPOS`, `GSUB`, `COLR`, `CPAL`, `hdmx`, `VDMX`, `DSIG`, `name`, `prep`, `fpgm`, `cvt `),
//!      remove instruções de hinting por glifo em `glyf` e zera métricas `hmtx` de glifos vazios.
//!    - Funde (merge) subconjuntos compatíveis da mesma família de fontes (`Calibri`, `Times New Roman`, `Arial`, etc.)
//!      em um único stream compartilhado sem conflitos de GID.
//!    - Remove recursos (`/Font`, `/XObject`) não referenciados nos streams de conteúdo das páginas incorporadas.
//!    - Recomprime imagens embutidas (`DCTDecode`, `[/FlateDecode /DCTDecode]`, `FlateDecode` com/sem Predictor PNG,
//!      `DeviceRGB`, `DeviceGray`, `DeviceCMYK` e `ICCBased`, incluindo imagens grandes com `SMask` preservando a transparência)
//!      em paralelo (multi-thread), mantendo logos/ícones pequenos (`<= 320x320`) intactos.
//!    - Remove metadados XMP/XML (`/Metadata`), perfis ICC gigantes e objetos órfãos em tempo linear O(N).

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, GrayImage, ImageFormat, RgbImage};
use lopdf::{dictionary, Document, Object, ObjectId, Stream};
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::Cursor;

const MAX_IMG_DIM: u32 = 860;
const JPEG_QUALITY: u8 = 48;

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

fn resolve_dict<'a>(doc: &'a Document, obj: Option<&'a Object>) -> Option<&'a lopdf::Dictionary> {
    match obj {
        Some(Object::Dictionary(d)) => Some(d),
        Some(Object::Reference(id)) => doc.objects.get(id)?.as_dict().ok(),
        Some(Object::Array(arr)) => {
            for item in arr {
                if let Some(d) = resolve_dict(doc, Some(item)) {
                    return Some(d);
                }
            }
            None
        }
        _ => None,
    }
}

fn is_name(obj: Option<&Object>, name: &[u8]) -> bool {
    match obj {
        Some(Object::Name(n)) => n.as_slice() == name,
        _ => false,
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum StreamFilterKind {
    Dct,
    FlateDct,
    Flate,
    Uncompressed,
    Unsupported,
}

fn classify_filter(doc: &Document, obj: Option<&Object>) -> StreamFilterKind {
    let resolved = match obj {
        Some(Object::Reference(id)) => doc.objects.get(id),
        other => other,
    };
    match resolved {
        None => StreamFilterKind::Uncompressed,
        Some(Object::Name(n)) => match n.as_slice() {
            b"DCTDecode" | b"DCT" => StreamFilterKind::Dct,
            b"FlateDecode" | b"Fl" => StreamFilterKind::Flate,
            _ => StreamFilterKind::Unsupported,
        },
        Some(Object::Array(arr)) => match arr.len() {
            0 => StreamFilterKind::Uncompressed,
            1 => classify_filter(doc, arr.first()),
            2 => {
                let f0 = classify_filter(doc, arr.first());
                let f1 = classify_filter(doc, arr.get(1));
                if f0 == StreamFilterKind::Flate && f1 == StreamFilterKind::Dct {
                    StreamFilterKind::FlateDct
                } else {
                    StreamFilterKind::Unsupported
                }
            }
            _ => StreamFilterKind::Unsupported,
        },
        _ => StreamFilterKind::Unsupported,
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
        // Para imagens muito grandes (ex. scans 2480x3508), Nearest/Triangle rápido
        let filter = if w > MAX_IMG_DIM * 2 || h > MAX_IMG_DIM * 2 {
            FilterType::Nearest
        } else {
            FilterType::Triangle
        };
        img.resize(MAX_IMG_DIM, MAX_IMG_DIM, filter)
    } else {
        img
    }
}

fn raw_flate_decompress(content: &[u8]) -> Option<Vec<u8>> {
    let tmp = Stream::new(dictionary! { "Filter" => "FlateDecode" }, content.to_vec());
    tmp.decompressed_content().ok()
}

/// Extrai mapeamentos Unicode BMP (char_code -> gid) das subtables Format 4 de uma tabela `cmap` TrueType.
fn parse_cmap_mappings(cmap: &[u8]) -> std::collections::BTreeMap<u16, u16> {
    let mut map = std::collections::BTreeMap::new();
    if cmap.len() < 4 {
        return map;
    }
    let num_sub = u16::from_be_bytes([cmap[2], cmap[3]]) as usize;
    if cmap.len() < 4 + num_sub * 8 {
        return map;
    }
    for i in 0..num_sub {
        let rec_off = 4 + i * 8;
        let platform_id = u16::from_be_bytes([cmap[rec_off], cmap[rec_off + 1]]);
        let sub_off = u32::from_be_bytes([
            cmap[rec_off + 4],
            cmap[rec_off + 5],
            cmap[rec_off + 6],
            cmap[rec_off + 7],
        ]) as usize;
        if sub_off + 14 > cmap.len() {
            continue;
        }
        let fmt = u16::from_be_bytes([cmap[sub_off], cmap[sub_off + 1]]);
        // Prioriza Format 4 (Unicode / Windows / Symbol) para evitar conflito com Format 0 (Mac 1-byte)
        if fmt == 4 && (platform_id == 3 || platform_id == 0 || map.is_empty()) {
            let seg_count_x2 = u16::from_be_bytes([cmap[sub_off + 6], cmap[sub_off + 7]]) as usize;
            let seg_count = seg_count_x2 / 2;
            let end_pos = sub_off + 14;
            let start_pos = end_pos + seg_count_x2 + 2;
            let delta_pos = start_pos + seg_count_x2;
            let range_pos = delta_pos + seg_count_x2;
            if range_pos + seg_count_x2 > cmap.len() {
                continue;
            }
            for s in 0..seg_count {
                let end_c = u16::from_be_bytes([cmap[end_pos + s * 2], cmap[end_pos + s * 2 + 1]]);
                let start_c =
                    u16::from_be_bytes([cmap[start_pos + s * 2], cmap[start_pos + s * 2 + 1]]);
                let delta =
                    i16::from_be_bytes([cmap[delta_pos + s * 2], cmap[delta_pos + s * 2 + 1]]);
                let roff =
                    u16::from_be_bytes([cmap[range_pos + s * 2], cmap[range_pos + s * 2 + 1]])
                        as usize;
                if start_c == 0xFFFF && end_c == 0xFFFF {
                    break;
                }
                if start_c > end_c {
                    break;
                }
                for c in start_c..=end_c {
                    let gid = if roff == 0 {
                        (c as i32 + delta as i32) as u16
                    } else {
                        let idx_pos = range_pos + s * 2 + roff + ((c - start_c) as usize) * 2;
                        if idx_pos + 2 > cmap.len() {
                            0
                        } else {
                            let v = u16::from_be_bytes([cmap[idx_pos], cmap[idx_pos + 1]]);
                            if v == 0 {
                                0
                            } else {
                                (v as i32 + delta as i32) as u16
                            }
                        }
                    };
                    if gid != 0 {
                        map.insert(c, gid);
                    }
                }
            }
        }
    }
    map
}

/// Constrói uma tabela `cmap` Format 4 compacta com subtables (1,0), (3,0) e (3,1) apontando para o mesmo bloco.
fn build_format4_cmap(map: &std::collections::BTreeMap<u16, u16>) -> Vec<u8> {
    let mut segs: Vec<(u16, u16, i16)> = Vec::new();
    for (&c, &g) in map {
        if c == 0xFFFF || g == 0 {
            continue;
        }
        let delta = (g as i32 - c as i32) as i16;
        if let Some(last) = segs.last_mut() {
            if last.1 + 1 == c && last.2 == delta {
                last.1 = c;
                continue;
            }
        }
        segs.push((c, c, delta));
    }
    segs.push((0xFFFF, 0xFFFF, 1));

    let seg_count = segs.len();
    let seg_count_x2 = (seg_count * 2) as u16;
    let mut max_pow2 = 1usize;
    let mut entry_sel = 0u16;
    while (max_pow2 << 1) <= seg_count {
        max_pow2 <<= 1;
        entry_sel += 1;
    }
    let search_range = (max_pow2 * 2) as u16;
    let range_shift = seg_count_x2 - search_range;

    let sub_len = (16 + seg_count * 8) as u16;
    let mut sub = Vec::with_capacity(sub_len as usize);
    sub.extend_from_slice(&4u16.to_be_bytes()); // format 4
    sub.extend_from_slice(&sub_len.to_be_bytes());
    sub.extend_from_slice(&0u16.to_be_bytes()); // language
    sub.extend_from_slice(&seg_count_x2.to_be_bytes());
    sub.extend_from_slice(&search_range.to_be_bytes());
    sub.extend_from_slice(&entry_sel.to_be_bytes());
    sub.extend_from_slice(&range_shift.to_be_bytes());
    for &(_, end_c, _) in &segs {
        sub.extend_from_slice(&end_c.to_be_bytes());
    }
    sub.extend_from_slice(&0u16.to_be_bytes()); // reservedPad
    for &(start_c, _, _) in &segs {
        sub.extend_from_slice(&start_c.to_be_bytes());
    }
    for &(_, _, delta) in &segs {
        sub.extend_from_slice(&delta.to_be_bytes());
    }
    for _ in 0..seg_count {
        sub.extend_from_slice(&0u16.to_be_bytes()); // idRangeOffset = 0
    }

    // Cabeçalho cmap com 2 registros: (1, 0) Mac e (3, 1) Windows Unicode
    let sub_offset = (4 + 2 * 8) as u32;
    let mut out = Vec::with_capacity(sub_offset as usize + sub.len());
    out.extend_from_slice(&0u16.to_be_bytes()); // version
    out.extend_from_slice(&2u16.to_be_bytes()); // numTables = 2
                                                // (1, 0)
    out.extend_from_slice(&1u16.to_be_bytes());
    out.extend_from_slice(&0u16.to_be_bytes());
    out.extend_from_slice(&sub_offset.to_be_bytes());
    // (3, 1)
    out.extend_from_slice(&3u16.to_be_bytes());
    out.extend_from_slice(&1u16.to_be_bytes());
    out.extend_from_slice(&sub_offset.to_be_bytes());
    out.extend_from_slice(&sub);
    out
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
                for x in 0..row_len {
                    let left = if x >= bpp { curr_out[x - bpp] } else { 0 };
                    curr_out[x] = curr_raw[x].wrapping_add(left);
                }
            }
            2 => {
                for x in 0..row_len {
                    let up = prev_row[x];
                    curr_out[x] = curr_raw[x].wrapping_add(up);
                }
            }
            3 => {
                for x in 0..row_len {
                    let left = if x >= bpp {
                        curr_out[x - bpp] as u16
                    } else {
                        0
                    };
                    let up = prev_row[x] as u16;
                    let avg = ((left + up) / 2) as u8;
                    curr_out[x] = curr_raw[x].wrapping_add(avg);
                }
            }
            4 => {
                for x in 0..row_len {
                    let a = if x >= bpp {
                        curr_out[x - bpp] as i16
                    } else {
                        0
                    };
                    let b = prev_row[x] as i16;
                    let c = if x >= bpp {
                        prev_row[x - bpp] as i16
                    } else {
                        0
                    };
                    let p = a + b - c;
                    let pa = (p - a).abs();
                    let pb = (p - b).abs();
                    let pc = (p - c).abs();
                    let pr = if pa <= pb && pa <= pc {
                        a
                    } else if pb <= pc {
                        b
                    } else {
                        c
                    } as u8;
                    curr_out[x] = curr_raw[x].wrapping_add(pr);
                }
            }
            _ => return None,
        }
        prev_row.copy_from_slice(curr_out);
    }
    Some(out)
}

/// Remove instruções de hinting de glifos simples e compostos em `glyf`, reconstruindo `loca`.
fn strip_glyf_instructions(
    glyf: &[u8],
    loca: &[u8],
    is_long_loca: bool,
    num_glyphs: usize,
) -> Option<(Vec<u8>, Vec<u8>)> {
    let mut offsets = Vec::with_capacity(num_glyphs + 1);
    if is_long_loca {
        if loca.len() < (num_glyphs + 1) * 4 {
            return None;
        }
        for i in 0..=num_glyphs {
            let o = u32::from_be_bytes([
                loca[i * 4],
                loca[i * 4 + 1],
                loca[i * 4 + 2],
                loca[i * 4 + 3],
            ]) as usize;
            offsets.push(o);
        }
    } else {
        if loca.len() < (num_glyphs + 1) * 2 {
            return None;
        }
        for i in 0..=num_glyphs {
            let o = (u16::from_be_bytes([loca[i * 2], loca[i * 2 + 1]]) as usize) * 2;
            offsets.push(o);
        }
    }

    let mut new_glyf = Vec::with_capacity(glyf.len());
    let mut new_offsets = Vec::with_capacity(num_glyphs + 1);

    for g in 0..num_glyphs {
        new_offsets.push(new_glyf.len());
        let start = offsets[g];
        let end = offsets[g + 1];
        if start >= end || end > glyf.len() {
            continue;
        }
        let g_bytes = &glyf[start..end];
        if g_bytes.len() < 10 {
            new_glyf.extend_from_slice(g_bytes);
        } else {
            let num_contours = i16::from_be_bytes([g_bytes[0], g_bytes[1]]);
            if num_contours > 0 {
                let nc = num_contours as usize;
                let ins_len_pos = 10 + nc * 2;
                if ins_len_pos + 2 <= g_bytes.len() {
                    let ins_len =
                        u16::from_be_bytes([g_bytes[ins_len_pos], g_bytes[ins_len_pos + 1]])
                            as usize;
                    let flags_pos = ins_len_pos + 2 + ins_len;
                    if ins_len > 0 && flags_pos <= g_bytes.len() {
                        new_glyf.extend_from_slice(&g_bytes[..ins_len_pos]);
                        new_glyf.extend_from_slice(&0u16.to_be_bytes());
                        new_glyf.extend_from_slice(&g_bytes[flags_pos..]);
                    } else {
                        new_glyf.extend_from_slice(g_bytes);
                    }
                } else {
                    new_glyf.extend_from_slice(g_bytes);
                }
            } else if num_contours < 0 {
                // Glifo composto: limpa flag WE_HAVE_INSTRUCTIONS (0x0100) e omite instruções finais
                let mut pos = 10usize;
                let mut comp_end = g_bytes.len();
                let mut had_instr = false;
                let mut patched = g_bytes.to_vec();
                loop {
                    if pos + 4 > patched.len() {
                        break;
                    }
                    let mut flags = u16::from_be_bytes([patched[pos], patched[pos + 1]]);
                    if (flags & 0x0100) != 0 {
                        had_instr = true;
                        flags &= !0x0100;
                        patched[pos] = (flags >> 8) as u8;
                        patched[pos + 1] = (flags & 0xff) as u8;
                    }
                    pos += 4; // flags + glyphIndex
                    pos += if (flags & 0x0001) != 0 { 4 } else { 2 }; // args
                    if (flags & 0x0008) != 0 {
                        pos += 2;
                    } else if (flags & 0x0040) != 0 {
                        pos += 4;
                    } else if (flags & 0x0080) != 0 {
                        pos += 8;
                    }
                    if (flags & 0x0020) == 0 {
                        if had_instr && pos <= patched.len() {
                            comp_end = pos;
                        }
                        break;
                    }
                }
                new_glyf.extend_from_slice(&patched[..comp_end]);
            } else {
                new_glyf.extend_from_slice(g_bytes);
            }
        }
        while new_glyf.len() % 2 != 0 {
            new_glyf.push(0);
        }
    }
    new_offsets.push(new_glyf.len());

    let mut new_loca = Vec::with_capacity(loca.len());
    if is_long_loca {
        for &o in &new_offsets {
            new_loca.extend_from_slice(&(o as u32).to_be_bytes());
        }
    } else {
        for &o in &new_offsets {
            new_loca.extend_from_slice(&((o / 2) as u16).to_be_bytes());
        }
    }

    Some((new_glyf, new_loca))
}

fn pack_sfnt_tables(sfnt_version: &[u8], mut kept: Vec<([u8; 4], Vec<u8>)>) -> Vec<u8> {
    kept.sort_by_key(|x| x.0);
    let new_num = kept.len() as u16;
    let mut max_pow2 = 1u16;
    let mut entry_selector = 0u16;
    while (max_pow2 << 1) <= new_num {
        max_pow2 <<= 1;
        entry_selector += 1;
    }
    let search_range = max_pow2 * 16;
    let range_shift = new_num * 16 - search_range;

    let total_data: usize = kept.iter().map(|(_, d)| (d.len() + 3) & !3).sum();
    let dir_size = 12 + (new_num as usize) * 16;
    let mut out = Vec::with_capacity(dir_size + total_data);
    out.extend_from_slice(sfnt_version);
    out.extend_from_slice(&new_num.to_be_bytes());
    out.extend_from_slice(&search_range.to_be_bytes());
    out.extend_from_slice(&entry_selector.to_be_bytes());
    out.extend_from_slice(&range_shift.to_be_bytes());
    out.resize(dir_size, 0);

    for (i, (tag, data)) in kept.iter().enumerate() {
        let t_off = out.len() as u32;
        let t_len = data.len() as u32;
        out.extend_from_slice(data);
        while out.len() % 4 != 0 {
            out.push(0);
        }
        let mut sum = 0u32;
        for chunk in out[t_off as usize..].chunks_exact(4) {
            sum = sum.wrapping_add(u32::from_be_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
        }
        let dir_off = 12 + i * 16;
        out[dir_off..dir_off + 4].copy_from_slice(tag);
        out[dir_off + 4..dir_off + 8].copy_from_slice(&sum.to_be_bytes());
        out[dir_off + 8..dir_off + 12].copy_from_slice(&t_off.to_be_bytes());
        out[dir_off + 12..dir_off + 16].copy_from_slice(&t_len.to_be_bytes());
    }
    out
}

/// Remove tabelas não essenciais de fontes TrueType/OpenType (`GPOS`, `GSUB`, `COLR`, `hdmx`, hinting, etc.)
/// e zera métricas `hmtx` de glifos vazios para maximizar a compressão Flate.
fn optimize_sfnt_font(raw: &[u8]) -> Option<Vec<u8>> {
    if raw.len() < 12 {
        return None;
    }
    let sfnt_version = &raw[0..4];
    if sfnt_version != [0, 1, 0, 0] && sfnt_version != b"true" && sfnt_version != b"OTTO" {
        return None;
    }
    let num_tables = u16::from_be_bytes([raw[4], raw[5]]) as usize;
    if raw.len() < 12 + num_tables * 16 {
        return None;
    }

    let mut table_map: HashMap<[u8; 4], Vec<u8>> = HashMap::new();
    for i in 0..num_tables {
        let off = 12 + i * 16;
        let mut tag = [0u8; 4];
        tag.copy_from_slice(&raw[off..off + 4]);
        let keep = matches!(
            &tag,
            b"head" | b"hhea" | b"maxp" | b"loca" | b"glyf" | b"hmtx" | b"cmap" | b"OS/2" | b"CFF "
        );
        if !keep {
            continue;
        }
        let t_off =
            u32::from_be_bytes([raw[off + 8], raw[off + 9], raw[off + 10], raw[off + 11]]) as usize;
        let t_len = u32::from_be_bytes([raw[off + 12], raw[off + 13], raw[off + 14], raw[off + 15]])
            as usize;
        if t_off.checked_add(t_len)? > raw.len() {
            return None;
        }
        table_map.insert(tag, raw[t_off..t_off + t_len].to_vec());
    }

    if table_map.is_empty() {
        return None;
    }

    let is_long_loca = table_map
        .get(b"head")
        .and_then(|h| (h.len() >= 52).then(|| i16::from_be_bytes([h[50], h[51]]) != 0));
    let num_glyphs = table_map
        .get(b"maxp")
        .and_then(|m| (m.len() >= 6).then(|| u16::from_be_bytes([m[4], m[5]]) as usize));

    if let (Some(is_long), Some(ng)) = (is_long_loca, num_glyphs) {
        if let (Some(glyf), Some(loca)) = (
            table_map.get(b"glyf").cloned(),
            table_map.get(b"loca").cloned(),
        ) {
            if let Some((new_glyf, new_loca)) = strip_glyf_instructions(&glyf, &loca, is_long, ng) {
                if let Some(hmtx) = table_map.get_mut(b"hmtx") {
                    for g in 4..ng {
                        let is_empty = if is_long {
                            let o1 = u32::from_be_bytes([
                                new_loca[g * 4],
                                new_loca[g * 4 + 1],
                                new_loca[g * 4 + 2],
                                new_loca[g * 4 + 3],
                            ]);
                            let o2 = u32::from_be_bytes([
                                new_loca[(g + 1) * 4],
                                new_loca[(g + 1) * 4 + 1],
                                new_loca[(g + 1) * 4 + 2],
                                new_loca[(g + 1) * 4 + 3],
                            ]);
                            o1 == o2
                        } else {
                            let o1 = u16::from_be_bytes([new_loca[g * 2], new_loca[g * 2 + 1]]);
                            let o2 = u16::from_be_bytes([
                                new_loca[(g + 1) * 2],
                                new_loca[(g + 1) * 2 + 1],
                            ]);
                            o1 == o2
                        };
                        if is_empty && (g + 1) * 4 <= hmtx.len() {
                            hmtx[g * 4..g * 4 + 4].fill(0);
                        }
                    }
                }
                table_map.insert(*b"glyf", new_glyf);
                table_map.insert(*b"loca", new_loca);
            }
        }
    }

    let kept: Vec<([u8; 4], Vec<u8>)> = table_map.into_iter().collect();
    Some(pack_sfnt_tables(sfnt_version, kept))
}

fn normalize_font_family(raw_name: &str) -> String {
    let base = raw_name.split('+').next_back().unwrap_or(raw_name);
    let mut s = base
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect::<String>();
    if let Some(stripped) = s.strip_suffix("psmt") {
        s = stripped.to_string();
    } else if let Some(stripped) = s.strip_suffix("mt") {
        s = stripped.to_string();
    }
    s = s.replace("psbold", "bold").replace("psitalic", "italic");
    s
}

struct ParsedTtfForMerge {
    fid: ObjectId,
    num_glyphs: usize,
    is_long_loca: bool,
    glyphs: Vec<Vec<u8>>,
    hmtx: Vec<u8>,
    cmap: Vec<u8>,
    cmap_map: std::collections::BTreeMap<u16, u16>,
    head: Vec<u8>,
    hhea: Vec<u8>,
    maxp: Vec<u8>,
    os2: Option<Vec<u8>>,
}

fn parse_ttf_for_merge(fid: ObjectId, stripped: &[u8]) -> Option<ParsedTtfForMerge> {
    if stripped.len() < 12 || (stripped[0..4] != [0, 1, 0, 0] && &stripped[0..4] != b"true") {
        return None;
    }
    let num_t = u16::from_be_bytes([stripped[4], stripped[5]]) as usize;
    let mut tmap: HashMap<[u8; 4], Vec<u8>> = HashMap::new();
    for i in 0..num_t {
        let off = 12 + i * 16;
        if off + 16 > stripped.len() {
            return None;
        }
        let mut tag = [0u8; 4];
        tag.copy_from_slice(&stripped[off..off + 4]);
        let toff = u32::from_be_bytes([
            stripped[off + 8],
            stripped[off + 9],
            stripped[off + 10],
            stripped[off + 11],
        ]) as usize;
        let tlen = u32::from_be_bytes([
            stripped[off + 12],
            stripped[off + 13],
            stripped[off + 14],
            stripped[off + 15],
        ]) as usize;
        if toff.checked_add(tlen)? > stripped.len() {
            return None;
        }
        tmap.insert(tag, stripped[toff..toff + tlen].to_vec());
    }
    let head = tmap.remove(b"head")?;
    let hhea = tmap.remove(b"hhea")?;
    let maxp = tmap.remove(b"maxp")?;
    let loca = tmap.remove(b"loca")?;
    let glyf = tmap.remove(b"glyf")?;
    let hmtx = tmap.remove(b"hmtx")?;
    let cmap = tmap.remove(b"cmap")?;
    let os2 = tmap.remove(b"OS/2");

    if head.len() < 52 || maxp.len() < 6 {
        return None;
    }
    let is_long = i16::from_be_bytes([head[50], head[51]]) != 0;
    let ng = u16::from_be_bytes([maxp[4], maxp[5]]) as usize;
    if ng < 32 {
        return None;
    }

    let mut glyphs = Vec::with_capacity(ng);
    for g in 0..ng {
        let (s_off, e_off) = if is_long {
            if (g + 1) * 4 + 4 > loca.len() {
                return None;
            }
            (
                u32::from_be_bytes([
                    loca[g * 4],
                    loca[g * 4 + 1],
                    loca[g * 4 + 2],
                    loca[g * 4 + 3],
                ]) as usize,
                u32::from_be_bytes([
                    loca[(g + 1) * 4],
                    loca[(g + 1) * 4 + 1],
                    loca[(g + 1) * 4 + 2],
                    loca[(g + 1) * 4 + 3],
                ]) as usize,
            )
        } else {
            if (g + 1) * 2 + 2 > loca.len() {
                return None;
            }
            (
                (u16::from_be_bytes([loca[g * 2], loca[g * 2 + 1]]) as usize) * 2,
                (u16::from_be_bytes([loca[(g + 1) * 2], loca[(g + 1) * 2 + 1]]) as usize) * 2,
            )
        };
        if s_off < e_off && e_off <= glyf.len() {
            glyphs.push(glyf[s_off..e_off].to_vec());
        } else {
            glyphs.push(Vec::new());
        }
    }

    let cmap_map = parse_cmap_mappings(&cmap);

    Some(ParsedTtfForMerge {
        fid,
        num_glyphs: ng,
        is_long_loca: is_long,
        glyphs,
        hmtx,
        cmap,
        cmap_map,
        head,
        hhea,
        maxp,
        os2,
    })
}

fn build_merged_ttf(bucket: &[ParsedTtfForMerge]) -> Option<Vec<u8>> {
    let base = bucket.first()?;
    let ng = bucket
        .iter()
        .map(|x| x.num_glyphs)
        .max()
        .unwrap_or(base.num_glyphs);
    let mut merged_glyphs = vec![Vec::new(); ng];
    let mut merged_hmtx = vec![0u8; ng * 4];
    let mut all_cmaps_equal = true;
    let mut merged_cmap_map = base.cmap_map.clone();

    for (idx, item) in bucket.iter().enumerate() {
        if idx > 0 && item.cmap != base.cmap {
            all_cmaps_equal = false;
        }
        for (&c, &g) in &item.cmap_map {
            merged_cmap_map.entry(c).or_insert(g);
        }
        for g in 0..item.num_glyphs {
            if merged_glyphs[g].is_empty() && !item.glyphs[g].is_empty() {
                merged_glyphs[g] = item.glyphs[g].clone();
                if (g + 1) * 4 <= item.hmtx.len() {
                    merged_hmtx[g * 4..g * 4 + 4].copy_from_slice(&item.hmtx[g * 4..g * 4 + 4]);
                }
            } else if g < 4
                && merged_hmtx[g * 4..g * 4 + 4] == [0, 0, 0, 0]
                && (g + 1) * 4 <= item.hmtx.len()
            {
                merged_hmtx[g * 4..g * 4 + 4].copy_from_slice(&item.hmtx[g * 4..g * 4 + 4]);
            }
        }
    }

    let final_cmap = if all_cmaps_equal {
        base.cmap.clone()
    } else if !merged_cmap_map.is_empty() {
        build_format4_cmap(&merged_cmap_map)
    } else {
        base.cmap.clone()
    };

    let mut new_glyf = Vec::new();
    let mut new_offsets = Vec::with_capacity(ng + 1);
    for glyph in &merged_glyphs {
        new_offsets.push(new_glyf.len());
        if !glyph.is_empty() {
            new_glyf.extend_from_slice(glyph);
            while new_glyf.len() % 2 != 0 {
                new_glyf.push(0);
            }
        }
    }
    new_offsets.push(new_glyf.len());

    let use_long = bucket.iter().any(|x| x.is_long_loca) || new_glyf.len() > 131_000;
    let mut head = base.head.clone();
    head[50] = 0;
    head[51] = if use_long { 1 } else { 0 };

    let mut new_loca = Vec::with_capacity((ng + 1) * if use_long { 4 } else { 2 });
    if use_long {
        for &o in &new_offsets {
            new_loca.extend_from_slice(&(o as u32).to_be_bytes());
        }
    } else {
        for &o in &new_offsets {
            new_loca.extend_from_slice(&((o / 2) as u16).to_be_bytes());
        }
    }

    let mut maxp = base.maxp.clone();
    if maxp.len() >= 6 {
        maxp[4..6].copy_from_slice(&(ng as u16).to_be_bytes());
    }

    let mut hhea = base.hhea.clone();
    if hhea.len() >= 36 {
        let num_hmetrics = (merged_hmtx.len() / 4).min(ng) as u16;
        hhea[34..36].copy_from_slice(&num_hmetrics.to_be_bytes());
    }

    let mut kept = vec![
        (*b"head", head),
        (*b"hhea", hhea),
        (*b"maxp", maxp),
        (*b"loca", new_loca),
        (*b"glyf", new_glyf),
        (*b"hmtx", merged_hmtx),
        (*b"cmap", final_cmap),
    ];
    if let Some(os2) = &base.os2 {
        kept.push((*b"OS/2", os2.clone()));
    }
    Some(pack_sfnt_tables(&[0, 1, 0, 0], kept))
}

/// Extrai todos os nomes PDF (`/Nome`) presentes em um stream de conteúdo descompactado.
fn collect_content_names(raw: &[u8], out: &mut HashSet<Vec<u8>>) {
    let mut i = 0;
    let len = raw.len();
    while i < len {
        if raw[i] == b'/' {
            i += 1;
            let start = i;
            while i < len {
                let b = raw[i];
                if b.is_ascii_whitespace()
                    || matches!(
                        b,
                        b'/' | b'[' | b']' | b'(' | b')' | b'<' | b'>' | b'{' | b'}' | b'%'
                    )
                {
                    break;
                }
                i += 1;
            }
            if i > start {
                out.insert(raw[start..i].to_vec());
            }
        } else {
            i += 1;
        }
    }
}

/// Remove referências a objetos órfãos a partir do `trailer` em tempo linear O(N).
fn prune_unreachable_fast(doc: &mut Document) {
    fn enqueue_refs(obj: &Object, visited: &mut HashSet<ObjectId>, queue: &mut VecDeque<ObjectId>) {
        match obj {
            Object::Reference(id) => {
                if visited.insert(*id) {
                    queue.push_back(*id);
                }
            }
            Object::Array(arr) => {
                for item in arr {
                    enqueue_refs(item, visited, queue);
                }
            }
            Object::Dictionary(dict) => {
                for (_, val) in dict.iter() {
                    enqueue_refs(val, visited, queue);
                }
            }
            Object::Stream(stream) => {
                for (_, val) in stream.dict.iter() {
                    enqueue_refs(val, visited, queue);
                }
            }
            _ => {}
        }
    }

    let mut visited = HashSet::with_capacity(doc.objects.len());
    let mut queue = VecDeque::new();
    for (_, val) in doc.trailer.iter() {
        enqueue_refs(val, &mut visited, &mut queue);
    }
    while let Some(id) = queue.pop_front() {
        if let Some(obj) = doc.objects.get(&id) {
            enqueue_refs(obj, &mut visited, &mut queue);
        }
    }
    doc.objects.retain(|id, _| visited.contains(id));
}

struct ImageJob {
    id: ObjectId,
    w: u32,
    h: u32,
    filter_kind: StreamFilterKind,
    raw_content: Vec<u8>,
    channels: usize,
    predictor: i64,
}

struct ImageResult {
    id: ObjectId,
    new_content: Vec<u8>,
    new_w: u32,
    new_h: u32,
    channels: usize,
}

fn compress_via_lopdf(bytes: &[u8]) -> Option<Vec<u8>> {
    let mut doc = Document::load_mem(bytes).ok()?;

    // 1. Limpa metadados XMP/XML, PieceInfo, Thumb e StructTreeRoot em todo o documento
    if let Ok(cat) = doc.catalog_mut() {
        cat.remove(b"Metadata");
        cat.remove(b"PieceInfo");
        cat.remove(b"StructTreeRoot");
    }
    let mut metadata_stream_ids = Vec::new();
    for (&id, obj) in doc.objects.iter_mut() {
        let dict = match obj {
            Object::Dictionary(d) => Some(d),
            Object::Stream(s) => Some(&mut s.dict),
            _ => None,
        };
        if let Some(d) = dict {
            let is_meta = is_name(d.get(b"Type").ok(), b"Metadata")
                || is_name(d.get(b"Subtype").ok(), b"XML");
            if is_meta {
                metadata_stream_ids.push(id);
            } else {
                d.remove(b"Metadata");
                d.remove(b"PieceInfo");
                d.remove(b"Thumb");
                d.remove(b"StructParents");
            }
        }
    }
    for id in metadata_stream_ids {
        doc.objects.remove(&id);
    }

    // 2. Simplifica perfis de cor ICCBased pesados (> 16 KB) para DeviceRGB / DeviceGray / DeviceCMYK
    let mut icc_replacements: HashMap<ObjectId, &'static [u8]> = HashMap::new();
    for (&id, obj) in &doc.objects {
        if let Object::Stream(s) = obj {
            if s.content.len() > 16_384 {
                if let Some(n) = obj_i64(s.dict.get(b"N").ok()) {
                    let dev: Option<&'static [u8]> = match n {
                        1 => Some(b"DeviceGray"),
                        3 => Some(b"DeviceRGB"),
                        4 => Some(b"DeviceCMYK"),
                        _ => None,
                    };
                    if let Some(cs_name) = dev {
                        icc_replacements.insert(id, cs_name);
                    }
                }
            }
        }
    }
    if !icc_replacements.is_empty() {
        for obj in doc.objects.values_mut() {
            replace_icc_arrays(obj, &icc_replacements);
        }
    }

    // 3. Remove recursos (/Font, /XObject) nunca mencionados em NENHUM stream de conteúdo do PDF
    let mut font_file_map: HashMap<ObjectId, String> = HashMap::new();
    for obj in doc.objects.values() {
        if let Object::Dictionary(d) = obj {
            let fname = d
                .get(b"FontName")
                .ok()
                .and_then(|o| o.as_name().ok())
                .map(|n| String::from_utf8_lossy(n).to_string())
                .unwrap_or_default();
            for k in [
                b"FontFile".as_slice(),
                b"FontFile2".as_slice(),
                b"FontFile3".as_slice(),
            ] {
                if let Ok(Object::Reference(fid)) = d.get(k) {
                    font_file_map.insert(*fid, fname.clone());
                }
            }
        }
    }

    let mut all_used_names: HashSet<Vec<u8>> = HashSet::new();
    let mut can_filter_resources = true;
    for (&id, obj) in &doc.objects {
        if let Object::Stream(s) = obj {
            if font_file_map.contains_key(&id) || s.dict.has(b"Length1") {
                continue;
            }
            let subtype = s
                .dict
                .get(b"Subtype")
                .ok()
                .and_then(|o| o.as_name().ok())
                .unwrap_or(b"");
            if matches!(
                subtype,
                b"Image" | b"Type1C" | b"CIDFontType0C" | b"OpenType" | b"XML"
            ) {
                continue;
            }
            let typ = s
                .dict
                .get(b"Type")
                .ok()
                .and_then(|o| o.as_name().ok())
                .unwrap_or(b"");
            if matches!(typ, b"XRef" | b"ObjStm" | b"Metadata") {
                continue;
            }
            if let Ok(raw) = s.decompressed_content() {
                collect_content_names(&raw, &mut all_used_names);
            } else if s.dict.get(b"Filter").is_err() {
                collect_content_names(&s.content, &mut all_used_names);
            } else {
                can_filter_resources = false;
            }
        }
    }

    if can_filter_resources && !all_used_names.is_empty() {
        let obj_ids: Vec<ObjectId> = doc.objects.keys().copied().collect();
        for id in obj_ids {
            let res_dict_id = match doc.objects.get(&id) {
                Some(Object::Dictionary(d)) => match d.get(b"Resources") {
                    Ok(Object::Reference(rid)) => Some(*rid),
                    _ => None,
                },
                Some(Object::Stream(s)) => match s.dict.get(b"Resources") {
                    Ok(Object::Reference(rid)) => Some(*rid),
                    _ => None,
                },
                _ => None,
            };
            if let Some(rid) = res_dict_id {
                if let Some(Object::Dictionary(rd)) = doc.objects.get_mut(&rid) {
                    prune_unused_resource_entries(rd, &all_used_names);
                }
            }
            match doc.objects.get_mut(&id) {
                Some(Object::Dictionary(d)) => {
                    if let Ok(Object::Dictionary(rd)) = d.get_mut(b"Resources") {
                        prune_unused_resource_entries(rd, &all_used_names);
                    }
                }
                Some(Object::Stream(s)) => {
                    if let Ok(Object::Dictionary(rd)) = s.dict.get_mut(b"Resources") {
                        prune_unused_resource_entries(rd, &all_used_names);
                    }
                }
                _ => {}
            }
        }
        prune_unreachable_fast(&mut doc);
    }

    // 4. Otimização paralela de fontes TrueType/OpenType (FontFile2) + fusão de subconjuntos compatíveis
    let mut ttf_jobs: Vec<(ObjectId, String, Vec<u8>, usize)> = Vec::new();
    for (&fid, obj) in &doc.objects {
        if let Object::Stream(s) = obj {
            let fname = font_file_map.get(&fid).cloned().unwrap_or_default();
            if font_file_map.contains_key(&fid) || s.dict.has(b"Length1") {
                if let Some(raw) =
                    raw_flate_decompress(&s.content).or_else(|| s.decompressed_content().ok())
                {
                    if raw.len() >= 12
                        && (raw[0..4] == [0, 1, 0, 0]
                            || &raw[0..4] == b"true"
                            || &raw[0..4] == b"OTTO")
                    {
                        ttf_jobs.push((fid, fname, raw, s.content.len()));
                    }
                }
            }
        }
    }

    let num_threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(1, 8);

    let mut font_replaced_count = 0usize;
    if !ttf_jobs.is_empty() {
        let chunk_size = ttf_jobs.len().div_ceil(num_threads);
        let mut stripped_results: Vec<(ObjectId, String, Vec<u8>, usize)> =
            Vec::with_capacity(ttf_jobs.len());
        std::thread::scope(|s| {
            let mut handles = Vec::new();
            for chunk in ttf_jobs.chunks(chunk_size) {
                handles.push(s.spawn(move || {
                    let mut out = Vec::with_capacity(chunk.len());
                    for (fid, fname, raw, orig_clen) in chunk {
                        if let Some(stripped) = optimize_sfnt_font(raw) {
                            out.push((*fid, fname.clone(), stripped, *orig_clen));
                        }
                    }
                    out
                }));
            }
            for h in handles {
                if let Ok(part) = h.join() {
                    stripped_results.extend(part);
                }
            }
        });

        // Agrupa por família normalizada para fundir subconjuntos compatíveis mesmo com num_glyphs diferentes
        let mut merge_groups: HashMap<String, Vec<ParsedTtfForMerge>> = HashMap::new();
        let mut raw_stripped_by_id: HashMap<ObjectId, (Vec<u8>, usize)> = HashMap::new();

        for (fid, fname, stripped, orig_clen) in stripped_results {
            if let Some(parsed) = parse_ttf_for_merge(fid, &stripped) {
                let key = normalize_font_family(&fname);
                merge_groups.entry(key).or_default().push(parsed);
            }
            raw_stripped_by_id.insert(fid, (stripped, orig_clen));
        }

        let mut font_redirect_map: HashMap<ObjectId, ObjectId> = HashMap::new();
        let mut merged_font_streams: Vec<(ObjectId, Vec<u8>)> = Vec::new();

        for (fam_key, list) in merge_groups {
            if list.len() < 2 {
                continue;
            }
            let min_overlap = if fam_key.is_empty() { 2 } else { 1 };
            // Clusteriza em buckets livres de conflito de glifos e com cmap compatível
            let mut buckets: Vec<Vec<ParsedTtfForMerge>> = Vec::new();
            'outer: for item in list {
                for b in buckets.iter_mut() {
                    let mut has_overlap = false;
                    let conflict = b.iter().any(|member| {
                        if member.head.get(18..20) != item.head.get(18..20) {
                            return true;
                        }
                        let cmap_conflict = if member.cmap == item.cmap {
                            false
                        } else {
                            member
                                .cmap_map
                                .iter()
                                .any(|(c, g1)| item.cmap_map.get(c).is_some_and(|g2| g1 != g2))
                        };
                        if cmap_conflict {
                            return true;
                        }
                        let min_ng = member.num_glyphs.min(item.num_glyphs);
                        let mut ov = 0usize;
                        for g in 0..min_ng {
                            if !member.glyphs[g].is_empty() && !item.glyphs[g].is_empty() {
                                if member.glyphs[g] != item.glyphs[g] {
                                    return true;
                                }
                                ov += 1;
                            }
                        }
                        if ov >= min_overlap {
                            has_overlap = true;
                        }
                        false
                    });
                    if !conflict && (has_overlap || !fam_key.is_empty()) {
                        b.push(item);
                        continue 'outer;
                    }
                }
                buckets.push(vec![item]);
            }

            for b in buckets {
                if b.len() >= 2 {
                    if let Some(merged_raw) = build_merged_ttf(&b) {
                        let master_id = b[0].fid;
                        for member in b.iter().skip(1) {
                            font_redirect_map.insert(member.fid, master_id);
                            raw_stripped_by_id.remove(&member.fid);
                        }
                        raw_stripped_by_id.remove(&master_id);
                        merged_font_streams.push((master_id, merged_raw));
                    }
                }
            }
        }

        // Comprime em paralelo todas as fontes otimizadas (individuais e fundidas)
        let mut to_compress: Vec<(ObjectId, Vec<u8>, Option<usize>)> = Vec::new();
        for (fid, (raw_bytes, orig_clen)) in raw_stripped_by_id {
            to_compress.push((fid, raw_bytes, Some(orig_clen)));
        }
        for (fid, raw_bytes) in merged_font_streams {
            to_compress.push((fid, raw_bytes, None));
        }

        if !to_compress.is_empty() {
            let c_chunk = to_compress.len().div_ceil(num_threads);
            let mut comp_fonts: Vec<(ObjectId, Vec<u8>, usize, Option<usize>)> = Vec::new();
            std::thread::scope(|s| {
                let mut handles = Vec::new();
                for chunk in to_compress.chunks(c_chunk) {
                    handles.push(s.spawn(move || {
                        let mut res = Vec::with_capacity(chunk.len());
                        for (fid, raw_bytes, orig_clen) in chunk {
                            let raw_len = raw_bytes.len();
                            let mut st = Stream::new(dictionary! {}, raw_bytes.clone());
                            if st.compress().is_ok() {
                                res.push((*fid, st.content, raw_len, *orig_clen));
                            }
                        }
                        res
                    }));
                }
                for h in handles {
                    if let Ok(part) = h.join() {
                        comp_fonts.extend(part);
                    }
                }
            });

            for (fid, comp_bytes, raw_len, orig_clen) in comp_fonts {
                if let Some(Object::Stream(s)) = doc.objects.get_mut(&fid) {
                    let accept = match orig_clen {
                        Some(old_len) => comp_bytes.len() + 64 < old_len,
                        None => true,
                    };
                    if accept {
                        s.content = comp_bytes;
                        s.dict.set(b"Filter", Object::Name(b"FlateDecode".to_vec()));
                        s.dict.set(b"Length", s.content.len() as i64);
                        s.dict.set(b"Length1", raw_len as i64);
                        s.dict.remove(b"DecodeParms");
                        font_replaced_count += 1;
                    }
                }
            }
        }

        if !font_redirect_map.is_empty() {
            for obj in doc.objects.values_mut() {
                replace_refs(obj, &font_redirect_map);
            }
            replace_refs_dict(&mut doc.trailer, &font_redirect_map);
            for stale in font_redirect_map.keys() {
                doc.objects.remove(stale);
            }
            font_replaced_count += font_redirect_map.len();
        }
    }

    // 5. Tratamento de máscaras SMask e coleta de jobs de imagem
    // Protegemos todas as máscaras SMask/Mask em si para nunca corromper canais alfa,
    // mas para imagens GRANDES (> 320x320) que possuem SMask:
    // - Se o SMask for 100% opaco (todos os bytes >= 250), removemos o SMask inútil.
    // - Caso contrário, comprimimos a imagem base RGB para JPEG mantendo a referência /SMask intacta!
    let mut mask_object_ids = HashSet::new();
    let mut small_masked_image_ids = HashSet::new();
    let mut opaque_smask_owners = Vec::new();

    for (&id, obj) in &doc.objects {
        let dict = match obj {
            Object::Dictionary(d) => Some(d),
            Object::Stream(s) => Some(&s.dict),
            _ => None,
        };
        if let Some(d) = dict {
            if let Ok(Object::Reference(ref_id)) = d.get(b"Mask") {
                mask_object_ids.insert(*ref_id);
                small_masked_image_ids.insert(id);
            }
            if let Ok(Object::Reference(ref_id)) = d.get(b"SMask") {
                let w = resolve_int(&doc, d.get(b"Width").ok()).unwrap_or(0);
                let h = resolve_int(&doc, d.get(b"Height").ok()).unwrap_or(0);
                if w <= 320 && h <= 320 {
                    mask_object_ids.insert(*ref_id);
                    small_masked_image_ids.insert(id);
                } else if let Some(Object::Stream(ms)) = doc.objects.get(ref_id) {
                    if let Some(mraw) =
                        raw_flate_decompress(&ms.content).or_else(|| ms.decompressed_content().ok())
                    {
                        if !mraw.is_empty() && mraw.iter().all(|&b| b >= 250) {
                            opaque_smask_owners.push(id);
                        }
                    }
                }
            }
        }
    }
    for id in opaque_smask_owners {
        if let Some(Object::Stream(s)) = doc.objects.get_mut(&id) {
            s.dict.remove(b"SMask");
        }
    }

    let mut jobs = Vec::new();
    let ids: Vec<_> = doc.objects.keys().copied().collect();

    for id in ids {
        if mask_object_ids.contains(&id) || small_masked_image_ids.contains(&id) {
            continue;
        }

        let Some(Object::Stream(stream)) = doc.objects.get(&id) else {
            continue;
        };
        if !is_name(stream.dict.get(b"Subtype").ok(), b"Image") {
            continue;
        }
        if stream.dict.has(b"Mask") {
            continue;
        }
        if let Ok(Object::Boolean(true)) = stream.dict.get(b"ImageMask") {
            continue;
        }

        let Some(w) =
            resolve_int(&doc, stream.dict.get(b"Width").ok()).and_then(|v| u32::try_from(v).ok())
        else {
            continue;
        };
        let Some(h) =
            resolve_int(&doc, stream.dict.get(b"Height").ok()).and_then(|v| u32::try_from(v).ok())
        else {
            continue;
        };
        if w == 0 || h == 0 {
            continue;
        }
        // Ícones, logos do app e ilustrações pequenas (<= 320x320 ou leves < 25 KB) permanecem intactos
        if (w <= 320 && h <= 320) || stream.content.len() < 25_000 {
            continue;
        }
        let bpc = resolve_int(&doc, stream.dict.get(b"BitsPerComponent").ok()).unwrap_or(8);
        if bpc != 8 {
            continue;
        }

        let filter_kind = classify_filter(&doc, stream.dict.get(b"Filter").ok());
        let cs_obj = stream.dict.get(b"ColorSpace").ok();

        match filter_kind {
            StreamFilterKind::Dct => {
                let channels = resolve_color_channels(&doc, cs_obj).unwrap_or(3);
                if w > MAX_IMG_DIM || h > MAX_IMG_DIM || stream.content.len() > 25_000 {
                    jobs.push(ImageJob {
                        id,
                        w,
                        h,
                        filter_kind,
                        raw_content: stream.content.clone(),
                        channels: if channels == 1 { 1 } else { 3 },
                        predictor: 1,
                    });
                }
            }
            StreamFilterKind::FlateDct => {
                let channels = resolve_color_channels(&doc, cs_obj).unwrap_or(3);
                if let Some(jpeg_bytes) = raw_flate_decompress(&stream.content) {
                    jobs.push(ImageJob {
                        id,
                        w,
                        h,
                        filter_kind: StreamFilterKind::Dct,
                        raw_content: jpeg_bytes,
                        channels: if channels == 1 { 1 } else { 3 },
                        predictor: 1,
                    });
                }
            }
            StreamFilterKind::Flate | StreamFilterKind::Uncompressed => {
                let Some(channels) = resolve_color_channels(&doc, cs_obj) else {
                    continue;
                };
                if !matches!(channels, 1 | 3 | 4) {
                    continue;
                }
                let predictor = resolve_dict(&doc, stream.dict.get(b"DecodeParms").ok())
                    .and_then(|d| obj_i64(d.get(b"Predictor").ok()))
                    .unwrap_or(1);

                let raw = if filter_kind == StreamFilterKind::Flate {
                    let Some(d) = raw_flate_decompress(&stream.content)
                        .or_else(|| stream.decompressed_content().ok())
                    else {
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
                    filter_kind,
                    raw_content: raw,
                    channels,
                    predictor,
                });
            }
            StreamFilterKind::Unsupported => {}
        }
    }

    let mut replaced_count = 0;
    if !jobs.is_empty() {
        let chunk_size = jobs.len().div_ceil(num_threads);
        let mut thread_results: Vec<Vec<ImageResult>> = Vec::new();

        std::thread::scope(|s| {
            let mut handles = Vec::new();
            for chunk in jobs.chunks(chunk_size) {
                let handle = s.spawn(move || {
                    let mut res = Vec::new();
                    for job in chunk {
                        if job.filter_kind == StreamFilterKind::Dct {
                            if let Ok(img) = image::load_from_memory_with_format(
                                &job.raw_content,
                                ImageFormat::Jpeg,
                            ) {
                                let scaled = downscale_if_needed(img);
                                let nw = scaled.width();
                                let nh = scaled.height();
                                let (enc_img, out_ch) = if job.channels == 1 {
                                    (DynamicImage::ImageLuma8(scaled.to_luma8()), 1)
                                } else {
                                    (DynamicImage::ImageRgb8(scaled.to_rgb8()), 3)
                                };
                                if let Some(new_jpeg) = encode_jpeg(&enc_img) {
                                    if new_jpeg.len() + 512 < job.raw_content.len() {
                                        res.push(ImageResult {
                                            id: job.id,
                                            new_content: new_jpeg,
                                            new_w: nw,
                                            new_h: nh,
                                            channels: out_ch,
                                        });
                                    }
                                }
                            }
                        } else {
                            let expected_len = (job.w as usize) * (job.h as usize) * job.channels;
                            let pixel_bytes = if job.raw_content.len() == expected_len {
                                Some(job.raw_content.clone())
                            } else if job.predictor >= 10 {
                                unfilter_png(
                                    &job.raw_content,
                                    job.w as usize,
                                    job.h as usize,
                                    job.channels,
                                )
                            } else {
                                None
                            };
                            let Some(pixels) = pixel_bytes else { continue };

                            let (dyn_img, out_ch) = if job.channels == 3 {
                                let Some(rgb) = RgbImage::from_raw(job.w, job.h, pixels) else {
                                    continue;
                                };
                                (DynamicImage::ImageRgb8(rgb), 3)
                            } else if job.channels == 1 {
                                let Some(gray) = GrayImage::from_raw(job.w, job.h, pixels) else {
                                    continue;
                                };
                                (DynamicImage::ImageLuma8(gray), 1)
                            } else if job.channels == 4 {
                                let mut rgb_vec =
                                    Vec::with_capacity((job.w as usize) * (job.h as usize) * 3);
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
                                let Some(rgb) = RgbImage::from_raw(job.w, job.h, rgb_vec) else {
                                    continue;
                                };
                                (DynamicImage::ImageRgb8(rgb), 3)
                            } else {
                                continue;
                            };

                            let scaled = downscale_if_needed(dyn_img);
                            let nw = scaled.width();
                            let nh = scaled.height();
                            let enc_img = if out_ch == 1 {
                                DynamicImage::ImageLuma8(scaled.to_luma8())
                            } else {
                                DynamicImage::ImageRgb8(scaled.to_rgb8())
                            };
                            if let Some(new_jpeg) = encode_jpeg(&enc_img) {
                                res.push(ImageResult {
                                    id: job.id,
                                    new_content: new_jpeg,
                                    new_w: nw,
                                    new_h: nh,
                                    channels: out_ch,
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

        for res_list in thread_results {
            for res in res_list {
                if let Some(Object::Stream(stream)) = doc.objects.get_mut(&res.id) {
                    if res.new_content.len() + 256 < stream.content.len() {
                        stream.content = res.new_content;
                        stream
                            .dict
                            .set(b"Filter", Object::Name(b"DCTDecode".to_vec()));
                        stream.dict.set(b"Width", res.new_w as i64);
                        stream.dict.set(b"Height", res.new_h as i64);
                        stream.dict.set(b"Length", stream.content.len() as i64);
                        let cs_name = if res.channels == 1 {
                            b"DeviceGray".to_vec()
                        } else {
                            b"DeviceRGB".to_vec()
                        };
                        stream.dict.set(b"ColorSpace", Object::Name(cs_name));
                        stream.dict.set(b"BitsPerComponent", 8);
                        stream.dict.remove(b"DecodeParms");
                        stream.dict.remove(b"Decode");
                        replaced_count += 1;
                    }
                }
            }
        }
    }

    let dedup_count = deduplicate_streams(&mut doc);

    if replaced_count == 0 && dedup_count == 0 && font_replaced_count == 0 {
        return None;
    }

    doc.delete_zero_length_streams();
    prune_unreachable_fast(&mut doc);

    let mut out = Vec::with_capacity(bytes.len() / 2);
    let mut cursor = Cursor::new(&mut out);
    doc.save_to(&mut cursor).ok()?;
    if out.len() > 100 && out.len() < bytes.len() {
        Some(out)
    } else {
        None
    }
}

fn prune_unused_resource_entries(res_dict: &mut lopdf::Dictionary, used_names: &HashSet<Vec<u8>>) {
    for subkey in [b"Font".as_slice(), b"XObject".as_slice()] {
        if let Ok(Object::Dictionary(sub)) = res_dict.get_mut(subkey) {
            let keys: Vec<Vec<u8>> = sub.iter().map(|(k, _)| k.clone()).collect();
            for k in keys {
                if !used_names.contains(&k) {
                    sub.remove(&k);
                }
            }
        }
    }
}

fn replace_icc_arrays(obj: &mut Object, icc_map: &HashMap<ObjectId, &'static [u8]>) {
    match obj {
        Object::Array(arr) => {
            if arr.len() == 2 && is_name(arr.first(), b"ICCBased") {
                if let Some(Object::Reference(id)) = arr.get(1) {
                    if let Some(&dev_name) = icc_map.get(id) {
                        *obj = Object::Name(dev_name.to_vec());
                        return;
                    }
                }
            }
            for item in arr.iter_mut() {
                replace_icc_arrays(item, icc_map);
            }
        }
        Object::Dictionary(dict) => {
            for (_, val) in dict.iter_mut() {
                replace_icc_arrays(val, icc_map);
            }
        }
        Object::Stream(stream) => {
            for (_, val) in stream.dict.iter_mut() {
                replace_icc_arrays(val, icc_map);
            }
        }
        _ => {}
    }
}

/// Deduplica streams com o mesmo conteúdo binário (ex.: fontes Type1C, CMaps e imagens repetidas em múltiplos PDFs).
fn deduplicate_streams(doc: &mut Document) -> usize {
    let mut seen: HashMap<Vec<u8>, ObjectId> = HashMap::new();
    let mut replacements: HashMap<ObjectId, ObjectId> = HashMap::new();

    for (&id, obj) in doc.objects.iter() {
        if let Object::Stream(s) = obj {
            if s.content.len() > 256 {
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

fn replace_refs_dict(dict: &mut lopdf::Dictionary, map: &HashMap<ObjectId, ObjectId>) {
    for val in dict.iter_mut().map(|(_, v)| v) {
        replace_refs(val, map);
    }
}

fn replace_refs(obj: &mut Object, map: &HashMap<ObjectId, ObjectId>) {
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

        let content = Stream::new(
            dictionary! {},
            b"q 500 0 0 500 50 200 cm /Im0 Do Q".to_vec(),
        );
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
        let raw = vec![
            1u8, 10, 20, 30, 5, 5, 5, // row 0: pixel 0 = (10, 20, 30), pixel 1 = (15, 25, 35)
            2u8, 1, 2, 3, 4, 5, 6, // row 1: pixel 0 = (11, 22, 33), pixel 1 = (19, 30, 41)
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

        let mask_stream = Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => 120,
                "Height" => 120,
                "ColorSpace" => "DeviceGray",
                "BitsPerComponent" => 8,
            },
            vec![128u8; 120 * 120],
        );
        let mask_id = doc.add_object(mask_stream);

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
        let logo_id = doc.add_object(logo_stream);
        let content_id = doc.add_object(Stream::new(
            dictionary! {},
            b"q 100 0 0 100 10 10 cm /ImLogo Do Q".to_vec(),
        ));
        let res_id = doc.add_object(dictionary! {
            "XObject" => dictionary! { "ImLogo" => logo_id },
        });

        doc.objects.insert(
            page_id,
            Object::Dictionary(dictionary! {
                "Type" => "Page",
                "Parent" => pages_id,
                "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
                "Contents" => content_id,
                "Resources" => res_id,
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

    #[test]
    fn diagnose_real_pdf() {
        for name in [
            "preview_producoes_Maicon_Nardino.pdf",
            "preview_producoes_Tiago_Olivoto.pdf",
            "preview_bancas_Tiago_Olivoto.pdf",
        ] {
            let p = std::env::temp_dir().join("LattesManager").join(name);
            if !p.exists() {
                continue;
            }
            let bytes = std::fs::read(&p).unwrap();
            let t0 = std::time::Instant::now();
            let comp = compress_via_lopdf(&bytes).unwrap_or_else(|| bytes.clone());
            let elapsed = t0.elapsed();
            let orig_mb = bytes.len() as f64 / (1024.0 * 1024.0);
            let comp_mb = comp.len() as f64 / (1024.0 * 1024.0);
            let pct = (1.0 - (comp_mb / orig_mb)) * 100.0;
            println!(
                "  [{}] {:.2} MB -> {:.2} MB (-{:.1}%) em {:?}",
                name, orig_mb, comp_mb, pct, elapsed
            );
            assert!(
                comp_mb < orig_mb * 0.40,
                "PDF deve comprimir pelo menos 60%"
            );
        }
    }
}
