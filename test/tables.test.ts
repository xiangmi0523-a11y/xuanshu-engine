import test from "node:test";
import assert from "node:assert/strict";
import { eotSecondsAt, BlockedError } from "../src/index.js";
import { loadTables } from "./helpers/load.js";

test("节气表：4824 条，节 2412 条", () => {
  const { jieqi } = loadTables();
  assert.equal(jieqi.all.length, 4824);
  assert.equal(jieqi.jie.length, 2412);
});

test("均时差插值：样本点取原值，日中取两端线性均值，符号与 B1-1 一致", () => {
  const { eot } = loadTables();
  const t0 = Date.UTC(2026, 1, 11); // 2 月中旬为负
  const day = 86_400_000;
  assert.ok(eotSecondsAt(eot, t0) < -840);
  assert.ok(eotSecondsAt(eot, Date.UTC(2026, 10, 3)) > 960); // 11 月初为正
  const a = eotSecondsAt(eot, t0), b = eotSecondsAt(eot, t0 + day);
  assert.ok(Math.abs(eotSecondsAt(eot, t0 + day / 2) - (a + b) / 2) < 1e-9);
});

test("均时差超出范围被阻断", () => {
  const { eot } = loadTables();
  assert.throws(() => eotSecondsAt(eot, Date.UTC(1899, 11, 31)), (e: unknown) => e instanceof BlockedError && e.code === "EOT_OUT_OF_RANGE");
  assert.throws(() => eotSecondsAt(eot, Date.UTC(2101, 0, 2)), (e: unknown) => e instanceof BlockedError);
  assert.doesNotThrow(() => eotSecondsAt(eot, Date.UTC(2100, 11, 31, 23, 59)));
});
