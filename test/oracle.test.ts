// L3 独立正确性（E2-A 第 1 项全系统审查）。
// 期望值只来自 vectors/static_oracle.json：由数据仓库 crosscheck/oracle/gen_oracle.py 按规则推算生成，
// 不读静态表 CSV、不读 Muse 已填表、不调用引擎；其哈希登记于 data/static/MANIFEST.json 的 oracle 项。
// 本文件不重算任何规则，只把引擎输出与基准逐项比对。
import test from "node:test";
import assert from "node:assert/strict";
import { baziDetail, computeZhuanggua, STEMS, BRANCHES, type ZhuangguaHexagram } from "../src/index.js";
import { loadStatic, readRepo, readVectors, sha256Of } from "./helpers/load.js";

interface OHex { lower: string; upper: string; name: string; palace: string; palace_position: string; shi: number; ying: number; najia: string[]; wuxing: string[] }
interface Oracle {
  hexagrams: Record<string, OHex>; palace_wuxing: Record<string, string>; najia: Record<string, string[]>;
  branch_wuxing: Record<string, string>; liuqin: Record<string, string>; liushen: Record<string, string[]>;
  xunkong: Record<string, [string, string, string]>; shishen: Record<string, string>; canggan_sets: Record<string, string[]>;
  changsheng: Record<string, string[]>; changsheng_states: string[];
  liuqin_by_self: Record<string, Record<string, string[]>>; yao: Record<string, [string, string | null, number[]]>;
}
const O = readVectors("static_oracle.json") as Oracle;
const JIAZI = Array.from({ length: 60 }, (_, i) => STEMS[i % 10]! + BRANCHES[i % 12]!);

test("独立基准文件与登记哈希一致（data/static/MANIFEST.json → oracle）", () => {
  const m = JSON.parse(readRepo("data/static/MANIFEST.json")) as { oracle: { path: string; sha256: string } };
  assert.equal(sha256Of(m.oracle.path), m.oracle.sha256);
});

test("SC-HEX-O SC-PWX-O SC-NJ-O SC-BWX-O SC-LQ-O SC-LS-O SC-XK-O SC-SS-O SC-CG-O SC-CS-O：十张表逐格等于独立基准", () => {
  const st = loadStatic();
  let cells = 0; const diffs: string[] = [];
  const eq = (where: string, got: unknown, want: unknown) => { cells++; if (JSON.stringify(got) !== JSON.stringify(want)) diffs.push(`${where}：表 ${JSON.stringify(got)} 基准 ${JSON.stringify(want)}`); };
  for (const [bits, h] of Object.entries(O.hexagrams)) {
    const t = st.hexagrams.get(bits);
    for (const k of ["lower", "upper", "name", "palace", "palace_position", "shi", "ying"] as const) eq(`卦 ${bits}.${k}`, t?.[k], h[k]);
  }
  for (const [p, w] of Object.entries(O.palace_wuxing)) eq(`宫五行 ${p}`, st.palaceWuxing.get(p), w);
  for (const [g, list] of Object.entries(O.najia)) list.forEach((gz, i) => eq(`纳甲 ${g}${i + 1}`, st.najia.get(`${g}|${i + 1}`), gz));
  for (const [b, w] of Object.entries(O.branch_wuxing)) eq(`地支五行 ${b}`, st.branchWuxing.get(b), w);
  for (const [k, q] of Object.entries(O.liuqin)) eq(`六亲 ${k}`, st.liuqin.get(k), q);
  for (const [s, g] of Object.entries(O.liushen)) g.forEach((x, i) => eq(`六神 ${s}${i + 1}`, st.liushen.get(s)?.[i], x));
  for (const [gz, [h, v1, v2]] of Object.entries(O.xunkong)) {
    const x = st.xunkong.get(gz); eq(`旬空 ${gz} 旬首`, x?.xun_head, h); eq(`旬空 ${gz} 空1`, x?.void[0], v1); eq(`旬空 ${gz} 空2`, x?.void[1], v2);
  }
  for (const [k, s] of Object.entries(O.shishen)) eq(`十神 ${k}`, st.shishen.get(k), s);
  for (const [s, bs] of Object.entries(O.changsheng)) bs.forEach((b, i) => eq(`长生 ${s}.${O.changsheng_states[i]}`, st.changsheng.get(s)?.[i], b));
  for (const [z, set] of Object.entries(O.canggan_sets)) {
    const c = st.canggan.get(z);
    eq(`藏干集合 ${z}`, [c?.benqi, c?.zhongqi, c?.yuqi].filter((x): x is string => !!x).sort(), [...set].sort());
  }
  assert.deepEqual(diffs.slice(0, 10), [], `${diffs.length} 处不一致`);
  assert.equal(cells, 1013, "应逐格核对 1013 格（藏干次序无独立来源，不在内）");
});

