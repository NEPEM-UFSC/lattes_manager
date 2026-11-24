// Barema de pontuação (Progressão / Promoção / PQ / Concursos): modelos padrão, regras e cálculo.
// Usado pelo Simulador de Pontuação e pelo gerador de comprovantes (seção "Pontuação" do PDF).

import { CATEGORY_SCHEMAS, horasAtuacao, semestresRegistro } from "./utils.js";

export const CUR_YEAR = new Date().getFullYear();

export function cloneRules(rules) {
  return rules.map((r) => ({
    id: r.id,
    label: r.label,
    category: r.category,
    match: { ...(r.match || {}) },
    weight: Number(r.weight || 0),
    cap: r.cap != null && r.cap !== "" ? Number(r.cap) : null,
    // base de cálculo: "item" (padrão), "hora" (× horas do registro) ou "hora_semanal" (× horas ÷ 18)
    ...(r.base && r.base !== "item" ? { base: r.base } : {}),
    // RN 114/UFSC: tabela em que o critério entra ("ensino" = Tabela 1; "pesquisa" = Tabela 2)
    ...(r.table ? { table: r.table } : {}),
    // grupo da tabela do barema (ex.: "Grupo II") e código do item (ex.: "2.2.5"); critérios com
    // o mesmo código dividem o mesmo teto
    ...(r.group ? { group: r.group } : {}),
    ...(r.item ? { item: String(r.item) } : {}),
    // no máximo N registros por obra (ex.: 2 capítulos por livro), pelo título da obra (campo journal)
    ...(Number(r.porObra) > 0 ? { porObra: Number(r.porObra) } : {}),
  }));
}

/**
 * Grupos de um barema genérico (tabela com grupos/seções): { id, name, cap, pick, allYears }.
 *  - cap: teto do grupo (soma dos critérios limitada a este valor);
 *  - pick: "max" = vale só o item de maior pontuação do grupo (ex.: maior título acadêmico);
 *  - allYears: o grupo ignora o período (ex.: títulos acadêmicos valem de qualquer ano).
 */
export function cloneGroups(groups) {
  return (Array.isArray(groups) ? groups : []).map((g) => ({
    id: String(g.id),
    name: g.name || String(g.id),
    cap: g.cap != null && g.cap !== "" ? Number(g.cap) : null,
    ...(g.pick === "max" ? { pick: "max" } : {}),
    ...(g.allYears ? { allYears: true } : {}),
    // recebe as atividades anteriores ao período (ex.: Grupo V do concurso, "anteriores aos últimos dez anos")
    ...(g.before ? { before: true } : {}),
  }));
}

/** Rótulos das bases de cálculo. */
export const BASE_LABEL = {
  item: "por item",
  ano: "× anos (anos distintos no período)",
  semestre: "× semestres (no período)",
  hora: "× horas",
  hora_semanal: "× horas ÷ 18 (h/semana)",
};

/** Cores dos grupos de um barema genérico (na ordem dos grupos). */
export const GROUP_COLORS = ["#7c3aed", "#2563eb", "#059669", "#d97706", "#dc2626", "#0891b2", "#db2777", "#65a30d"];

/** Ano final de um registro sem ano de fim: na Atuação, está em andamento (até o ano atual). */
// sem ano de fim = em andamento: atuação; projetos cadastrados com semestre (os antigos, só com o
// ano de início, valem apenas aquele ano); orientações marcadas "em andamento"
const emAndamento = (cat, rec) =>
  cat === "atuacao" ||
  (cat === "projetos" && (Number(rec?.semestre) === 1 || Number(rec?.semestre) === 2)) ||
  /andamento/i.test(String(rec?.situacao || ""));
const fimAberto = (cat, a, rec = null) => (emAndamento(cat, rec) ? Math.max(a, CUR_YEAR) : a);

/** Anos (inteiros) cobertos por um registro, recortados pelo período. Sem ano_fim = só o ano. */
function yearsOf(rec, period, cat = null) {
  const a = Number(rec.ano);
  if (!Number.isFinite(a) || a <= 0) return [];
  let b = Number(rec.ano_fim);
  if (!Number.isFinite(b) || b < a) b = fimAberto(cat, a, rec);
  const lo = period?.from != null ? Math.max(a, period.from) : a;
  const hi = period?.to != null ? Math.min(b, period.to) : b;
  const out = [];
  for (let y = lo; y <= hi && out.length < 80; y++) out.push(y);
  return out;
}

/**
 * Unidades (ou pontos) que um registro gera no critério: FM × base de cálculo. Na Atuação, as horas
 * são por semestre e o total considera os semestres do período (recortados por `period`).
 */
export function unitsOf(rec, rule, cat = null, period = null) {
  const w = Number(rule.weight || 0);
  const base = rule.base || "item";
  if (base === "item") return w;
  if (base === "semestre") return w * semestresRegistro(rec, period, emAndamento(cat, rec));
  const h = cat === "atuacao" ? horasAtuacao(rec, period)?.total || 0 : Number(String(rec.horas ?? "").replace(",", ".")) || 0;
  return base === "hora_semanal" ? (w * h) / 18 : w * h;
}

// ---------------------------------------------------------------------------
// RN 114/2017/CUn (UFSC) — progressões e promoções na carreira do Magistério Superior
// ---------------------------------------------------------------------------

/** Tabela 4 (Anexo 01): [unidades até, pontos]; acima de 106,44 unidades = 40 pontos. */
export const RN114_TABELA4 = [
  [0, 0], [0.73, 1], [1.48, 2], [2.25, 3], [3.04, 4], [3.85, 5], [4.69, 6], [5.55, 7], [6.44, 8], [7.35, 9],
  [8.3, 10], [9.28, 11], [10.29, 12], [11.34, 13], [12.43, 14], [13.56, 15], [14.74, 16], [15.97, 17], [17.25, 18], [18.59, 19],
  [20, 20], [21.48, 21], [23.04, 22], [24.69, 23], [26.44, 24], [28.3, 25], [30.29, 26], [32.43, 27], [34.74, 28], [37.25, 29],
  [40, 30], [43.04, 31], [46.44, 32], [50.29, 33], [54.74, 34], [60, 35], [66.44, 36], [74.74, 37], [86.44, 38], [106.44, 39],
];

/** p(u): pontos da Tabela 4 para a média de unidades por semestre. */
export function rn114Pontos(u) {
  const v = Math.round(Math.max(0, Number(u) || 0) * 100) / 100;
  if (v <= 0) return 0;
  for (const [ate, p] of RN114_TABELA4) if (v <= ate) return p;
  return 40;
}

export const RN114_TABELAS = {
  ensino: { name: "Tabela 1 – Ensino", color: "#2563eb" },
  pesquisa: { name: "Tabela 2 – Pesquisa, Extensão e Produção Intelectual", color: "#059669" },
};

