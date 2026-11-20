/**
 * 已准入静态表（【用户裁决 M1-R、M2-R】，契约附录 R-39.9、R-39.10）。
 * 正本在 xuanshu-data/static/，由 gen_static_tables.py 从 Muse 查证原件生成；引擎只解析传入的 CSV 文本，
 * 不读文件、不改值。解析时核对表头、行数与键的完整性，不合即阻断。
 */
import { BlockedError } from "./errors.js";
import { BRANCHES, STEMS } from "./ganzhi.js";

export const TRIGRAM_NAMES = ["乾", "兑", "离", "震", "巽", "坎", "艮", "坤"] as const;
export const WUXING = ["木", "火", "土", "金", "水"] as const;
export const LIUQIN = ["父母", "兄弟", "子孙", "妻财", "官鬼"] as const;
export const LIUSHEN = ["青龙", "朱雀", "勾陈", "螣蛇", "白虎", "玄武"] as const;
export const PALACE_POSITIONS = ["本宫", "一世", "二世", "三世", "四世", "五世", "游魂", "归魂"] as const;
export const SHISHEN = ["比肩", "劫财", "食神", "伤官", "偏财", "正财", "七杀", "正官", "偏印", "正印"] as const;
export const CHANGSHENG = ["长生", "沐浴", "冠带", "临官", "帝旺", "衰", "病", "死", "墓", "绝", "胎", "养"] as const;

export interface Hexagram {
  bits: string; lower: string; upper: string; name: string;
  palace: string; palace_position: string; shi: number; ying: number;
}
export interface StaticTables {
  hexagrams: Map<string, Hexagram>;                 // 键：爻象（初→上）
  palaceWuxing: Map<string, string>;
  najia: Map<string, string>;                       // 键：`${卦}|${爻位 1～6}`
  branchWuxing: Map<string, string>;
  liuqin: Map<string, string>;                      // 键：`${我}|${爻}`
  liushen: Map<string, string[]>;                   // 日干 → 初至上
  xunkong: Map<string, { xun_head: string; void: [string, string] }>;
  shishen: Map<string, string>;                     // 键：`${日干}|${他干}`
  canggan: Map<string, { benqi: string; zhongqi: string | null; yuqi: string | null }>;
  changsheng: Map<string, string[]>;                // 天干 → 十二状态所落地支，依 CHANGSHENG 次序
}

export type StaticCsv = Record<
  "liuyao_hexagrams" | "liuyao_palace_wuxing" | "liuyao_najia" | "branch_wuxing" | "liuyao_liuqin" |
  "liuyao_liushen" | "xunkong" | "bazi_shishen" | "bazi_canggan" | "bazi_changsheng", string>;

function rows(name: string, text: string, header: string[], expected: number): string[][] {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.length > 0);
  if (lines[0] !== header.join(",")) throw new BlockedError("STATIC_TABLE_INVALID", `${name} 表头不符`);
  const body = lines.slice(1).map((l) => l.split(","));
  if (body.length !== expected || body.some((r) => r.length !== header.length)) {
    throw new BlockedError("STATIC_TABLE_INVALID", `${name} 应为 ${expected} 行 × ${header.length} 列`);
  }
  return body;
}
const need = (ok: boolean, msg: string) => { if (!ok) throw new BlockedError("STATIC_TABLE_INVALID", msg); };

export function parseStaticTables(csv: StaticCsv): StaticTables {
  const hexagrams = new Map<string, Hexagram>();
  for (const [bits, lower, upper, name, palace, pos, shi, ying] of rows("liuyao_hexagrams", csv.liuyao_hexagrams,
    ["bits_bottom_up", "lower", "upper", "name", "palace", "palace_position", "shi", "ying"], 64)) {
    need(/^[01]{6}$/.test(bits!) && (PALACE_POSITIONS as readonly string[]).includes(pos!), `卦 ${name} 字段不合`);
    hexagrams.set(bits!, { bits: bits!, lower: lower!, upper: upper!, name: name!, palace: palace!, palace_position: pos!, shi: Number(shi), ying: Number(ying) });
  }
  need(hexagrams.size === 64, "六十四卦有重复爻象");

  const palaceWuxing = new Map(rows("liuyao_palace_wuxing", csv.liuyao_palace_wuxing, ["palace", "wuxing"], 8).map(([p, w]) => [p!, w!]));
  const najia = new Map(rows("liuyao_najia", csv.liuyao_najia, ["trigram", "line", "stem_branch"], 48).map(([g, l, gz]) => [`${g}|${l}`, gz!]));
  const branchWuxing = new Map(rows("branch_wuxing", csv.branch_wuxing, ["branch", "wuxing"], 12).map(([b, w]) => [b!, w!]));
  const liuqin = new Map(rows("liuyao_liuqin", csv.liuyao_liuqin, ["self_wuxing", "line_wuxing", "liuqin"], 25).map(([a, b, q]) => [`${a}|${b}`, q!]));
  const liushen = new Map(rows("liuyao_liushen", csv.liuyao_liushen, ["day_stem", "line1", "line2", "line3", "line4", "line5", "line6"], 10).map(([s, ...g]) => [s!, g]));
  const xunkong = new Map(rows("xunkong", csv.xunkong, ["ganzhi", "xun_head", "void1", "void2"], 60).map(([gz, h, v1, v2]) => [gz!, { xun_head: h!, void: [v1!, v2!] as [string, string] }]));
  const shishen = new Map(rows("bazi_shishen", csv.bazi_shishen, ["day_stem", "other_stem", "shishen"], 100).map(([d, o, s]) => [`${d}|${o}`, s!]));
  const canggan = new Map(rows("bazi_canggan", csv.bazi_canggan, ["branch", "benqi", "zhongqi", "yuqi"], 12).map(([b, x, y, z]) => [b!, { benqi: x!, zhongqi: y || null, yuqi: z || null }]));
  const changsheng = new Map(rows("bazi_changsheng", csv.bazi_changsheng,
    ["stem", "changsheng", "muyu", "guandai", "linguan", "diwang", "shuai", "bing", "si", "mu", "jue", "tai", "yang"], 10).map(([s, ...b]) => [s!, b]));

  // 键完整性：每张表覆盖其全部键，值都在取值范围内
  for (const g of TRIGRAM_NAMES) { need(palaceWuxing.has(g), `缺卦宫五行 ${g}`); for (let l = 1; l <= 6; l++) need(najia.has(`${g}|${l}`), `缺纳甲 ${g}${l}`); }
  for (const b of BRANCHES) need((WUXING as readonly string[]).includes(branchWuxing.get(b) ?? ""), `缺地支五行 ${b}`);
  for (const a of WUXING) for (const b of WUXING) need((LIUQIN as readonly string[]).includes(liuqin.get(`${a}|${b}`) ?? ""), `缺六亲 ${a}${b}`);
  for (const s of STEMS) {
    need((liushen.get(s) ?? []).every((x) => (LIUSHEN as readonly string[]).includes(x)), `六神 ${s} 不合`);
    need((changsheng.get(s) ?? []).length === 12, `缺十二长生 ${s}`);
    for (const o of STEMS) need((SHISHEN as readonly string[]).includes(shishen.get(`${s}|${o}`) ?? ""), `缺十神 ${s}${o}`);
  }
  for (const b of BRANCHES) need(canggan.has(b), `缺藏干 ${b}`);
  return { hexagrams, palaceWuxing, najia, branchWuxing, liuqin, liushen, xunkong, shishen, canggan, changsheng };
}
