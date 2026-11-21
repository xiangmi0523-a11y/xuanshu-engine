// 阻断覆盖复核清单（E2-FIX-4 F3-3）：引擎全部计算入口（模块、步骤、计算函数）须在 db/spec/coverage_review.json 中逐项列出，
// 并写明对每项 no_entry 阻断的复核结论。判定时清单外的入口一律失效关闭；测试核对清单与引擎步骤表逐项相等。
import { readFileSync } from "node:fs";

export interface CoverageReview {
  note: string;
  reviewed_coverage: Record<string, string>;
  modules: Record<string, Record<string, string[]>>;
  no_entry: Record<string, string>;
  skippable: Record<string, string[]>;
}
let cache: CoverageReview | undefined;
export const coverageReview = (): CoverageReview =>
  (cache ??= JSON.parse(readFileSync(new URL("../../db/spec/coverage_review.json", import.meta.url), "utf8")) as CoverageReview);
