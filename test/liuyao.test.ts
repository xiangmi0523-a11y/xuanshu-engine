import test from "node:test";
import assert from "node:assert/strict";
import { BlockedError, computeLiuyao } from "../src/index.js";

test("六爻：本卦、动爻、变卦", () => {
  const r = computeLiuyao([7, 8, 9, 6, 7, 7]);
  assert.deepEqual(r.ben_lines, [1, 0, 1, 0, 1, 1]);
  assert.deepEqual(r.moving_lines, [3, 4]);
  assert.deepEqual(r.bian_lines, [1, 0, 0, 1, 1, 1]);
  assert.deepEqual(r.ben_trigrams, { lower: "离", upper: "兑" }); // 下 101 = 离；上 011（初在前）= 上→下 110 = 兑
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
