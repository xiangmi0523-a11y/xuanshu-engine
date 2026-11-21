// 契约常量（只读副本 data/contract/constants.toml，哈希由 check:data 核对 MANIFEST.json）。
// 只解析本模块用到的键；缺键即抛错（不设默认值，规则与常量以契约为准）。
import { readFileSync } from "node:fs";

let cache: string | undefined;
const toml = () => (cache ??= readFileSync(new URL("../../data/contract/constants.toml", import.meta.url), "utf8"));

/** [blockers] required：契约 §9.5 B1–B4 与附录 BLK.1 七项（E2-FIX-2 P1-3） */
export function requiredBlockers(): string[] {
  const m = /^\[blockers\][^[]*?^required\s*=\s*\[([^\]]*)\]/ms.exec(toml());
  if (!m) throw new Error("data/contract/constants.toml 缺 [blockers] required");
  const ids = [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
  if (ids.length === 0) throw new Error("[blockers] required 为空");
  return ids;
}
