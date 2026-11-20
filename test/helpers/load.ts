// 测试用：读取冻结数据并按 MANIFEST.json 校验哈希（引擎核心本身不读文件）。
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseEotCsv, parseJieqiCsv, type Tables } from "../../src/index.js";

const root = new URL("../../../", import.meta.url); // dist/test/helpers → 仓库根
const manifest = JSON.parse(readFileSync(new URL("data/frozen/MANIFEST.json", root), "utf8")) as { files: Record<string, { sha256: string }> };

export function readFrozen(name: string): string {
  const buf = readFileSync(new URL(`data/frozen/${name}`, root));
  const got = createHash("sha256").update(buf).digest("hex");
  if (got !== manifest.files[name]?.sha256) throw new Error(`冻结数据哈希不符：${name}`);
  return buf.toString("utf8");
}

let cached: Tables | undefined;
export function loadTables(): Tables {
  cached ??= {
    jieqi: parseJieqiCsv(readFrozen("jieqi_1900_2100_utc_skyfield.csv")),
    eot: parseEotCsv(readFrozen("eot_1900_2100_daily.csv")),
  };
  return cached;
}

export function readVectors(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`vectors/${name}`, root), "utf8"));
}
