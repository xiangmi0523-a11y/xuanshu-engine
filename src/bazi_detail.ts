/**
 * 八字查表：十神、藏干、十二长生（【用户裁决 E2-A】第 1 项；契约附录 R-39 P-A-02、P-A-03、P-A-06）。
 * - 十神（P-A-02）：以日干为我。
 * - 藏干（P-A-03，CFG-05 yuan_hai_static）：本气、中气、余气为“现代整理层”，歌诀原文另存（R-39.9）。
 * - 十二长生（P-A-06）：版本为阴干阳顺阴逆、戊己火土同宫（R-39.9）；属术数传承层，旺衰不等于吉凶。
 * 只查表，不判格局、旺衰强弱或吉凶。
 */
import { BlockedError } from "./errors.js";
import { STEMS, BRANCHES, ganzhiName } from "./ganzhi.js";
import { CHANGSHENG, type StaticTables } from "./static.js";

export const CANGGAN_LAYER = "现代整理层（本气、中气、余气按通行整理次序；《渊海子平》歌诀只给所藏之干）";
export const CHANGSHENG_LAYER = "术数传承层；阴干阳顺阴逆、戊己火土同宫；旺衰不等于吉凶";

const stem = (s: string) => { if (typeof s !== "string" || s.length !== 1 || !STEMS.includes(s)) throw new BlockedError("STEM_INVALID", `[IN-BZ-03] 不是天干：${String(s)}`); };
const branch = (b: string) => { if (typeof b !== "string" || b.length !== 1 || !BRANCHES.includes(b)) throw new BlockedError("BRANCH_INVALID", `[IN-BZ-03] 不是地支：${String(b)}`); };

export function shishenOf(dayStem: string, other: string, st: StaticTables): string {
  stem(dayStem); stem(other);
  return st.shishen.get(`${dayStem}|${other}`)!;
}

export function cangganOf(b: string, st: StaticTables) {
  branch(b);
  return { ...st.canggan.get(b)!, layer: CANGGAN_LAYER };
}

/** 某天干在某地支的十二长生状态 */
export function changshengOf(s: string, b: string, st: StaticTables): { state: string; layer: string } {
  stem(s); branch(b);
  const i = st.changsheng.get(s)!.indexOf(b);
  return { state: CHANGSHENG[i]!, layer: CHANGSHENG_LAYER };
}

/** 四柱查表汇总：每柱天干的十神（日干标“日主”）、地支藏干及其十神、日干在该支的十二长生 */
const JIAZI: readonly string[] = Array.from({ length: 60 }, (_, i) => ganzhiName(i));

/**
 * 输入约束（docs/static_semantics.md IN-BZ-01、IN-BZ-02）：3 柱（时柱未知时不传）或 4 柱，每柱为六十甲子之一；
 * 不合即 PILLARS_INVALID，不返回部分结果。E1 排盘结果中时柱为 { value: null } 时，调用方只传前三柱。
 */
export function baziDetail(pillars: readonly string[], st: StaticTables) {
  if (!Array.isArray(pillars) || (pillars.length !== 3 && pillars.length !== 4)) {
    throw new BlockedError("PILLARS_INVALID", "[IN-BZ-01] 须给出 3 柱（年、月、日；时柱未知时不传）或 4 柱");
  }
  pillars.forEach((p, i) => {
    if (typeof p !== "string" || !JIAZI.includes(p)) throw new BlockedError("PILLARS_INVALID", `[IN-BZ-02] 第 ${i + 1} 柱不是六十甲子之一：${String(p)}`);
  });
  const day = pillars[2]![0]!;
  return pillars.map((p, i) => {
    const s = p[0]!, b = p[1]!;
    const cg = cangganOf(b, st);
    const hidden = [cg.benqi, cg.zhongqi, cg.yuqi].filter((x): x is string => x !== null)
      .map((h) => ({ stem: h, shishen: shishenOf(day, h, st) }));
    return {
      pillar: p,
      stem_shishen: i === 2 ? "日主" : shishenOf(day, s, st),
      hidden_stems: hidden,
      day_master_changsheng: changshengOf(day, b, st).state,
    };
  });
}
