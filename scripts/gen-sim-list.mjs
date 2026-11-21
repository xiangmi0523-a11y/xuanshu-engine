// 生成验收报告的“模拟项清单”（DB-G-05）。须先 npm run build。用法：node scripts/gen-sim-list.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
const { buildSimList, SIM_LIST_PATH } = await import("../dist/test/fixtures/simlist.js");
mkdirSync(dirname(SIM_LIST_PATH), { recursive: true });
writeFileSync(SIM_LIST_PATH, buildSimList());
console.log(`写出 ${SIM_LIST_PATH}`);
