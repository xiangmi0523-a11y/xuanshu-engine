// 隔离检查：
// 1. 依赖白名单：运行时依赖必须为空；开发依赖只允许 typescript、@types/node（W-13：无外部 AI / 网络依赖）。
// 2. 源码不得使用网络 API 或引用 AI 服务（裁决 5）。
// 3. 不得包含 xuanshu-data 的生成脚本（B4-11）。
// 4. 不得出现数据库文件（B3-1 D1：只允许内存临时库）。
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

let bad = 0;
const fail = (m) => { console.log(`❌ ${m}`); bad++; };
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const DEV_ALLOW = new Set(["typescript", "@types/node"]);
if (Object.keys(pkg.dependencies ?? {}).length) fail(`存在运行时依赖：${Object.keys(pkg.dependencies)}`);
for (const d of Object.keys(pkg.devDependencies ?? {})) if (!DEV_ALLOW.has(d)) fail(`开发依赖不在白名单：${d}`);

const NET = [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /from\s+["']node:(http|https|net|dgram|tls|dns)["']/,
  /require\(["'](http|https|net)["']\)/, /\b(openai|anthropic|gemini|dashscope|ollama)\b/i];
const walk = (d, out) => { for (const f of readdirSync(d)) { const q = join(d, f); statSync(q).isDirectory() ? walk(q, out) : out.push(q); } return out; };
for (const r of ["src", "test"]) if (existsSync(r)) for (const f of walk(r, [])) {
  readFileSync(f, "utf8").split("\n").forEach((line, i) => { for (const re of NET) if (re.test(line)) fail(`${f}:${i + 1} 疑似网络或 AI 调用：${re}`); });
}
const all = walk(".", []).filter((f) => !f.startsWith("node_modules") && !f.startsWith(".git") && !f.startsWith("dist"));
for (const f of all) {
  if (/(^|\/)gen_[^/]*\.py$/.test(f) || f.endsWith(".py")) fail(`包含 Python 脚本（生成脚本不得进入引擎仓库）：${f}`);
  if (/\.(sqlite|db|sqlite-wal|sqlite-shm)$/.test(f)) fail(`出现数据库文件（只允许内存临时库）：${f}`);
}
if (!bad) console.log(`✅ 隔离检查：无运行时依赖，开发依赖仅白名单；无网络 / AI 调用；无生成脚本；无数据库文件（检查 ${all.length} 个文件）`);
process.exit(bad ? 1 : 0);
