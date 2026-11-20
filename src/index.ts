/**
 * 玄枢计算引擎 —— 纯计算核心（B3-1 阶段 E0 骨架）
 *
 * 边界（【用户裁决 B3-1】）：
 * - 只做纯计算：不引入任何界面框架、数据库驱动或平台专属 API（D2）。
 * - 不联网、不接任何 AI 服务（裁决 5、W-13）。
 * - 只读取 data/frozen/ 下的冻结数据文件，并按 data/frozen/MANIFEST.json 校验哈希（B4-11）。
 * - 不产生任何持久化业务数据（§9.7）。
 */
export const ENGINE_NAME = "xuanshu-engine";
export const ENGINE_STAGE = "E0";

/** 契约锁定的子时规则（CFG-01 = ye_zi_b，VERSION_LOCKED，【用户裁决 N-6】）。 */
export const ZI_RULE_LOCKED = "ye_zi_b" as const;

/** 契约允许的子时规则取值；第一版只开放锁定值，其余三值必须被拦截（W-03）。 */
export const ZI_RULE_VALUES = ["zi_zheng", "zi_chu", "ye_zi_b", "ye_zi_c"] as const;
export type ZiRule = (typeof ZI_RULE_VALUES)[number];

export class BlockedError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "BlockedError";
  }
}

/** 第一版子时规则校验：未给出或非锁定值一律拦截（引擎层）。 */
export function assertZiRuleAllowed(value: string | undefined): asserts value is typeof ZI_RULE_LOCKED {
  if (value === undefined) {
    throw new BlockedError("ZI_RULE_MISSING", "缺少 zi_rule：不得生成命盘结果（B2）");
  }
  if (value !== ZI_RULE_LOCKED) {
    throw new BlockedError("ZI_RULE_NOT_ALLOWED", `第一版锁定 ${ZI_RULE_LOCKED}，不接受 ${value}（N-6）`);
  }
}
