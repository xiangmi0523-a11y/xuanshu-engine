import test from "node:test";
import assert from "node:assert/strict";
import { assertZiRuleAllowed, BlockedError, ZI_RULE_LOCKED, ZI_RULE_VALUES } from "../src/index.js";

test("锁定值 ye_zi_b 可通过", () => {
  assert.doesNotThrow(() => assertZiRuleAllowed(ZI_RULE_LOCKED));
});

test("缺少 zi_rule 被拦截", () => {
  assert.throws(() => assertZiRuleAllowed(undefined), (e: unknown) => e instanceof BlockedError && e.code === "ZI_RULE_MISSING");
});

for (const v of ZI_RULE_VALUES.filter((x) => x !== ZI_RULE_LOCKED)) {
  test(`其余取值 ${v} 在引擎层被拦截`, () => {
    assert.throws(() => assertZiRuleAllowed(v), (e: unknown) => e instanceof BlockedError && e.code === "ZI_RULE_NOT_ALLOWED");
  });
}