/** Itens do Anexo 01 (MS) mapeados para as categorias e os tipos do Lattes. A ordem importa. */
function rn114Rules() {
  const T1 = "ensino", T2 = "pesquisa";
  const r = (id, table, category, label, weight, match, base) => ({ id, table, category, label, weight, cap: null, match, ...(base ? { base } : {}) });
  return [
    // ----- Tabela 1 – Ensino -----
    r("t1_docencia", T1, "atuacao", "Docência – graduação e pós-graduação (FM 2,5 × horas/semana)", 2.5, { tipoRegex: "encargo|disciplina|doc[êe]ncia|ensino" }, "hora_semanal"),
    r("t1_funcao", T1, "atuacao", "Funções administrativas de 20 a 40 h (por semestre; FM 110, 100 ou 87)", 110, { tipoRegex: "dire[cç][aã]o|chefia|vice-?diret|pr[óo]-?reitor" }),
    r("t1_form_10", T1, "formacao", "Formação stricto sensu / pós-doutorado – afastamento parcial 10 h (por semestre)", 45, { tipoRegex: "afastamento.*10" }),
    r("t1_form_20", T1, "formacao", "Formação stricto sensu / pós-doutorado – afastamento parcial 20 h (por semestre)", 90, { tipoRegex: "afastamento.*20" }),
    r("t1_form", T1, "formacao", "Formação stricto sensu / pós-doutorado – com afastamento (por semestre)", 110, { tipoRegex: "afastamento" }),
    // ----- Tabela 2 – Pesquisa, Extensão e Produção Intelectual -----
    r("t2_ext", T2, "projetos", "Ações de extensão registradas no SIGPEX (FM 0,04 × horas)", 0.04, { tipoRegex: "extens" }, "hora"),
    // bancas
    r("t2_ban_sel", T2, "bancas", "Banca de seleção para mestrado e doutorado", 2, { tipoRegex: "sele[cç][aã]o" }),
    r("t2_ban_qdoc", T2, "bancas", "Banca de qualificação de doutorado", 2.5, { tipoRegex: "qualifica.*doutorado" }),
    r("t2_ban_qmes", T2, "bancas", "Banca de qualificação de mestrado", 2, { tipoRegex: "qualifica.*mestrado" }),
    r("t2_ban_prob", T2, "bancas", "Avaliação de estágio probatório (prof. × semestre)", 0.5, { tipoRegex: "probat" }),
    r("t2_ban_prog", T2, "bancas", "Comissão de progressão/promoção funcional", 0.09, { tipoRegex: "progress|promo[cç][aã]o" }),
    r("t2_ban_conc", T2, "bancas", "Banca de concurso público", 3, { tipoRegex: "concurso" }),
    r("t2_ban_pss", T2, "bancas", "Banca de processo seletivo simplificado", 2, { tipoRegex: "processo seletivo|simplificado" }),
    r("t2_ban_doc", T2, "bancas", "Banca de doutorado", 3, { tipoRegex: "doutorado" }),
    r("t2_ban_mes", T2, "bancas", "Banca de mestrado", 2.5, { tipoRegex: "mestrado" }),
    r("t2_ban_esp", T2, "bancas", "Banca de especialização", 2, { tipoRegex: "especializa" }),
    r("t2_ban_tcc", T2, "bancas", "Banca de TCC, monografia (graduação)", 2, { tipoRegex: "gradua|tcc|monografia|conclus|est[áa]gio" }),
    // cursos
    r("t2_cursos", T2, "formacao", "Participação em cursos de extensão de curta duração, 8 a 30 h (FM 0,04 × horas)", 0.04, { tipoRegex: "curta dura|extens" }, "hora"),
    // eventos e palestras
    r("t2_poster", T2, "producoes", "Apresentador de pôster", 2, { tipoRegex: "p[ôo]ster|painel" }),
    r("t2_palestra", T2, "producoes", "Conferencista ou palestrante", 5, { tipoRegex: "palestra|confer[êe]ncia" }),
    r("t2_moderador", T2, "eventos", "Moderador de mesa ou similar", 4.5, { tipoRegex: "modera|mesa" }),
    r("t2_ouvinte", T2, "eventos", "Ouvinte em eventos", 0.2, { tipoRegex: "participa" }),
    // prestação de serviço
    r("t2_transf", T2, "patentes", "Contrato de transferência de tecnologia", 45, { tipoRegex: "transfer" }),
    r("t2_patente", T2, "patentes", "Depósito de patente e modelo de utilidade", 20, { tipoRegex: "patente|modelo de utilidade" }),
    r("t2_dautor", T2, "patentes", "Registro de direitos autorais", 20, { tipoRegex: "autora" }),
    r("t2_marca_sw", T2, "patentes", "Registro de marcas e softwares", 20, { tipoRegex: "marca|software|programa" }),
    r("t2_consult", T2, "producoes", "Consultoria, assessoria, laudos técnicos", 20, { tipoRegex: "consultoria|assessoria|laudo" }),
    r("t2_atendimento", T2, "producoes", "Atendimento em saúde ou jurídico", 20, { tipoRegex: "atendimento" }),
    // publicações
    r("t2_livro_trad", T2, "producoes", "Tradução de livros", 30, { tipoRegex: "tradu" }),
    r("t2_livro_org", T2, "producoes", "Organização de livros", 30, { tipoRegex: "organiza" }),
    r("t2_cap", T2, "producoes", "Capítulo de livro / revisão de livro", 25, { tipoRegex: "cap[íi]tulo" }),
    r("t2_livro", T2, "producoes", "Autoria de livros", 80, { tipoRegex: "livro" }),
    r("t2_art_idx", T2, "producoes", "Artigo em periódico indexado (com Qualis A ou B)", 25, { tipoRegex: "artigo", qualisRegex: "^[AB]" }),
    r("t2_art", T2, "producoes", "Artigo em periódico não indexado", 15, { tipoRegex: "artigo" }),
    r("t2_nota_idx", T2, "producoes", "Nota breve em periódico indexado (com Qualis A ou B)", 10, { tipoRegex: "nota", qualisRegex: "^[AB]" }),
    r("t2_nota", T2, "producoes", "Nota breve em periódico não indexado", 6, { tipoRegex: "nota" }),
    r("t2_anais_int", T2, "producoes", "Texto integral em anais de congressos", 15, { tipoRegex: "complet" }),
    r("t2_anais_res", T2, "producoes", "Resumo em anais de congressos", 4, { tipoRegex: "resumo" }),
    r("t2_resenha", T2, "producoes", "Resenha em periódico", 5, { tipoRegex: "resenha" }),
    r("t2_relatorio", T2, "producoes", "Relatório de projeto de pesquisa concluído", 15, { tipoRegex: "relat[óo]rio" }),
    r("t2_audiovisual", T2, "producoes", "Programa de rádio ou TV ou produção audiovisual", 4, { tipoRegex: "r[áa]dio|tv|televis|audiovisual|v[íi]deo" }),
    r("t2_revisao", T2, "atuacao", "Revisão de artigos científicos", 0.4, { tipoRegex: "revis" }),
    // orientação
    r("t2_ori_doc_and", T2, "orientacoes", "Orientação de tese de doutorado em andamento (tese × semestre)", 3, { tipoRegex: "doutorado|tese", tipoNotRegex: "p[óo]s-?doutorado", campos: { situacao: "andamento" } }, "semestre"),
    r("t2_ori_mes_and", T2, "orientacoes", "Orientação de dissertação de mestrado em andamento (dissertação × semestre)", 2.5, { tipoRegex: "mestrado|disserta", campos: { situacao: "andamento" } }, "semestre"),
    r("t2_ori_doc", T2, "orientacoes", "Orientação de tese de doutorado aprovada", 1.5, { tipoRegex: "doutorado", tipoNotRegex: "p[óo]s-?doutorado" }),
    r("t2_ori_mes", T2, "orientacoes", "Orientação de dissertação de mestrado aprovada", 1.25, { tipoRegex: "mestrado|disserta" }),
    r("t2_ori_tcc", T2, "orientacoes", "Orientação de monografia, TCC ou iniciação científica", 1.25, { tipoRegex: "conclus|tcc|monografia|inicia[cç][aã]o|especializa" }),
    r("t2_ori_pratica", T2, "orientacoes", "Estagiários de prática de ensino (por semestre)", 4, { tipoRegex: "pr[áa]tica de ensino|est[áa]gio de doc" }),
    r("t2_ori_pet", T2, "orientacoes", "PET, monitoria, estágio e extensão (aluno × semestre)", 0.25, { tipoRegex: "pet\\b|monitoria|est[áa]gio|extens" }),
    // funções administrativas com carga inferior a 20 h
    r("t2_comdel", T2, "atuacao", "Comissão delegada por ministério / representação em organismo (portaria × semestre)", 2.5, { tipoRegex: "minist|representa" }),
    r("t2_adm", T2, "atuacao", "Conselho, comissão editorial, colegiados e cargos < 20 h (horas × semestres)", 1, { tipoRegex: "comiss|colegiad|conselho|editorial|coordena|supervis" }, "hora"),
  ];
}

// ---------------------------------------------------------------------------
// UFSC — Tabela de Valoração de Títulos (concurso público para o Magistério Superior)
// ---------------------------------------------------------------------------

export const UFSC_CONCURSO_GRUPOS = [
  { id: "g1", name: "Grupo I – Títulos acadêmicos", cap: null, pick: "max", allYears: true },
  { id: "g2", name: "Grupo II – Atividades de ensino e extensão", cap: null },
  { id: "g3", name: "Grupo III – Trabalhos científicos, tecnológicos, artísticos e culturais", cap: null },
  { id: "g4", name: "Grupo IV – Funções administrativas universitárias", cap: null },
  // Grupo V: as atividades dos grupos II a IV anteriores ao período (últimos dez anos), até 10 pontos
  { id: "g5", name: "Grupo V – Atividades anteriores aos últimos dez anos", cap: 10, before: true },
];

