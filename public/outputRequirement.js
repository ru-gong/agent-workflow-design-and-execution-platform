export const OUTPUT_REQUIREMENT_OPTIONS = [
  ["ppt", "PPT / Presentation"],
  ["html", "HTML / Web Page"],
  ["markdown", "MD 文档 / Markdown"],
  ["spreadsheet", "表格 / Spreadsheet"],
  ["image", "图片 / Image"],
  ["pdf", "PDF / PDF"],
  ["docx", "Word 文档 / DOCX"],
  ["other", "其他 / Other"]
];

export const OUTPUT_REQUIREMENT_GUIDANCE = {
  ppt: "输出中文 PPT 汇报材料，建议 8-12 页，包含封面、核心结论、关键证据、风险判断和行动建议，适合研发、战略或供应链团队评审。",
  html: "输出中文 HTML 单页报告，包含清晰导航、关键结论、证据区、风险判断和行动建议，并产出可直接打开的 HTML 文件。",
  markdown: "输出中文 Markdown 深度研究报告，包含摘要、结构化分析、证据、结论和行动建议，适合研发、战略或供应链团队评审。",
  spreadsheet: "输出中文表格型交付物，包含关键数据、对比维度、评分/判断、备注和后续行动建议，并产出表格文件或 CSV/XLSX。",
  image: "输出中文图片型交付物，明确画面主题、关键标注、信息层级和用途，并产出可查看的图片文件。",
  pdf: "输出中文 PDF 报告，包含封面、目录、摘要、正文、结论和行动建议，并产出可直接分发的 PDF 文件。",
  docx: "输出中文 Word 文档，包含标题、摘要、正文、表格/清单、结论和行动建议，并产出 DOCX 文件。",
  other: "按人工补充要求输出指定交付物，明确文件格式、内容结构、受众、验收标准和产物路径。"
};

export function defaultOutputRequirement() {
  return { type: "markdown", custom: "" };
}

export function normalizeOutputRequirement(value = {}) {
  const aliases = {
    ppt: "ppt",
    powerpoint: "ppt",
    slides: "ppt",
    deck: "ppt",
    html: "html",
    webpage: "html",
    web: "html",
    md: "markdown",
    markdown: "markdown",
    document: "markdown",
    doc: "markdown",
    table: "spreadsheet",
    spreadsheet: "spreadsheet",
    xlsx: "spreadsheet",
    csv: "spreadsheet",
    image: "image",
    picture: "image",
    png: "image",
    pdf: "pdf",
    word: "docx",
    docx: "docx",
    other: "other"
  };
  const rawType = typeof value === "string" ? value : value?.type;
  const type = aliases[String(rawType || "").trim().toLowerCase()] || "markdown";
  return {
    type,
    custom: String(typeof value === "object" && value ? value.custom || "" : "").slice(0, 600)
  };
}

export function outputRequirementGuidance(type) {
  return OUTPUT_REQUIREMENT_GUIDANCE[normalizeOutputRequirement(type).type] || OUTPUT_REQUIREMENT_GUIDANCE.markdown;
}

export function customForOutputRequirementTypeChange(previousRequirement, nextType) {
  const previous = normalizeOutputRequirement(previousRequirement);
  const type = normalizeOutputRequirement(nextType).type;
  const custom = String(previous.custom || "").trim();
  if (!custom || isKnownOutputGuidance(custom) || outputRequirementCustomConflictsWithType(custom, type)) {
    return outputRequirementGuidance(type);
  }
  return custom;
}

function normalizeGuidanceText(text) {
  return String(text || "").replace(/\s+/g, "").trim();
}

function isKnownOutputGuidance(text) {
  const normalized = normalizeGuidanceText(text);
  return Object.values(OUTPUT_REQUIREMENT_GUIDANCE).some((item) => normalizeGuidanceText(item) === normalized);
}

function outputRequirementCustomConflictsWithType(text, type) {
  const normalizedType = normalizeOutputRequirement(type).type;
  const value = String(text || "").toLowerCase();
  const formatHints = {
    ppt: /(ppt|powerpoint|幻灯|演示文稿|汇报材料|slide|deck)/i,
    html: /(html|网页|单页|web page|dashboard)/i,
    markdown: /(markdown|md\s*文档|md文档|\.md|深度研究报告)/i,
    spreadsheet: /(spreadsheet|xlsx|excel|csv|表格)/i,
    image: /(image|图片|图像|png|jpg|jpeg|海报)/i,
    pdf: /(pdf|\.pdf)/i,
    docx: /(docx|word|\.docx|word 文档|word文档)/i
  };
  return Object.entries(formatHints).some(([format, pattern]) => format !== normalizedType && pattern.test(value));
}
