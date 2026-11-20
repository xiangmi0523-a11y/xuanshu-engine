/**
 * 六爻纯计算（B3-1 E1，只做不依赖未核对静态表的部分）。
 *
 * - 输入为六个爻值（初爻在前）：6 老阴、7 少阳、8 少阴、9 老阳。摇卦结果作为输入保存（ENG.1），
 *   引擎不做随机采样；铜钱字 / 背约定契约未定（P-B-11），故不接受铜钱面作为输入。
 * - 动爻：6、9；变卦：动爻阴阳翻转（P-B-08）。
 * - 八宫寻宫、纳甲、世应、六亲、六神、旬空（P-B-01～06）见 zhuanggua.ts（【用户裁决 E2-A】，静态表已准入）。
 */
import { BlockedError } from "./errors.js";

export type YaoValue = 6 | 7 | 8 | 9;

/**
 * 八卦三爻，键按 初→二→三 爻（自下而上）书写，1 = 阳。名称为通说：
 * 震仰盂（初爻阳）100、艮覆碗（上爻阳）001、兑上缺（上爻阴）110、巽下断（初爻阴）011。
 */
export const TRIGRAMS: Readonly<Record<string, string>> = {
  "111": "乾", "110": "兑", "101": "离", "100": "震", "011": "巽", "010": "坎", "001": "艮", "000": "坤",
};

export interface LiuyaoResult {
  yao: YaoValue[];
  moving_lines: number[];        // 1～6，初爻为 1
  ben_lines: (0 | 1)[];          // 本卦，初爻在前
  bian_lines: (0 | 1)[] | null;  // 变卦；无动爻时为 null
  ben_trigrams: { lower: string; upper: string };
  bian_trigrams: { lower: string; upper: string } | null;
  pending: string[];
}

// 输入与键同为 初爻在前，直接拼接，不反转（E1 补齐后修正：原实现多做了一次反转，致震↔艮、巽↔兑互换）
const trigramName = (bits: (0 | 1)[]): string => TRIGRAMS[bits.join("")]!;

export function computeLiuyao(yao: number[]): LiuyaoResult {
  if (yao.length !== 6 || yao.some((v) => ![6, 7, 8, 9].includes(v))) {
    throw new BlockedError("YAO_INVALID", "须给出六个爻值，每个为 6、7、8、9 之一（初爻在前）");
  }
  const vals = yao as YaoValue[];
  const ben = vals.map((v) => (v === 7 || v === 9 ? 1 : 0)) as (0 | 1)[];
  const moving = vals.flatMap((v, i) => (v === 6 || v === 9 ? [i + 1] : []));
  const bian = moving.length ? (vals.map((v, i) => (v === 6 || v === 9 ? (1 - ben[i]!) : ben[i]!)) as (0 | 1)[]) : null;
  const tri = (lines: (0 | 1)[]) => ({ lower: trigramName(lines.slice(0, 3)), upper: trigramName(lines.slice(3, 6)) });
  return {
    yao: vals,
    moving_lines: moving,
    ben_lines: ben,
    bian_lines: bian,
    ben_trigrams: tri(ben),
    bian_trigrams: bian ? tri(bian) : null,
    pending: ["装卦（寻宫、纳甲、世应、六亲、六神、旬空）见 computeZhuanggua"],
  };
}