/** Itens da tabela mapeados para as categorias e os tipos do Lattes. A ordem importa (1º critério que atender). */
function ufscConcursoRules() {
  const c = (id, group, item, category, label, weight, cap, match, base) => ({
    id, group, item, category, label: `${item} ${label}`, weight, cap, match, ...(base ? { base } : {}),
  });
  const NAO_CURSO = "curta|extens|aperfei|atualiza|complementar";
  const CONCLUIDA = { situacao: "^(?!.*andamento)" };
  return [
    // ----- formação (Grupo I e capacitação docente do Grupo II) -----
    c("tv_posdoc_real", "g2", "2.5.1", "formacao", "Realização de estágio pós-doutoral (mín. 4 meses)", 2, null, { textoRegex: "p[óo]s-?doutor" }),
    c("tv_doutorado", "g1", "1.1", "formacao", "Doutorado", 120, null, { textoRegex: "doutorado", tipoNotRegex: NAO_CURSO }),
    c("tv_mestrado", "g1", "1.2", "formacao", "Mestrado", 70, null, { textoRegex: "mestrado", tipoNotRegex: NAO_CURSO }),
    c("tv_especializacao", "g1", "1.3", "formacao", "Especialização ou residência (mín. 360 h)", 30, null, { textoRegex: "especializa|resid[êe]ncia", tipoNotRegex: NAO_CURSO }),
    c("tv_graduacao", "g1", "1.4", "formacao", "Graduação", 10, null, { textoRegex: "gradua[çc][ãa]o|bacharel|licenciatura", tipoNotRegex: NAO_CURSO }),
    c("tv_cap_tec", "g2", "2.5.2", "formacao", "Estágio de capacitação técnico-profissional (mín. 2 meses)", 1, null, { textoRegex: "est[áa]gio de capacita|capacita[çc][ãa]o t[ée]cnico" }),
    c("tv_aperfeicoamento", "g2", "2.5.4", "formacao", "Curso de aperfeiçoamento (mín. 180 h)", 1, 5, { textoRegex: "aperfei[çc]oamento", horasMin: 180 }),
    c("tv_atualizacao", "g2", "2.5.3", "formacao", "Curso de atualização (mín. 40 h)", 0.5, 5, { tipoRegex: "curta|atualiza|extens|aperfei", horasMin: 40 }),

    // ----- atuação: funções administrativas (Grupo IV, por ano) -----
    c("tv_coord_esp", "g4", "4.9", "atuacao", "Coordenação de curso de especialização (por curso)", 1, null, { textoRegex: "coordena.*especializa" }),
    c("tv_vice_reitor", "g4", "4.2", "atuacao", "Vice-reitor, pró-reitor ou equivalente (por ano)", 3, null, { textoRegex: "vice-?reitor(a)?\\b|pr[óo]-?reitor(a)?\\b" }, "ano"),
    c("tv_reitor", "g4", "4.1", "atuacao", "Reitor ou equivalente (por ano)", 4, null, { textoRegex: "\\breitor(a)?\\b" }, "ano"),
    c("tv_vice_diretor", "g4", "4.4", "atuacao", "Vice-diretor (por ano)", 2, null, { textoRegex: "vice-?diretor" }, "ano"),
    c("tv_diretor_unid", "g4", "4.3", "atuacao", "Diretor de unidade universitária ou de órgão suplementar (por ano)", 2.5, null, { textoRegex: "diretor(a)? (de|do|da) (centro|unidade|campus|instituto|faculdade|escola|hospital|museu|biblioteca|[óo]rg[ãa]o suplementar)" }, "ano"),
    c("tv_subchefe", "g4", "4.5", "atuacao", "Coordenador de coordenadoria administrativa, subchefe ou subcoordenador (por ano)", 1.5, null, { textoRegex: "subchefe|sub-?coordenador|coordenador(a)? de coordenadoria" }, "ano"),
    c("tv_coord_ens", "g4", "4.6", "atuacao", "Coordenador de ensino, pesquisa, extensão, estágio ou equivalente (por ano)", 0.5, null, { textoRegex: "coordenador(a)? (de|do|da|dos|das) (ensino|pesquisa|extens|est[áa]gio)" }, "ano"),
    c("tv_chefe_coord", "g4", "4.4", "atuacao", "Chefe de departamento, coordenador de curso de graduação ou pós-graduação stricto sensu (por ano)", 2, null, { textoRegex: "chefe (de|do) (departamento|gabinete)|diretor(a)? (de|do) departamento|coordenador(a)? (de|do|da) (curso|programa)|coordena[çc][ãa]o (de|do|da) (curso|programa)" }, "ano"),
    c("tv_colegiado_sup", "g4", "4.7", "atuacao", "Membro titular de órgão colegiado superior (por ano)", 0.5, null, { textoRegex: "conselho universit|conselho (de|do) (ensino|pesquisa|extens|curadores|centro)|c[âa]mara de (gradua|p[óo]s|pesquisa|extens)|\\bCUn\\b|\\bCEPE\\b" }, "ano"),
    c("tv_colegiado_curso", "g4", "4.8", "atuacao", "Membro titular de colegiado de curso (por ano)", 0.5, null, { textoRegex: "colegiad" }, "ano"),

    // ----- atuação: docência (Grupo II, por ano) -----
    c("tv_doc_basica", "g2", "2.1.4", "atuacao", "Magistério na educação básica (por ano)", 3, null, { tipoRegex: "encargo|disciplina|doc[êe]ncia|magist|professor", textoRegex: "educa[çc][ãa]o b[áa]sica|ensino (m[ée]dio|fundamental)" }, "ano"),
    c("tv_doc_pos", "g2", "2.1.2", "atuacao", "Magistério superior – pós-graduação stricto sensu (por ano)", 2, null, { tipoRegex: "(encargo|disciplina|doc[êe]ncia|magist).*p[óo]s" }, "ano"),
    c("tv_doc_grad", "g2", "2.1.1", "atuacao", "Magistério superior – graduação (por ano)", 2, null, { tipoRegex: "encargo|disciplina|doc[êe]ncia|magist" }, "ano"),
    c("tv_com_bolsistas", "g2", "2.3.3", "atuacao", "Comissão de seleção/julgamento de bolsistas de graduação", 0.5, 10, { tipoRegex: "comiss", textoRegex: "bolsist|monitoria|inicia[çc][ãa]o|pibic|pibid|\\bpet\\b|est[áa]gio", textoNotRegex: "probat" }),
    // ----- atuação: comitês científicos e atividades profissionais (Grupo III) -----
    c("tv_editorial", "g3", "3.2.1", "atuacao", "Membro de comitê científico ou editorial de periódico (por periódico)", 3, null, { tipoRegex: "editorial|comit[êe] cient" }),
    c("tv_parecerista", "g3", "3.2.2", "atuacao", "Parecerista de periódico científico (por periódico)", 2, null, { tipoRegex: "revisor|parecer" }),
    c("tv_adhoc", "g3", "3.2.3", "atuacao", "Consultor ad hoc de agência de fomento (por ano)", 2, null, { textoRegex: "ad hoc|consultor" }, "ano"),
    c("tv_coord_area", "g3", "3.2.4", "atuacao", "Coordenação de área ou comitê de assessoramento em agência de fomento (por atuação ≥ 2 anos)", 5, null, { textoRegex: "coordena[çc][ãa]o de [áa]rea|coordenador(a)? de [áa]rea|comit[êe] de assessoramento" }),
    c("tv_pres_soc", "g3", "3.2.5", "atuacao", "Presidente de sociedade científica ou órgão de classe (por gestão ≥ 2 anos)", 3, null, { textoRegex: "presidente (da|de|do) (sociedade|associa|conselho (regional|federal)|ordem|sindicato)" }),
    c("tv_dir_soc", "g3", "3.2.6", "atuacao", "Diretoria ou conselho de sociedade científica (por ano)", 2, null, { textoRegex: "sociedade|associa[çc][ãa]o (brasileira|internacional|cient)" }, "ano"),
    c("tv_dir_classe", "g3", "3.2.7", "atuacao", "Diretoria ou conselho de órgão de gestão de classe (por ano)", 1, null, { textoRegex: "conselho (regional|federal)|\\bcrea\\b|\\bcrbio\\b|sindicato|ordem dos" }, "ano"),
    c("tv_profissional", "g3", "3.4.7", "atuacao", "Atividades profissionais no campo do concurso (por ano)", 3, null, { tipoRegex: "v[íi]nculo|profission|emprego|celetista" }, "ano"),

    // ----- orientações (Grupo II) -----
    c("tv_ori_posdoc", "g2", "2.2.7", "orientacoes", "Supervisão de estágio pós-doutoral concluído", 3, null, { tipoRegex: "p[óo]s-?doutor", campos: CONCLUIDA }),
    c("tv_coori_tese", "g2", "2.2.2", "orientacoes", "Coorientação de tese aprovada", 1.5, null, { tipoRegex: "doutorado|tese", campos: { ...CONCLUIDA, papel: "coorient" } }),
    c("tv_ori_tese", "g2", "2.2.1", "orientacoes", "Orientação de tese aprovada", 3, null, { tipoRegex: "doutorado|tese", campos: CONCLUIDA }),
    c("tv_coori_diss", "g2", "2.2.4", "orientacoes", "Coorientação de dissertação aprovada", 1, null, { tipoRegex: "mestrado|disserta", campos: { ...CONCLUIDA, papel: "coorient" } }),
    c("tv_ori_diss", "g2", "2.2.3", "orientacoes", "Orientação de dissertação aprovada", 2, null, { tipoRegex: "mestrado|disserta", campos: CONCLUIDA }),
    c("tv_ori_tcc", "g2", "2.2.6", "orientacoes", "Orientação de TCC de graduação ou monografia", 1, 20, { tipoRegex: "conclus|tcc|monografia|especializa" }),
    c("tv_ori_ic", "g2", "2.2.5", "orientacoes", "Orientação de estágio, IC, monitoria, extensão, PET ou PIBID", 1, 20, { tipoRegex: "inicia|monitoria|est[áa]gio|extens|\\bpet\\b|pibid|tutoria" }),

    // ----- bancas (Grupo II) -----
    c("tv_ban_conc_bas", "g2", "2.3.2", "bancas", "Banca de concurso para a educação básica ou técnico-administrativo", 1, null, { textoRegex: "concurso.*(b[áa]sica|t[ée]cnico)|(b[áa]sica|t[ée]cnico).*concurso" }),
    c("tv_ban_qdoc", "g2", "2.3.1", "bancas", "Banca de qualificação de doutorado (como banca de doutorado)", 2, null, { tipoRegex: "qualifica.*doutorado" }),
    c("tv_ban_doc", "g2", "2.3.1", "bancas", "Banca de doutorado, livre-docência ou concurso do magistério superior", 2, null, { tipoRegex: "doutorado|livre-?doc|concurso" }),
    c("tv_ban_qmes", "g2", "2.3.2", "bancas", "Banca de qualificação de mestrado (como banca de mestrado)", 1, null, { tipoRegex: "qualifica.*mestrado" }),
    c("tv_ban_mes", "g2", "2.3.2", "bancas", "Banca de mestrado", 1, null, { tipoRegex: "mestrado" }),
    c("tv_ban_tcc", "g2", "2.3.3", "bancas", "Banca de TCC ou monografia", 0.5, 10, { tipoRegex: "gradua|tcc|monografia|conclus|est[áa]gio|especializa|inicia|monitoria" }),

    // ----- eventos e projetos (Grupo II) -----
    c("tv_coord_evento", "g3", "3.4.1", "eventos", "Coordenador de congressos, simpósios, seminários e similares", 0.5, 2, { tipoRegex: "organiza", textoRegex: "coordena|presid" }),
    c("tv_org_evento", "g2", "2.3.4", "eventos", "Comissão organizadora de congressos, simpósios e similares", 0.5, 5, { tipoRegex: "organiza" }),
    c("tv_proj_ext", "g2", "2.1.5", "projetos", "Outras atividades de ensino e extensão (projetos; por ano)", 1, null, { tipoRegex: "extens|ensino" }, "ano"),

    // ----- produções (Grupos II e III) -----
    c("tv_cursos_min", "g2", "2.1.3", "producoes", "Docência em disciplinas não regulares, cursos de extensão ou equivalentes", 0.5, 5, { tipoRegex: "^cursos?\\b|curso de curta|minicurso" }),
    c("tv_trad_art", "g3", "3.1.13", "producoes", "Tradução de artigo/trabalho", 1, 10, { tipoRegex: "tradu", textoRegex: "artigo|trabalho|paper" }),
    c("tv_trad_livro", "g3", "3.1.12", "producoes", "Tradução de livro na área de atuação", 3, null, { tipoRegex: "tradu" }),
    c("tv_resenha", "g3", "3.1.4", "producoes", "Artigo de atualização/divulgação, relato de experiência ou resenha", 1, 10, { tipoRegex: "resenha|relato|ponto de vista|atualiza" }),
    c("tv_jornal", "g3", "3.1.3", "producoes", "Artigo em jornal ou site eletrônico", 0.5, 5, { tipoRegex: "jornal|site|blog|m[íi]dias? socia|not[íi]cia" }),
    c("tv_revista_div", "g3", "3.1.2", "producoes", "Artigo em revista de divulgação técnica ou científica", 1, 10, { tipoRegex: "revista|divulga|magazine" }),
    c("tv_artigo", "g3", "3.1.1", "producoes", "Artigo em periódico com conselho editorial e revisão por pares", 10, null, { tipoRegex: "artigo" }),
    c("tv_anais_int", "g3", "3.1.5", "producoes", "Trabalho completo ou resumo expandido em evento internacional", 1, null, { tipoRegex: "complet|expandid|anais", textoRegex: "internac|international|world|mundial|latin|ibero|interameric" }),
    c("tv_anais_nac", "g3", "3.1.6", "producoes", "Trabalho completo ou resumo expandido em evento nacional", 0.5, null, { tipoRegex: "complet|expandid|anais" }),
    c("tv_resumo", "g3", "3.1.7", "producoes", "Resumo em anais de eventos", 0.5, 5, { tipoRegex: "resumo" }),
    c("tv_org_livro", "g3", "3.1.10", "producoes", "Organizador ou editor de coletânea", 3, null, { tipoRegex: "organiza|colet[âa]nea" }),
    { ...c("tv_capitulo", "g3", "3.1.11", "producoes", "Capítulo de livro (máx. 2 por livro)", 10, null, { tipoRegex: "cap[íi]tulo" }), porObra: 2 },
    c("tv_livro_rev", "g3", "3.1.14", "producoes", "Edição revisada de livro", 3, null, { tipoRegex: "livro", textoRegex: "edi[çc][ãa]o revisada|reedi[çc]" }),
    c("tv_livro_autor", "g3", "3.1.8", "producoes", "Autoria de livro de texto integral (autor único)", 25, null, { tipoRegex: "livro", autoresMax: 1 }),
    c("tv_livro_coautor", "g3", "3.1.9", "producoes", "Coautoria de livro de texto integral", 15, null, { tipoRegex: "livro" }),
    c("tv_palestra", "g3", "3.1.18", "producoes", "Palestra proferida (apresentação de autor único)", 1, 10, { tipoRegex: "palestra|confer[êe]ncia", autoresMax: 1 }),
    c("tv_apresentacao", "g3", "3.1.19", "producoes", "Apresentação oral ou de pôster em evento científico", 0.5, 5, { tipoRegex: "apresenta|trabalho|p[ôo]ster|palestra" }),
    c("tv_composicao", "g3", "3.3.1", "producoes", "Composição ou arranjo musical", 5, null, { tipoRegex: "composi|arranjo|partitura" }),
    c("tv_musica", "g3", "3.3.2", "producoes", "Apresentação musical", 1, null, { tipoRegex: "m[úu]sica|concerto|show" }),
    c("tv_restauracao", "g3", "3.3.3", "producoes", "Restauração de obra artística", 3, null, { tipoRegex: "restaura" }),
    c("tv_curadoria", "g3", "3.3.4", "producoes", "Curadoria de evento artístico", 5, null, { tipoRegex: "curadoria" }),
    c("tv_exposicao", "g3", "3.3.5", "producoes", "Exposição de artes visuais", 10, null, { tipoRegex: "exposi|artes visuais" }),
    c("tv_acervo", "g3", "3.3.6", "producoes", "Obra de arte em acervo", 3, null, { tipoRegex: "acervo" }),
    c("tv_tecnica_art", "g3", "3.3.8", "producoes", "Direção de fotografia ou de arte, trilha sonora, sonoplastia, cenário, figurino, iluminação e similares", 5, null, { tipoRegex: "fotografia|dire[çc][ãa]o de (arte|produ)|trilha|sonoplastia|cen[áa]rio|figurino|maquiagem|ilumina|prepara[çc][ãa]o (vocal|corporal)|assist[êe]ncia de dire" }),
    c("tv_elenco", "g3", "3.3.9", "producoes", "Elenco cinematográfico, cênico, performático ou coreográfico", 5, null, { tipoRegex: "elenco|ator|atriz|bailarin|int[ée]rprete|performer" }),
    c("tv_cenica", "g3", "3.3.7", "producoes", "Direção, dramaturgia, roteiro, produção ou coreografia", 10, null, { tipoRegex: "teatr|cinema|dramaturg|roteiro|coreograf|c[êe]nic" }),
    c("tv_festival", "g3", "3.3.10", "producoes", "Participação em festivais e mostras com obra artística", 1, null, { tipoRegex: "festival|mostra" }),
    c("tv_assessoria", "g3", "3.4.2", "producoes", "Assessoria técnica ou consultoria", 0.5, 2, { tipoRegex: "assessoria|consultoria|parecer|laudo" }),
    c("tv_insercao", "g3", "3.4.3", "producoes", "Atividade técnica de inserção social tecnológica (rádio/TV, popularização)", 0.5, 2, { tipoRegex: "r[áa]dio|\\btv\\b|televis|entrevista|populariza" }),
    c("tv_outros_tec", "g3", "3.4.5", "producoes", "Outros trabalhos técnicos ou profissionais (material didático, software...)", 0.5, 2, { tipoRegex: "material did[áa]tico|t[ée]cnic|relat[óo]rio|software|programa de computador" }),
    // ----- patentes e prêmios (Grupo III) -----
    c("tv_pat_lic", "g3", "3.1.17", "patentes", "Patente licenciada e produzindo", 5, null, { textoRegex: "licenciad" }),
    c("tv_pat_out", "g3", "3.1.16", "patentes", "Patente outorgada", 3, null, { textoRegex: "outorga|concedid|carta patente" }),
    c("tv_pat_dep", "g3", "3.1.15", "patentes", "Patente depositada", 2, null, { tipoRegex: "patente|modelo de utilidade" }),
    c("tv_software", "g3", "3.4.5", "patentes", "Outros trabalhos técnicos (programa de computador registrado)", 0.5, 2, { tipoRegex: "software|programa" }),
    c("tv_premio", "g3", "3.4.4", "dadosgerais", "Prêmio acadêmico", 2, 10, { tipoRegex: "pr[êe]mio|honra|distin" }),
    c("tv_relevantes", "g3", "3.4.6", "dadosgerais", "Outras atividades relevantes consideradas pela banca (até 5 pelo conjunto)", 1, 5, { tipoRegex: "relevant" }),
  ];
}