test("X-07 装卦全组合：4096 种爻值 × 60 日辰 = 245,760 种，逐个等于独立基准", () => {
  const st = loadStatic();
  const line = (h: ZhuangguaHexagram) => h.lines.map((l) => `${l.line}${+l.yang}${+l.moving}${l.stem_branch}${l.wuxing}${l.liuqin}${l.liushen ?? "-"}${l.shi ? "世" : ""}${l.ying ? "应" : ""}`).join(" ");
  const eng = (h: ZhuangguaHexagram | null) => h ? `${h.bits}|${h.name}|${h.palace}|${h.palace_position}|${h.palace_wuxing}|${h.shi}|${h.ying}|${line(h)}` : "null";
  const want = (bits: string | null, me: string, moving: number[], stem: string | null) => {
    if (!bits) return "null";
    const h = O.hexagrams[bits]!;
    const ls = h.najia.map((gz, i) => `${i + 1}${bits[i]}${+moving.includes(i + 1)}${gz}${h.wuxing[i]}${O.liuqin_by_self[me]![bits]![i]}${stem ? O.liushen[stem]![i] : "-"}${h.shi === i + 1 ? "世" : ""}${h.ying === i + 1 ? "应" : ""}`).join(" ");
    return `${bits}|${h.name}|${h.palace}|${h.palace_position}|${O.palace_wuxing[h.palace]}|${h.shi}|${h.ying}|${ls}`;
  };
  let n = 0; const diffs: string[] = [];
  for (const [key, [ben, bian, moving]] of Object.entries(O.yao)) {
    const yao = [...key].map(Number);
    const me = O.palace_wuxing[O.hexagrams[ben]!.palace]!;          // P-B-04：本卦、变卦都以本卦宫五行为我
    const wBian = want(bian, me, [], null);
    for (const day of JIAZI) {
      const r = computeZhuanggua(yao, day, st);
      n++;
      const [head, v1, v2] = O.xunkong[day]!;
      const e = `${eng(r.ben)}#${eng(r.bian)}#${r.xunkong.xun_head}${r.xunkong.void.join("")}#${r.liuyao.moving_lines.join("")}`;
      const w = `${want(ben, me, moving, day[0]!)}#${wBian}#${head}${v1}${v2}#${moving.join("")}`;
      if (e !== w && diffs.length < 5) diffs.push(`${key} ${day}\n 引擎 ${e}\n 基准 ${w}`);
    }
  }
  assert.deepEqual(diffs, []);
  assert.equal(n, 245760);
});

test("X-08 八字查表全组合：60 日柱 × 60 柱 = 3,600 种，十神、藏干集合与各藏干十神、日主十二长生逐个等于独立基准", () => {
  const st = loadStatic();
  let n = 0; const diffs: string[] = [];
  for (const day of JIAZI) for (const p of JIAZI) {
    const r = baziDetail([p, p, day, p], st);
    n++;
    const d = day[0]!;
    for (const [i, pil] of [[0, p], [2, day]] as const) {
      const x = r[i]!;
      const want = {
        stem_shishen: i === 2 ? "日主" : O.shishen[`${d}|${pil[0]}`],
        hidden: [...O.canggan_sets[pil[1]!]!].sort().map((h) => `${h}${O.shishen[`${d}|${h}`]}`).join(),
        cs: O.changsheng_states[O.changsheng[d]!.indexOf(pil[1]!)],
      };
      const got = { stem_shishen: x.stem_shishen, hidden: x.hidden_stems.map((h) => `${h.stem}${h.shishen}`).sort().join(), cs: x.day_master_changsheng };
      if (JSON.stringify(got) !== JSON.stringify(want) && diffs.length < 5) diffs.push(`${p}/${day}[${i}] ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
    }
  }
  assert.deepEqual(diffs, []);
  assert.equal(n, 3600);
});
