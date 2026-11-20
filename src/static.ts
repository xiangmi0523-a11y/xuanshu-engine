/**
 * 已准入静态表（【用户裁决 M1-R、M2-R】，契约附录 R-39.9、R-39.10）。
 * 正本在 xuanshu-data/static/，由 gen_static_tables.py 从 Muse 查证原件生成；引擎只解析传入的 CSV 文本，
 * 不读文件、不改值。
 *
 * 解析即校验（运行时语义校验，与 check:data 的文件哈希校验相互独立）：
 * 表头、行列数；每张表的键合法、不重复、齐全；每个取值合法；字段之间按契约一致。
 * 任何一项不合即抛 STATIC_TABLE_INVALID，不返回部分结果。
 * 校验只核对契约已写明的关系（P-B-01、03、05、06，R-39.10 第 4 项），不另立规则、不改表值。
 */
import { BlockedError } from "./errors.js";
import { BRANCHES, STEMS, mod } from "./ganzhi.js";
import { TRIGRAMS } from "./liuyao.js";

export const TRIGRAM_NAMES = ["乾", "兑", "离", "震", "巽", "坎", "艮", "坤"] as const;
export const WUXING = ["木", "火", "土", "金", "水"] as const;
export const LIUQIN = ["父母", "兄弟", "子孙", "妻财", "官鬼"] as const;
export const LIUSHEN = ["青龙", "朱雀", "勾陈", "螣蛇", "白虎", "玄武"] as const;
export const PALACE_POSITIONS = ["本宫", "一世", "二世", "三世", "四世", "五世", "游魂", "归魂"] as const;
export const SHISHEN = ["比肩", "劫财", "食神", "伤官", "偏财", "正财", "七杀", "正官", "偏印", "正印"] as const;
export const CHANGSHENG = ["长生", "沐浴", "冠带", "临官", "帝旺", "衰", "病", "死", "墓", "绝", "胎", "养"] as const;

/** 世爻由宫内位置决定（契约 P-B-03：本宫世上爻，一世至五世依次初至五爻，游魂四爻，归魂三爻） */
export const SHI_BY_POSITION: Readonly<Record<string, number>> = { 本宫: 6, 一世: 1, 二世: 2, 三世: 3, 四世: 4, 五世: 5, 游魂: 4, 归魂: 3 };
/** 应 = 世 + 3 mod 6（契约 P-B-03），爻位取 1～6 */
export const yingOf = (shi: number): number => mod(shi + 2, 6) + 1;

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

// ---------- 基本判定（注意：String.prototype.includes("") 恒真，故一律先查长度） ----------
const fail = (msg: string): never => { throw new BlockedError("STATIC_TABLE_INVALID", msg); };
const need = (ok: boolean, msg: string): void => { if (!ok) fail(msg); };
const one = (list: readonly string[], v: string) => list.includes(v);
const isStem = (s: string) => s.length === 1 && STEMS.includes(s);
const isBranch = (s: string) => s.length === 1 && BRANCHES.includes(s);
const JIAZI: readonly string[] = Array.from({ length: 60 }, (_, i) => STEMS[i % 10]! + BRANCHES[i % 12]!);
const isGanzhi = (s: string) => JIAZI.includes(s);
const STEM_LIST: readonly string[] = [...STEMS];
const BRANCH_LIST: readonly string[] = [...BRANCHES];
const pairs = (a: readonly string[], b: readonly string[]) => a.flatMap((x) => b.map((y) => `${x}|${y}`));
const distinct = (xs: string[]) => new Set(xs).size === xs.length;

function rows(name: string, text: string, header: string[], expected: number): string[][] {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.length > 0);
  need(lines[0] === header.join(","), `${name} 表头不符`);
  const body = lines.slice(1).map((l) => l.split(","));
  need(body.length === expected && body.every((r) => r.length === header.length), `${name} 应为 ${expected} 行 × ${header.length} 列`);
  return body;
}

/** 按键建表：键必须在合法键集内、不得重复，且合法键集必须全部出现；取值由 value 校验并转换 */
function keyed<T>(name: string, body: string[][], key: (r: string[]) => string, domain: readonly string[],
  value: (r: string[], k: string) => T): Map<string, T> {
  const want = new Set(domain);
  const m = new Map<string, T>();
  for (const r of body) {
    const k = key(r);
    need(want.has(k), `${name} 键非法：${k}`);
    need(!m.has(k), `${name} 键重复：${k}`);
    m.set(k, value(r, k));
  }
  for (const k of domain) need(m.has(k), `${name} 缺键：${k}`);
  return m;
}