// ---------------------------------------------------------------------------
// UFSC — Professor Substituto: Anexo A da Portaria Normativa nº 154/2019/GR (prova de títulos)
// ---------------------------------------------------------------------------

export const UFSC_SUBSTITUTO_GRUPOS = [
  { id: "s1", name: "Grupo I – Títulos acadêmicos", cap: null, pick: "max", allYears: true },
  { id: "s2", name: "Grupo II – Atividades de ensino", cap: null, allYears: true },
  { id: "s3", name: "Grupo III – Atividades de pesquisa, de extensão e profissionais", cap: null },
  { id: "s4", name: "Grupo IV – Outras atividades", cap: null, allYears: true },
  // Observação geral 2 do Anexo A: a critério da comissão, até 5 pontos no conjunto
  { id: "s5", name: "Outras atividades relevantes (a critério da comissão)", cap: 5, allYears: true },
];

/** Itens do Anexo A mapeados para as categorias e os tipos do Lattes (1º critério que atender). */
function ufscSubstitutoRules() {
  const c = (id, group, item, category, label, weight, cap, match, base) => ({
    id, group, item, category, label, weight, cap, match, ...(base ? { base } : {}),
  });
  const NAO_CURSO = "curta|extens|aperfei|atualiza|complementar";
  const CONCLUIDA = { situacao: "^(?!.*andamento)" };
  return [
    // formação que pontua no Grupo II (antes dos títulos, para não contar como título)
    c("ps_monitoria", "s2", "II.4", "formacao", "Exercício de monitoria (por semestre)", 0.5, null, { textoRegex: "monitoria|monitor" }),
    c("ps_estagio_doc", "s2", "II.5", "formacao", "Estágio de docência", 0.5, null, { textoRegex: "est[áa]gio (de |em )?doc[êe]ncia" }),
    c("ps_reuni", "s2", "II.6", "formacao", "Programa de apoio pedagógico – Bolsa REUNI (por semestre)", 0.5, null, { textoRegex: "\\breuni\\b" }),
    // ----- Grupo I – títulos (vale só o de maior pontuação) -----
    c("ps_doutorado", "s1", "I.1", "formacao", "Doutorado", 200, null, { textoRegex: "doutorado", textoNotRegex: "p[óo]s-?doutor", tipoNotRegex: NAO_CURSO }),
    c("ps_mestrado", "s1", "I.2", "formacao", "Mestrado", 150, null, { textoRegex: "mestrado", tipoNotRegex: NAO_CURSO }),
    c("ps_especializacao", "s1", "I.3", "formacao", "Especialização ou residência (mín. 360 h)", 50, null, { textoRegex: "especializa|resid[êe]ncia", tipoNotRegex: NAO_CURSO }),
    c("ps_graduacao", "s1", "I.4", "formacao", "Graduação", 25, null, { textoRegex: "gradua[çc][ãa]o|bacharel|licenciatura", tipoNotRegex: NAO_CURSO }),
    // ----- Grupo II – atividades de ensino -----
    c("ps_doc_basica", "s2", "II.2", "atuacao", "Docência na educação básica (1 ponto por ano)", 1, null, { tipoRegex: "encargo|disciplina|doc[êe]ncia|magist|professor", textoRegex: "educa[çc][ãa]o b[áa]sica|ensino (m[ée]dio|fundamental)" }, "ano"),
    c("ps_doc_superior", "s2", "II.1", "atuacao", "Docência no ensino superior (2 pontos por ano)", 2, null, { tipoRegex: "encargo|disciplina|doc[êe]ncia|magist" }, "ano"),
    c("ps_estagio_doc_at", "s2", "II.5", "atuacao", "Estágio de docência", 0.5, null, { textoRegex: "est[áa]gio (de |em )?doc[êe]ncia" }),
    c("ps_reuni_at", "s2", "II.6", "atuacao", "Programa de apoio pedagógico – Bolsa REUNI (por semestre)", 0.5, null, { textoRegex: "\\breuni\\b" }),
    c("ps_concurso", "s2", "II.17", "atuacao", "Aprovação em concurso para a carreira do magistério superior", 0.4, null, { textoRegex: "aprova.*concurso|concurso.*aprova" }),
    c("ps_cursos", "s2", "II.3", "producoes", "Cursos de curta duração ministrados (até 2 pontos pelo conjunto, mín. 4 atividades)", 0.5, 2, { tipoRegex: "^cursos?\\b|curso de curta|minicurso" }),
    c("ps_ori_tese", "s2", "II.7", "orientacoes", "Orientação concluída – tese", 2, null, { tipoRegex: "doutorado|tese", tipoNotRegex: "p[óo]s-?doutor", campos: CONCLUIDA }),
    c("ps_ori_diss", "s2", "II.8", "orientacoes", "Orientação concluída – dissertação", 1, null, { tipoRegex: "mestrado|disserta", campos: CONCLUIDA }),
    c("ps_ori_esp", "s2", "II.9", "orientacoes", "Orientação concluída – especialização", 0.5, null, { tipoRegex: "especializa", campos: CONCLUIDA }),
    c("ps_ori_tcc", "s2", "II.10", "orientacoes", "Orientação concluída – TCC, estágio, PET, monitoria, tutoria e similares", 0.25, null, { tipoRegex: "conclus|tcc|monografia|est[áa]gio|\\bpet\\b|monitoria|tutoria|inicia|extens|pibid", campos: CONCLUIDA }),
    c("ps_ban_qdoc", "s2", "II.11", "bancas", "Banca de qualificação de doutorado (como banca de doutorado)", 0.5, null, { tipoRegex: "qualifica.*doutorado" }),
    c("ps_ban_doc", "s2", "II.11", "bancas", "Banca examinadora – doutorado", 0.5, null, { tipoRegex: "doutorado" }),
    c("ps_ban_qmes", "s2", "II.12", "bancas", "Banca de qualificação de mestrado (como banca de mestrado)", 0.4, null, { tipoRegex: "qualifica.*mestrado" }),
    c("ps_ban_mes", "s2", "II.12", "bancas", "Banca examinadora – mestrado", 0.4, null, { tipoRegex: "mestrado" }),
    c("ps_ban_esp", "s2", "II.13", "bancas", "Banca examinadora – especialização", 0.2, null, { tipoRegex: "especializa" }),
    c("ps_ban_grad", "s2", "II.14", "bancas", "Banca examinadora – graduação", 0.2, null, { tipoRegex: "gradua|tcc|monografia|conclus|est[áa]gio|inicia|monitoria" }),
    // ----- Grupo III – pesquisa, extensão e profissionais (últimos dez anos) -----
    c("ps_livro", "s3", "III.1", "producoes", "Autoria de livro (até 10 pontos por livro)", 10, null, { tipoRegex: "livro", tipoNotRegex: "cap[íi]tulo" }),
    c("ps_capitulo", "s3", "III.2", "producoes", "Autoria de capítulo de livro", 1, null, { tipoRegex: "cap[íi]tulo" }),
    c("ps_artigo", "s3", "III.3", "producoes", "Trabalho publicado em periódico indexado", 1, null, { tipoRegex: "artigo" }),
    c("ps_anais", "s3", "III.4", "producoes", "Trabalho completo publicado em anais de congresso", 0.5, null, { tipoRegex: "complet|expandid|anais" }),
    c("ps_resumo", "s3", "III.5", "producoes", "Resumo publicado em anais de congresso", 0.1, null, { tipoRegex: "resumo" }),
    c("ps_poster", "s3", "III.7", "producoes", "Apresentação de pôster em evento científico", 0.1, null, { tipoRegex: "apresenta|trabalho|p[ôo]ster|palestra", textoRegex: "p[ôo]ster|painel" }),
    c("ps_oral", "s3", "III.6", "producoes", "Apresentação oral de trabalho em evento científico", 0.2, null, { tipoRegex: "apresenta|trabalho|palestra|comunica" }),
    c("ps_rel_pesq", "s3", "III.8", "projetos", "Relatório final de pesquisa financiada (até 3 pontos pelo conjunto)", 1, 3, { tipoRegex: "pesquisa" }),
    c("ps_rel_ext", "s3", "III.9", "projetos", "Relatório final de projeto de extensão (até 3 pontos pelo conjunto)", 1, 3, { tipoRegex: "extens" }),
    c("ps_bolsa", "s3", "III.10", "atuacao", "Bolsa (CAPES, CNPq ou similar) para pesquisa ou extensão (por modalidade)", 0.25, null, { textoRegex: "bolsista|bolsa (de )?(produtividade|pq|dt|extens|pesquisa)" }),
    // ----- Grupo IV – outras atividades -----
    c("ps_editorial", "s4", "IV.2", "atuacao", "Consultor de revista ou membro de corpo editorial (por revista)", 1, null, { tipoRegex: "revisor|parecer|editorial|consultor" }),
    c("ps_tecnicos", "s4", "IV.1", "producoes", "Trabalhos de natureza técnica ou profissional (até 3 pontos pelo conjunto)", 0.5, 3, { tipoRegex: "material did[áa]tico|t[ée]cnic|relat[óo]rio|software|programa de computador|r[áa]dio|\\btv\\b|consultoria|assessoria|laudo" }),
    c("ps_tecnicos_sw", "s4", "IV.1", "patentes", "Trabalhos de natureza técnica (programa de computador, patente)", 0.5, 3, { fallback: true }),
    c("ps_relevantes", "s5", "Obs. 2", "dadosgerais", "Outras atividades consideradas relevantes pela comissão (até 5 pelo conjunto)", 1, 5, { tipoRegex: "relevant" }),
    c("ps_premio", "s4", "IV.3", "dadosgerais", "Prêmio e mérito profissional ou acadêmico (até 2 pontos)", 2, 2, { tipoRegex: "pr[êe]mio|honra|distin|m[ée]rito" }),
  ];
}

