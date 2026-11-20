// 约束清单 = 代码 = 测试（E2-A 第 1 项审查 RC1 的预防机制）。
// docs/static_semantics.md 是唯一规格；本测试读取三方原文，编号集合不一致即失败。
import test from "node:test";
import assert from "node:assert/strict";
import { readRepo } from "./helpers/load.js";

const doc = readRepo("docs/static_semantics.md");
const rows = (re: RegExp) => [...doc.matchAll(re)].map((m) => m[1]!);
const L2 = rows(/^\| (SC-[A-Z]+-\d+) \|.*\| L2 \|$/gm);
const L3 = rows(/^\| (SC-[A-Z]+-O) \|.*\| L3 \|$/gm);
const X = rows(/^\| (X-\d+) \|/gm);
const IN = rows(/^\| (IN-[A-Z]+-\d+) \|/gm);

test("清单编号无重复，且四类都非空", () => {
  for (const [name, ids] of [["L2", L2], ["L3", L3], ["X", X], ["IN", IN]] as const) {
    assert.ok(ids.length > 0, `${name} 为空`);
    assert.equal(new Set(ids).size, ids.length, `${name} 有重复编号`);
  }
});

test("每个 L2 编号在 src/static.ts 恰有一处校验，且 static.ts 没有清单外的编号", () => {
  const src = readRepo("src/static.ts");
  const used = [...src.matchAll(/\[(SC-[A-Z]+-\d+)\]/g)].map((m) => m[1]!);
  for (const id of L2) assert.equal(used.filter((u) => u === id).length, 1, `${id} 在 static.ts 中应恰出现一次`);
  assert.deepEqual(used.filter((u) => !L2.includes(u)), [], "static.ts 有清单外编号");
});

test("每个 L3 编号与 X-07、X-08 出现在 test/oracle.test.ts 的测试名中", () => {
  const names = [...readRepo("test/oracle.test.ts").matchAll(/^test\("([^"]+)"/gm)].map((m) => m[1]!).join("\n");
  for (const id of [...L3, "X-07", "X-08"]) assert.ok(names.includes(id), `${id} 没有对应的独立基准测试`);
});

test("每个 IN 编号在 test/inputs.test.ts 有以其命名的负向测试", () => {
  const names = [...readRepo("test/inputs.test.ts").matchAll(/^test\("([^"]+)"/gm)].map((m) => m[1]!);
  for (const id of IN) assert.ok(names.some((n) => n.startsWith(id + " ")), `${id} 没有输入约束测试`);
});