const ALL_BITS: readonly string[] = Array.from({ length: 64 }, (_, i) => i.toString(2).padStart(6, "0"));

export function parseStaticTables(csv: StaticCsv): StaticTables {
  // 1. 六十四卦（P-B-01 寻宫、P-B-03 世应）
  const names = new Set<string>();
  const hexagrams = keyed("liuyao_hexagrams",
    rows("liuyao_hexagrams", csv.liuyao_hexagrams, ["bits_bottom_up", "lower", "upper", "name", "palace", "palace_position", "shi", "ying"], 64),
    (r) => r[0]!, ALL_BITS, ([bits, lower, upper, name, palace, pos, shi, ying]) => {
      const t = `卦 ${bits}（${name}）`;
      need(one(TRIGRAM_NAMES, lower!) && one(TRIGRAM_NAMES, upper!), `${t} 上下卦非法`);
      need(TRIGRAMS[bits!.slice(0, 3)] === lower && TRIGRAMS[bits!.slice(3)] === upper, `${t} 上下卦与卦画不一致`);
      need(name!.length > 0 && !/\s/.test(name!), `${t} 卦名非法`);
      need(!names.has(name!), `${t} 卦名重复`);
      names.add(name!);
      need(one(TRIGRAM_NAMES, palace!), `${t} 卦宫非法`);
      need(one(PALACE_POSITIONS, pos!), `${t} 宫内位置非法`);
      need(/^[1-6]$/.test(shi!) && /^[1-6]$/.test(ying!), `${t} 世应须为 1～6`);
      need(Number(shi) === SHI_BY_POSITION[pos!], `${t} 世爻与宫内位置不合（P-B-03）`);
      need(Number(ying) === yingOf(Number(shi)), `${t} 应 ≠ 世 + 3（P-B-03）`);
      if (pos === "本宫") need(lower === palace && upper === palace, `${t} 本宫卦须为本宫纯卦`);
      return { bits: bits!, lower: lower!, upper: upper!, name: name!, palace: palace!, palace_position: pos!, shi: Number(shi), ying: Number(ying) };
    });
  for (const p of TRIGRAM_NAMES) {
    const members = [...hexagrams.values()].filter((h) => h.palace === p);
    need(members.length === 8, `${p}宫 应有 8 卦，实有 ${members.length}`);
    need(PALACE_POSITIONS.every((pos) => members.filter((h) => h.palace_position === pos).length === 1), `${p}宫 宫内位置须各一`);
  }

  // 2. 八宫五行
  const palaceWuxing = keyed("liuyao_palace_wuxing", rows("liuyao_palace_wuxing", csv.liuyao_palace_wuxing, ["palace", "wuxing"], 8),
    (r) => r[0]!, TRIGRAM_NAMES, ([, w], k) => { need(one(WUXING, w!), `${k}宫 五行非法：${w}`); return w!; });

  // 3. 纳甲（键：卦|爻位，爻位只能是 1～6）
  const najia = keyed("liuyao_najia", rows("liuyao_najia", csv.liuyao_najia, ["trigram", "line", "stem_branch"], 48),
    (r) => `${r[0]}|${r[1]}`, pairs(TRIGRAM_NAMES, ["1", "2", "3", "4", "5", "6"]),
    ([, , gz], k) => { need(isGanzhi(gz!), `纳甲 ${k} 干支非法：${gz}`); return gz!; });

  // 4. 地支五行
  const branchWuxing = keyed("branch_wuxing", rows("branch_wuxing", csv.branch_wuxing, ["branch", "wuxing"], 12),
    (r) => r[0]!, BRANCH_LIST, ([, w], k) => { need(one(WUXING, w!), `地支 ${k} 五行非法：${w}`); return w!; });

  // 5. 六亲（我五行 × 爻五行）
  const liuqin = keyed("liuyao_liuqin", rows("liuyao_liuqin", csv.liuyao_liuqin, ["self_wuxing", "line_wuxing", "liuqin"], 25),
    (r) => `${r[0]}|${r[1]}`, pairs(WUXING, WUXING),
    ([, , q], k) => { need(one(LIUQIN, q!), `六亲 ${k} 取值非法：${q}`); return q!; });

  // 6. 六神（P-B-05：按日干起首，其后依固定次序）
  const liushen = keyed("liuyao_liushen",
    rows("liuyao_liushen", csv.liuyao_liushen, ["day_stem", "line1", "line2", "line3", "line4", "line5", "line6"], 10),
    (r) => r[0]!, STEM_LIST, ([, ...g], k) => {
      need(g.length === 6 && g.every((x) => one(LIUSHEN, x)), `六神 ${k} 取值非法`);
      need(distinct(g), `六神 ${k} 一行内重复`);
      const start = LIUSHEN.indexOf(g[0] as (typeof LIUSHEN)[number]);
      need(g.every((x, i) => x === LIUSHEN[(start + i) % 6]), `六神 ${k} 次序不合（P-B-05）`);
      return g;
    });

  // 7. 旬空（P-B-06：日辰所在之旬，旬首为该旬甲日，空亡为该旬十日未配到的两支）
  const xunkong = keyed("xunkong", rows("xunkong", csv.xunkong, ["ganzhi", "xun_head", "void1", "void2"], 60),
    (r) => r[0]!, JIAZI, ([, head, v1, v2], k) => {
      need(isGanzhi(head!) && head![0] === "甲", `旬空 ${k} 旬首非法：${head}`);
      need(isBranch(v1!) && isBranch(v2!) && v1 !== v2, `旬空 ${k} 空亡地支非法：${v1}${v2}`);
      const h = JIAZI.indexOf(k) - (JIAZI.indexOf(k) % 10);
      need(head === JIAZI[h], `旬空 ${k} 旬首应为 ${JIAZI[h]}，表中为 ${head}`);
      need(v1 === BRANCHES[(h + 10) % 12] && v2 === BRANCHES[(h + 11) % 12], `旬空 ${k} 空亡与旬首不对应`);
      return { xun_head: head!, void: [v1!, v2!] as [string, string] };
    });

  // 8. 十神（日干 × 他干）
  const shishen = keyed("bazi_shishen", rows("bazi_shishen", csv.bazi_shishen, ["day_stem", "other_stem", "shishen"], 100),
    (r) => `${r[0]}|${r[1]}`, pairs(STEM_LIST, STEM_LIST),
    ([, , s], k) => { need(one(SHISHEN, s!), `十神 ${k} 取值非法：${s}`); return s!; });

  // 9. 藏干（本气必有；中气、余气可空，但不得非法、不得重复；列次序不留空洞：无中气则无余气）
  const canggan = keyed("bazi_canggan", rows("bazi_canggan", csv.bazi_canggan, ["branch", "benqi", "zhongqi", "yuqi"], 12),
    (r) => r[0]!, BRANCH_LIST, ([, x, y, z], k) => {
      need(isStem(x!), `藏干 ${k} 本气非法或为空：${x}`);
      need((y === "" || isStem(y!)) && (z === "" || isStem(z!)), `藏干 ${k} 中气或余气非法`);
      need(!(y === "" && z !== ""), `藏干 ${k} 无中气而有余气`);
      need(distinct([x!, y!, z!].filter((s) => s !== "")), `藏干 ${k} 一支内藏干重复`);
      return { benqi: x!, zhongqi: y || null, yuqi: z || null };
    });

  // 10. 十二长生（R-39.10 第 4 项：十二阶段固定次序；阴干阳顺阴逆；戊己火土同宫）
  const changsheng = keyed("bazi_changsheng", rows("bazi_changsheng", csv.bazi_changsheng,
    ["stem", "changsheng", "muyu", "guandai", "linguan", "diwang", "shuai", "bing", "si", "mu", "jue", "tai", "yang"], 10),
    (r) => r[0]!, STEM_LIST, ([, ...b], k) => {
      need(b.length === 12 && b.every(isBranch), `十二长生 ${k} 地支非法`);
      need(distinct(b), `十二长生 ${k} 一行内地支重复`);
      const dir = STEMS.indexOf(k) % 2 === 0 ? 1 : -1;     // 阳干顺行，阴干逆行
      need(b.every((x, i) => i === 0 || BRANCHES.indexOf(x) === mod(BRANCHES.indexOf(b[i - 1]!) + dir, 12)),
        `十二长生 ${k} 未按十二阶段次序${dir > 0 ? "顺" : "逆"}行`);
      return b;
    });
  need(changsheng.get("戊")!.join() === changsheng.get("丙")!.join() && changsheng.get("己")!.join() === changsheng.get("丁")!.join(),
    "十二长生 戊己须与丙丁同宫（火土同宫）");

  return { hexagrams, palaceWuxing, najia, branchWuxing, liuqin, liushen, xunkong, shishen, canggan, changsheng };
}