export function baseRules(overrides = {}) {
  const defaults = [
    // Produções (ordem importa para evitar colisão com livros/anais/fallback)
    { id: "prod_a1", label: "Artigo Qualis A1", category: "producoes", match: { qualis: "A1", tipoNotRegex: "livro|cap[íi]tulo|anais|resumo" }, weight: 10, cap: null },
    { id: "prod_a2", label: "Artigo Qualis A2", category: "producoes", match: { qualis: "A2", tipoNotRegex: "livro|cap[íi]tulo|anais|resumo" }, weight: 8.5, cap: null },
    { id: "prod_a3", label: "Artigo Qualis A3", category: "producoes", match: { qualis: "A3", tipoNotRegex: "livro|cap[íi]tulo|anais|resumo" }, weight: 7, cap: null },
    { id: "prod_a4", label: "Artigo Qualis A4", category: "producoes", match: { qualis: "A4", tipoNotRegex: "livro|cap[íi]tulo|anais|resumo" }, weight: 5.5, cap: null },
    { id: "prod_b1", label: "Artigo Qualis B1", category: "producoes", match: { qualis: "B1", tipoNotRegex: "livro|cap[íi]tulo|anais|resumo" }, weight: 4, cap: null },
    { id: "prod_b2", label: "Artigo Qualis B2", category: "producoes", match: { qualis: "B2", tipoNotRegex: "livro|cap[íi]tulo|anais|resumo" }, weight: 3, cap: null },
    { id: "prod_b3", label: "Artigo Qualis B3", category: "producoes", match: { qualis: "B3", tipoNotRegex: "livro|cap[íi]tulo|anais|resumo" }, weight: 2, cap: null },
    { id: "prod_b4", label: "Artigo Qualis B4", category: "producoes", match: { qualis: "B4", tipoNotRegex: "livro|cap[íi]tulo|anais|resumo" }, weight: 1, cap: null },
    { id: "prod_livro", label: "Livros publicados / organizados", category: "producoes", match: { tipoRegex: "livro", tipoNotRegex: "cap[íi]tulo" }, weight: 10, cap: 20 },
    { id: "prod_cap", label: "Capítulos de livros", category: "producoes", match: { tipoRegex: "cap[íi]tulo" }, weight: 4, cap: 16 },
    { id: "prod_anais", label: "Trabalhos completos / resumos em anais", category: "producoes", match: { tipoRegex: "anais|congresso|resumo|evento" }, weight: 1.5, cap: 15 },
    { id: "prod_c_art", label: "Artigos C / Sem Qualis (SQ)", category: "producoes", match: { tipoRegex: "artigo" }, weight: 0.5, cap: 5 },
    { id: "prod_outros", label: "Outras produções bibliográficas/técnicas", category: "producoes", match: { fallback: true }, weight: 1, cap: 10 },
    // Orientações
    { id: "ori_doc", label: "Orientação de Doutorado", category: "orientacoes", match: { tipoRegex: "doutorado" }, weight: 8, cap: null },
    { id: "ori_mes", label: "Orientação de Mestrado", category: "orientacoes", match: { tipoRegex: "mestrado" }, weight: 5, cap: null },
    { id: "ori_outros", label: "Orientações Pós-Doc / Especialização / TCC / IC", category: "orientacoes", match: { fallback: true }, weight: 2, cap: 16 },
    // Projetos & Inovação
    { id: "proj", label: "Projetos de Pesquisa / Extensão", category: "projetos", match: { fallback: true }, weight: 5, cap: 20 },
    { id: "pat", label: "Patentes e Registros", category: "patentes", match: { fallback: true }, weight: 8, cap: null },
    { id: "inov", label: "Produções de Inovação / Software", category: "inovacao", match: { fallback: true }, weight: 4, cap: 16 },
    // Bancas
    { id: "ban_doc", label: "Bancas de Doutorado", category: "bancas", match: { tipoRegex: "doutorado" }, weight: 3, cap: 15 },
    { id: "ban_mes", label: "Bancas de Mestrado", category: "bancas", match: { tipoRegex: "mestrado" }, weight: 2, cap: 12 },
    { id: "ban_outros", label: "Outras Bancas (TCC / Qualificação / Concursos)", category: "bancas", match: { fallback: true }, weight: 1, cap: 10 },
    // Atuação & Ensino
    { id: "atu_gestao", label: "Direção / Chefia / Coordenação", category: "atuacao", match: { tipoRegex: "dire[cç][aã]o|chefia|coordena[cç][aã]o" }, weight: 6, cap: 18 },
    { id: "atu_ensino", label: "Encargos de Ensino (Graduação / Pós-Graduação)", category: "atuacao", match: { tipoRegex: "encargo|ensino|disciplina" }, weight: 3, cap: 24 },
    { id: "atu_outros", label: "Comissões / Corpo Editorial / Revisor / Supervisão", category: "atuacao", match: { fallback: true }, weight: 1.5, cap: 12 },
    // Eventos & Popularização
    { id: "evt", label: "Participação em Eventos", category: "eventos", match: { fallback: true }, weight: 1, cap: 8 },
    { id: "edu", label: "Educação e Popularização de C&T", category: "educacao_popularizacao", match: { fallback: true }, weight: 1.5, cap: 10 },
  ];

  return defaults.map((d) => {
    const ov = overrides[d.id];
    return ov ? { ...d, weight: ov.weight ?? d.weight, cap: "cap" in ov ? ov.cap : d.cap } : d;
  });
}

