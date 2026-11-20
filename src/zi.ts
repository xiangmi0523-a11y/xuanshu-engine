import { BlockedError } from "./errors.js";

/** 契约锁定的子时规则（CFG-01 = ye_zi_b，VERSION_LOCKED，【用户裁决 N-6】）。 */
export const ZI_RULE_LOCKED = "ye_zi_b" as const;

/** CFG-01 的四个取值；第一版只开放锁定值，其余三值必须被拦截（W-03）。 */
export const ZI_RULE_VALUES = ["zi_zheng", "zi_chu", "ye_zi_b", "ye_zi_c"] as const;
export type ZiRule = (typeof ZI_RULE_VALUES)[number];

/** 引擎层拦截：未给出或非锁定值一律阻断。 */
export function assertZiRuleAllowed(value: string | undefined): asserts value is typeof ZI_RULE_LOCKED {
  if (value === undefined) throw new BlockedError("ZI_RULE_MISSING", "缺少 zi_rule：不得生成命盘结果（B2）");
  if (value !== ZI_RULE_LOCKED) throw new BlockedError("ZI_RULE_NOT_ALLOWED", `第一版锁定 ${ZI_RULE_LOCKED}，不接受 ${value}（N-6）`);
}
