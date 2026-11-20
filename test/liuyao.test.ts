import test from "node:test";
import assert from "node:assert/strict";
import { BlockedError, computeLiuyao } from "../src/index.js";

test("六爻：本卦、动爻、变卦", () => {
  const r = computeLiuyao([7, 8, 9, 6, 7, 7]);
  assert.deepEqual(r.ben_lines, [1, 0, 1, 0, 1, 1]);
  assert.deepEqual(r.moving_lines, [3, 4]);
  assert.deepEqual(r.bian_lines, [1, 0, 0, 1, 1, 1]);
  // 下（初、二、三）= 阳阴阳 = 离；上（四、五、上）= 阴阳阳，下断 = 巽 → 风火家人
  assert.deepEqual(r.ben_trigrams, { lower: "离", upper: "巽" });
});

test("六爻：全静无变卦；全阳为乾", () => {
  const r = computeLiuyao([7, 7, 7, 7, 7, 7]);
  assert.equal(r.bian_lines, null);
  assert.deepEqual(r.ben_trigrams, { lower: "乾", upper: "乾" });
});

test("六爻：非法输入被拒", () => {
  assert.throws(() => computeLiuyao([7, 7, 7]), BlockedError);
  assert.throws(() => computeLiuyao([7, 7, 7, 7, 7, 5]), BlockedError);
});

// 八卦取象口诀，按 初→上 的爻序独立写出，不引用引擎内部表
const EIGHT: [string, (0 | 1)[]][] = [
  ["乾", [1, 1, 1]], // 乾三连
  ["坤", [0, 0, 0]], // 坤六断
  ["震", [1, 0, 0]], // 震仰盂：初爻阳
  ["艮", [0, 0, 1]], // 艮覆碗：上爻阳
  ["离", [1, 0, 1]], // 离中虚
  ["坎", [0, 1, 0]], // 坎中满
  ["兑", [1, 1, 0]], // 兑上缺：上爻阴
  ["巽", [0, 1, 1]], // 巽下断：初爻阴
];
const toYao = (bits: (0 | 1)[]) => bits.map((b) => (b ? 7 : 8));

test("六爻：八卦全部 8 种在下卦、上卦位置都按口诀识别（初爻在下）", () => {
  for (const [lowerName, lowerBits] of EIGHT) {
    for (const [upperName, upperBits] of EIGHT) {
      const r = computeLiuyao([...toYao(lowerBits), ...toYao(upperBits)]);
      assert.deepEqual(r.ben_trigrams, { lower: lowerName, upper: upperName }, `${lowerName}下 ${upperName}上`);
    }
  }
});

test("六爻：乾为天初九动 → 天风姤（下巽上乾）；坤为地初六动 → 地雷复（下震上坤）", () => {
  assert.deepEqual(computeLiuyao([9, 7, 7, 7, 7, 7]).bian_trigrams, { lower: "巽", upper: "乾" });
  assert.deepEqual(computeLiuyao([6, 8, 8, 8, 8, 8]).bian_trigrams, { lower: "震", upper: "坤" });
});