export const DEFAULT_BAREMAS = {
  ufsc_rn114: {
    id: "ufsc_rn114",
    name: "UFSC – Progressão / Promoção Docente (RN 114/2017/CUn)",
    mode: "rn114", // unidades por tabela → Tabela 4 → pontos
    semesters: 4,
    regime: "DE",
    yearFrom: CUR_YEAR - 2,
    yearTo: CUR_YEAR,
    goal: 40,
    onlyWithProof: true,
    rules: rn114Rules(),
  },
  ufsc_concurso: {
    id: "ufsc_concurso",
    name: "UFSC – Concurso Docente (Tabela de Valoração de Títulos)",
    yearFrom: CUR_YEAR - 10, // grupos II a IV: últimos dez anos (exceto concurso para titular)
    yearTo: CUR_YEAR,
    goal: 0, // classificatório: sem meta
    onlyWithProof: false,
    groups: UFSC_CONCURSO_GRUPOS,
    rules: ufscConcursoRules(),
  },
  ufsc_substituto: {
    id: "ufsc_substituto",
    name: "UFSC – Professor Substituto: Prova de Títulos (Portaria Normativa 154/2019/GR)",
    yearFrom: CUR_YEAR - 10, // Grupo III: últimos dez anos; os demais grupos valem de qualquer ano
    yearTo: CUR_YEAR,
    goal: 0, // classificatório: nota = 3G + 7 × pontos ÷ maior pontuação entre os candidatos
    onlyWithProof: false,
    groups: UFSC_SUBSTITUTO_GRUPOS,
    rules: ufscSubstitutoRules(),
  },
  cnpq_pq: {
    id: "cnpq_pq",
    name: "Bolsa Produtividade CNPq (PQ — 5 anos)",
    yearFrom: CUR_YEAR - 5,
    yearTo: CUR_YEAR,
    goal: 100,
    onlyWithProof: false,
    rules: baseRules({
      prod_a1: { weight: 15, cap: null },
      prod_a2: { weight: 12, cap: null },
      prod_a3: { weight: 9, cap: null },
      prod_a4: { weight: 7, cap: null },
      prod_b1: { weight: 4, cap: 20 },
      prod_b2: { weight: 2, cap: 10 },
      prod_b3: { weight: 1, cap: 5 },
      prod_b4: { weight: 0.5, cap: 3 },
      ori_doc: { weight: 12, cap: null },
      ori_mes: { weight: 6, cap: 30 },
      ori_outros: { weight: 2, cap: 10 },
      pat: { weight: 12, cap: null },
      atu_ensino: { weight: 1, cap: 10 },
      evt: { weight: 0.5, cap: 5 },
    }),
  },
  concurso_titular: {
    id: "concurso_titular",
    name: "Concurso / Promoção Titular (Carreira)",
    yearFrom: "",
    yearTo: "",
    goal: 150,
    onlyWithProof: false,
    rules: baseRules({
      prod_a1: { weight: 12, cap: null },
      prod_a2: { weight: 10, cap: null },
      prod_a3: { weight: 8, cap: null },
      prod_a4: { weight: 6, cap: null },
      ori_doc: { weight: 10, cap: null },
      ori_mes: { weight: 6, cap: null },
      proj: { weight: 6, cap: 30 },
      pat: { weight: 10, cap: null },
      atu_gestao: { weight: 8, cap: 24 },
      atu_ensino: { weight: 2, cap: 30 },
    }),
  },
};

