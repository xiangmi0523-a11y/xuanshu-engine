/**
 * 六爻装卦（【用户裁决 E2-A】第 1 项；规则：契约附录 R-39 P-B-01～06、P-B-08，静态表见 static.ts）。
 *
 * 顺序固定（契约 §R-39.3 层级红线）：起卦 → 寻宫 → 纳甲 → 安世应 → 安六亲 → 安六神 → 排日辰 → 判动变。
 * - 寻宫、世应：查六十四卦表（P-B-01、P-B-03）。
 * - 纳甲：下卦取该卦内卦三爻（初、二、三），上卦取该卦外卦三爻（四、五、上）（P-B-02）。
 * - 六亲：以本卦所属宫五行为我；变爻六亲仍依本卦宫（P-B-04）。
 * - 六神：按日干起，自初爻排至上爻；仅作辅助符号，不参与生克（P-B-05）。
 * - 旬空：按日辰干支查六旬空亡表（P-B-06）；月建逢空、真空假空属断卦层，不在此。
 * 层级：纳甲、世应、六亲、六神属京房纳甲体系，不得标为《周易》原文。
 * 未实现：月建、月破（P-B-07）、飞伏（P-B-09）——本轮查证未覆盖其静态表。
 */
import { BlockedError } from "./errors.js";
import { STEMS, BRANCHES } from "./ganzhi.js";
import { computeLiuyao, type LiuyaoResult } from "./liuyao.js";
import type { StaticTables } from "./static.js";

export const ZHUANGGUA_LAYER = "京房纳甲体系（后世术数，非《周易》原文）";

export interface ZhuangguaLine {
  line: number;                 // 1～6，初爻为 1
  yang: boolean;
  moving: boolean;
  stem_branch: string;          // 纳甲干支
  wuxing: string;               // 所纳地支的五行
  liuqin: string;
  liushen?: string;             // 只在本卦给出
  shi: boolean;
  ying: boolean;
}
export interface ZhuangguaHexagram {
  bits: string; name: string; lower: string; upper: string;
  palace: string; palace_position: string; palace_wuxing: string;
  shi: number; ying: number;
  lines: ZhuangguaLine[];
}
export interface ZhuangguaResult {
  liuyao: LiuyaoResult;
  day_ganzhi: string;
  ben: ZhuangguaHexagram;
  bian: ZhuangguaHexagram | null;
  xunkong: { xun_head: string; void: [string, string] };
  layer: string;
  liushen_is_auxiliary_symbol: true;
  steps: string[];
  not_implemented: string[];
}

function hexagram(bits: string, st: StaticTables, selfWuxing: string, liushen: string[] | null): ZhuangguaHexagram {
  const h = st.hexagrams.get(bits);
  if (!h) throw new BlockedError("HEXAGRAM_UNKNOWN", `爻象 ${bits} 不在六十四卦表中`);
  const palaceWuxing = st.palaceWuxing.get(h.palace)!;
  const lines: ZhuangguaLine[] = [];
  for (let i = 1; i <= 6; i++) {
    const trigram = i <= 3 ? h.lower : h.upper;
    const stemBranch = st.najia.get(`${trigram}|${i}`)!;
    const wuxing = st.branchWuxing.get(stemBranch[1]!)!;
    lines.push({
      line: i, yang: bits[i - 1] === "1", moving: false, stem_branch: stemBranch, wuxing,
      liuqin: st.liuqin.get(`${selfWuxing}|${wuxing}`)!,
      ...(liushen ? { liushen: liushen[i - 1]! } : {}),
      shi: h.shi === i, ying: h.ying === i,
    });
  }
  return { bits, name: h.name, lower: h.lower, upper: h.upper, palace: h.palace, palace_position: h.palace_position,
    palace_wuxing: palaceWuxing, shi: h.shi, ying: h.ying, lines };
}

/**
 * @param yao 六个爻值，初爻在前（6 老阴、7 少阳、8 少阴、9 老阳），即起卦结果（ENG.1：作为输入保存）
 * @param dayGanzhi 占日的日辰干支，如“戊戌”（由历法模块按占卦时刻给出）
 */
export function computeZhuanggua(yao: number[], dayGanzhi: string, st: StaticTables): ZhuangguaResult {
  const ly = computeLiuyao(yao);
  if (dayGanzhi.length !== 2 || !STEMS.includes(dayGanzhi[0]!) || !BRANCHES.includes(dayGanzhi[1]!) || !st.xunkong.has(dayGanzhi)) {
    throw new BlockedError("DAY_GANZHI_INVALID", "须给出占日的日辰干支（六十甲子之一）");
  }
  const benBits = ly.ben_lines.join("");
  const benPalace = st.hexagrams.get(benBits)?.palace;
  if (!benPalace) throw new BlockedError("HEXAGRAM_UNKNOWN", `爻象 ${benBits} 不在六十四卦表中`);
  const self = st.palaceWuxing.get(benPalace)!;               // 我 = 本卦宫五行（P-B-04）
  const ben = hexagram(benBits, st, self, st.liushen.get(dayGanzhi[0]!)!);
  for (const l of ben.lines) l.moving = ly.moving_lines.includes(l.line);
  // 变卦：寻宫、纳甲、世应按变卦本身；六亲仍依本卦宫（P-B-04）；六神只排本卦
  const bian = ly.bian_lines ? hexagram(ly.bian_lines.join(""), st, self, null) : null;
  return {
    liuyao: ly,
    day_ganzhi: dayGanzhi,
    ben, bian,
    xunkong: st.xunkong.get(dayGanzhi)!,
    layer: ZHUANGGUA_LAYER,
    liushen_is_auxiliary_symbol: true,
    steps: ["起卦", "寻宫", "纳甲", "安世应", "安六亲", "安六神", "排日辰", "判动变"],
    not_implemented: ["月建、月破（P-B-07）", "飞伏（P-B-09）", "断语与旺衰（须先选断卦体系）"],
  };
}
