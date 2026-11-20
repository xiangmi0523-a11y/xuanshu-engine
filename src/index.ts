/**
 * 玄枢计算引擎 —— 纯计算核心（B3-1 阶段 E1）
 *
 * 边界（【用户裁决 B3-1】）：
 * - 只做纯计算：不引入任何界面框架、数据库驱动或平台专属 API（D2）。
 * - 不联网、不接任何 AI 服务（裁决 5、W-13）。
 * - 数据表以文本形式传入（parseJieqiCsv / parseEotCsv / parseStaticTables），文件读取与哈希校验由调用方负责。
 * - 不产生任何持久化业务数据（§9.7）。
 * - 只算结果与其不确定性，不判定 FORMAL / NON_FORMAL。
 */
export const ENGINE_NAME = "xuanshu-engine";
export const ENGINE_STAGE = "E1";

export { BlockedError } from "./errors.js";
export { ZI_RULE_LOCKED, ZI_RULE_VALUES, assertZiRuleAllowed, type ZiRule } from "./zi.js";
export * from "./ganzhi.js";
export * from "./tables.js";
export * from "./bazi.js";
export * from "./liuyao.js";
export * from "./static.js";
export * from "./zhuanggua.js";
export * from "./bazi_detail.js";