export function matchesRule(rec, rule) {
  const m = rule.match || {};
  if (m.fallback) return true;
  const qualis = String(rec.qualis || "").trim().toUpperCase();
  const tipo = String(rec.tipo || "").trim();

  if (m.qualis && qualis !== String(m.qualis).trim().toUpperCase()) {
    return false;
  }
  if (m.qualisRegex) {
    try {
      if (!new RegExp(m.qualisRegex, "i").test(qualis)) return false;
    } catch {
      return false;
    }
  }
  if (m.tipoNotRegex) {
    try {
      if (new RegExp(m.tipoNotRegex, "i").test(tipo)) return false;
    } catch {
      // ignore invalid user regex
    }
  }
  if (m.tipoRegex) {
    try {
      if (!new RegExp(m.tipoRegex, "i").test(tipo)) return false;
    } catch {
      return false;
    }
  }
  // texto do registro (tipo, título, descrição, disciplina, periódico/evento, instituição)
  if (m.textoRegex || m.textoNotRegex) {
    const texto = [rec.tipo, rec.titulo, rec.descricao, rec.disciplina, rec.journal, rec.instituicao].filter(Boolean).join(" · ");
    try {
      if (m.textoRegex && !new RegExp(m.textoRegex, "i").test(texto)) return false;
      if (m.textoNotRegex && new RegExp(m.textoNotRegex, "i").test(texto)) return false;
    } catch {
      return false;
    }
  }
  // outros campos: { papel: "coorient", situacao: "conclu" }
  if (m.campos && typeof m.campos === "object") {
    for (const [campo, re] of Object.entries(m.campos)) {
      try {
        if (!new RegExp(re, "i").test(String(rec[campo] ?? ""))) return false;
      } catch {
        return false;
      }
    }
  }
  if (m.horasMin != null && m.horasMin !== "") {
    const h = Number(String(rec.horas ?? "").replace(",", ".")) || 0;
    if (h < Number(m.horasMin)) return false;
  }
  if (m.autoresMax != null && m.autoresMax !== "") {
    const n = countAuthors(rec.autores);
    if (n > Number(m.autoresMax)) return false;
  }
  return true;
}

/** Nº de autores: lista JSON [{nome}] do Lattes ou texto separado por ";". */
function countAuthors(a) {
  if (Array.isArray(a)) return a.length;
  const t = String(a || "").trim();
  if (!t) return 0;
  if (t.startsWith("[")) {
    try {
      const arr = JSON.parse(t);
      if (Array.isArray(arr)) return arr.length;
    } catch {
      // texto comum
    }
  }
  return t.split(";").map((x) => x.trim()).filter(Boolean).length;
}

export function recordHasProof(r) {
  return Boolean((r.path && String(r.path).trim()) || (Array.isArray(r.attachments) && r.attachments.length > 0));
}

/**
 * Baremas disponíveis: os modelos padrão (com as personalizações salvas por cima) e, depois deles,
 * os baremas criados pelo usuário (`custom: true`), todos guardados em `score_baremas`.
 */
export function resolveBaremas(saved) {
  const s = saved && typeof saved === "object" ? saved : {};
  const padrao = Object.values(DEFAULT_BAREMAS).map((def) => {
    const custom = s[def.id];
    if (custom && Array.isArray(custom.rules)) return { ...def, ...custom, id: def.id, custom: false, rules: cloneRules(custom.rules) };
    // modelo padrão sem personalização: só os documentos anexados ficam guardados
    return { ...def, ...(Array.isArray(custom?.docs) ? { docs: custom.docs } : {}), rules: cloneRules(def.rules) };
  });
  const proprios = Object.entries(s)
    .filter(([id, b]) => !DEFAULT_BAREMAS[id] && b && Array.isArray(b.rules))
    .map(([id, b]) => ({ ...b, id, custom: true, name: b.name || "Barema sem nome", rules: cloneRules(b.rules) }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"));
  return [...padrao, ...proprios];
}

/** O barema é um dos criados pelo usuário (e não um modelo padrão)? */
export const isUserBarema = (id) => !DEFAULT_BAREMAS[id];

/**
 * Pontua os registros pelo barema: cada registro conta no primeiro critério da sua categoria que
 * atender e gera FM × base (item ou horas).
 *  - modo "soma" (padrão): o teto limita cada critério; os grupos são as categorias.
 *  - modo "rn114" (UFSC): os grupos são as Tabelas 1 (Ensino) e 2 (Pesquisa/Extensão); em cada uma,
 *    u = unidades ÷ semestres → p(u) pela Tabela 4 → × semestres ÷ 4.
 *  - modo "grupos" (barema com `groups`): os grupos são os da tabela (Grupo I, II...), cada um com
 *    teto próprio, opção "vale só o maior" e opção de ignorar o período; critérios com o mesmo
 *    código de item dividem o teto; base "ano" = peso × anos distintos cobertos no período.
 * `period` ({from, to}) filtra os registros pelo ano (exceto nos grupos com allYears).
 * Devolve { barema, mode, goal, onlyWithProof, totalRaw, totalCapped, groups, items, byRule, rn114 }.
 */
export function scoreRecords(barema, recordsByCat, { onlyWithProof = Boolean(barema.onlyWithProof), period = null } = {}) {
  const rn = barema.mode === "rn114";
  const grpDefs = !rn ? cloneGroups(barema.groups) : [];
  const grouped = grpDefs.length > 0;
  const grpById = new Map(grpDefs.map((g) => [g.id, g]));
  // período (anos inteiros); grupos com allYears ignoram o filtro
  const per = period && (period.from != null || period.to != null)
    ? { from: period.from != null && period.from !== "" ? Number(period.from) : null, to: period.to != null && period.to !== "" ? Number(period.to) : null }
    : null;
  const inPeriod = (rec, cat) => {
    if (!per) return true;
    if (rec.ano == null || rec.ano === "") return false;
    const a = Number(rec.ano);
    const b = rec.ano_fim != null && rec.ano_fim !== "" ? Number(rec.ano_fim) : fimAberto(cat, a, rec);
    return !(per.from != null && b < per.from) && !(per.to != null && a > per.to);
  };

  const rulesByCat = {};
  for (const rule of barema.rules) (rulesByCat[rule.category] ||= []).push(rule);
  const novoAcum = (r) => ({ rule: r, items: [], raw: 0, pts: 0, years: new Set(), obras: new Map() });
  const byRule = new Map(barema.rules.map((r) => [r.id, novoAcum(r)]));
  // grupo que recebe as atividades anteriores ao período (cada critério ganha uma cópia nele)
  const grupoAntes = grouped && per?.from != null ? grpDefs.find((g) => g.before) : null;
  const antesDoPeriodo = (rec, cat) => {
    const a = Number(rec.ano);
    if (!Number.isFinite(a) || a <= 0) return false;
    const b = rec.ano_fim != null && rec.ano_fim !== "" ? Number(rec.ano_fim) : fimAberto(cat, a, rec);
    return b < per.from;
  };
  const regraAntes = (r) => {
    const id = `${r.id}@antes`;
    if (!byRule.has(id)) {
      byRule.set(id, novoAcum({ ...r, id, group: grupoAntes.id, item: r.item ? `${r.item}*` : undefined, label: `${r.label} (anterior ao período)` }));
    }
    return byRule.get(id).rule;
  };
  const items = [];
  for (const [cat, rows] of Object.entries(recordsByCat || {})) {
    const catRules = rulesByCat[cat];
    if (!catRules) continue;
    // base "× anos": em ordem cronológica, cada ano conta uma vez por critério
    const ordered = [...(rows || [])].sort((a, b) => (Number(a.ano) || 0) - (Number(b.ano) || 0));
    for (const rec of ordered) {
      if (onlyWithProof && !recordHasProof(rec)) continue;
      const match = catRules.find((r) => matchesRule(rec, r));
      if (!match) continue;
      let rule = match;
      let allYears = grouped && grpById.get(rule.group)?.allYears;
      if (!allYears && !inPeriod(rec, cat)) {
        // anterior ao período: vai para o grupo que recebe as atividades anteriores, se houver
        if (!grupoAntes || !antesDoPeriodo(rec, cat)) continue;
        rule = regraAntes(match);
        allYears = true;
      }
      const b = byRule.get(rule.id);
      let pts;
      let anos = null;
      if ((rule.base || "item") === "ano") {
        const novos = yearsOf(rec, allYears ? null : per, cat).filter((y) => !b.years.has(y));
        novos.forEach((y) => b.years.add(y));
        anos = novos.length;
        pts = Number(rule.weight || 0) * anos;
      } else {
        pts = unitsOf(rec, rule, cat, allYears ? null : per);
      }
      const it = { category: cat, id: rec.id, ruleId: rule.id, ruleLabel: rule.label, pts, titulo: rec.titulo || rec.descricao || rec.disciplina || "", ano: rec.ano, rec, ...(anos != null ? { anos } : {}) };
      // no máximo N por obra (ex.: 2 capítulos por livro); sem o título da obra, não há como limitar
      const obra = rule.porObra ? String(rec.journal || "").trim().toLowerCase().replace(/\s+/g, " ") : "";
      if (obra && obra !== "none") {
        const n = (b.obras.get(obra) || 0) + 1;
        b.obras.set(obra, n);
        if (n > rule.porObra) {
          it.note = `não considerado: máximo de ${rule.porObra} por obra`;
          it.pts = pts = 0;
        }
      }
      b.items.push(it);
      b.raw += pts;
      items.push(it);
    }
  }

  // tetos: critérios com o mesmo código de item dividem o teto (o primeiro teto definido)
  const capOf = (r) => (r.cap != null && r.cap !== "" ? Number(r.cap) : null);
  if (rn) {
    for (const b of byRule.values()) b.pts = b.raw;
  } else {
    const shared = new Map();
    for (const b of byRule.values()) {
      const key = b.rule.item ? `item:${b.rule.item}` : `id:${b.rule.id}`;
      if (!shared.has(key)) shared.set(key, { cap: null, left: null });
      const s = shared.get(key);
      if (s.cap == null && capOf(b.rule) != null) s.cap = s.left = capOf(b.rule);
    }
    for (const b of byRule.values()) {
      const s = shared.get(b.rule.item ? `item:${b.rule.item}` : `id:${b.rule.id}`);
      if (s.cap == null) b.pts = b.raw;
      else {
        b.pts = Math.min(b.raw, Math.max(0, s.left));
        s.left -= b.pts;
      }
    }
  }

  // grupo "vale só o maior": mantém apenas o item de maior pontuação do grupo
  if (grouped) {
    for (const g of grpDefs.filter((x) => x.pick === "max")) {
      const bs = [...byRule.values()].filter((b) => b.rule.group === g.id && b.items.length);
      let best = null;
      for (const b of bs) for (const it of b.items) if (!best || it.pts > best.it.pts) best = { b, it };
      for (const b of bs) {
        for (const it of b.items) {
          if (best && it === best.it) continue;
          if (it.pts > 0) it.note = "não considerado: vale só o de maior pontuação do grupo";
          it.pts = 0;
        }
        b.pts = best && best.b === b ? Math.min(best.it.pts, capOf(b.rule) ?? Infinity) : 0;
      }
    }
  }

  const ruleRow = (b) => ({
    id: b.rule.id,
    label: b.rule.label,
    qtd: b.items.length,
    weight: Number(b.rule.weight || 0),
    base: b.rule.base || "item",
    raw: b.raw,
    cap: rn ? null : capOf(b.rule),
    pts: b.pts,
    ...(b.rule.item ? { item: b.rule.item } : {}),
    ...((b.rule.base || "item") === "ano" ? { anos: b.items.reduce((s, it) => s + (it.anos || 0), 0) } : {}),
  });

  const groups = [];
  let totalRaw = 0;
  let totalCapped = 0;
  let conv = null;
  if (rn) {
    const sem = Math.max(1, Number(barema.semesters) || 4);
    const tabs = {};
    for (const b of byRule.values()) {
      if (!b.items.length) continue;
      const key = b.rule.table === "ensino" ? "ensino" : "pesquisa";
      const g = (tabs[key] ||= { cat: key, name: RN114_TABELAS[key].name, color: RN114_TABELAS[key].color, qtd: 0, raw: 0, pts: 0, rules: [] });
      g.qtd += b.items.length;
      g.raw += b.pts;
      g.rules.push(ruleRow(b));
    }
    for (const key of ["ensino", "pesquisa"]) {
      const g = tabs[key];
      if (!g) continue;
      const u = g.raw / sem;
      const pu = rn114Pontos(u);
      g.pts = (pu * sem) / 4;
      g.conv = { t: g.raw, u, pu, sem };
      groups.push(g);
      totalCapped += g.pts;
    }
    totalRaw = totalCapped;
    const regime = String(barema.regime || "DE");
    const min = Number(barema.goal) || (regime === "20" ? 20 : 40);
    const ensino = tabs.ensino?.pts || 0;
    const ensinoMin = regime === "20" ? min : min / 2;
    conv = { semesters: sem, regime, ensino, pesquisa: tabs.pesquisa?.pts || 0, ensinoMin, ensinoOk: ensino >= ensinoMin };
  } else if (grouped) {
    // grupos da tabela do barema, na ordem definida; critérios sem grupo vão para "Outros"
    const byG = new Map();
    const order = [...grpDefs.map((g) => g.id), "__outros"];
    for (const b of byRule.values()) {
      if (!b.items.length) continue;
      const gid = grpById.has(b.rule.group) ? b.rule.group : "__outros";
      if (!byG.has(gid)) {
        const def = grpById.get(gid);
        const idx = order.indexOf(gid);
        byG.set(gid, {
          cat: gid,
          name: def?.name || "Outros",
          color: GROUP_COLORS[idx % GROUP_COLORS.length],
          groupCap: def?.cap ?? null,
          pick: def?.pick || "sum",
          allYears: Boolean(def?.allYears),
          before: Boolean(def?.before),
          qtd: 0, raw: 0, pts: 0, rules: [],
        });
      }
      const g = byG.get(gid);
      g.qtd += b.items.length;
      g.raw += b.raw;
      g.pts += b.pts;
      g.rules.push(ruleRow(b));
    }
    for (const gid of order) {
      const g = byG.get(gid);
      if (!g) continue;
      g.sum = g.pts; // soma dos critérios (com os tetos dos itens)
      if (g.groupCap != null && g.pts > g.groupCap) g.pts = g.groupCap;
      totalRaw += g.raw;
      totalCapped += g.pts;
      groups.push(g);
    }
  } else {
    const byCat = new Map();
    for (const b of byRule.values()) {
      if (!b.items.length) continue;
      totalRaw += b.raw;
      totalCapped += b.pts;
      if (!byCat.has(b.rule.category)) {
        const s = CATEGORY_SCHEMAS[b.rule.category];
        const g = { cat: b.rule.category, name: s?.group || s?.name || b.rule.category, qtd: 0, raw: 0, pts: 0, rules: [] };
        byCat.set(b.rule.category, g);
        groups.push(g);
      }
      const g = byCat.get(b.rule.category);
      g.qtd += b.items.length;
      g.raw += b.raw;
      g.pts += b.pts;
      g.rules.push(ruleRow(b));
    }
  }
  return {
    barema: barema.name,
    mode: rn ? "rn114" : grouped ? "grupos" : "soma",
    goal: Number(barema.goal) || 0,
    onlyWithProof,
    totalRaw,
    totalCapped,
    groups,
    items,
    byRule: [...byRule.values()],
    rn114: conv,
  };
}
