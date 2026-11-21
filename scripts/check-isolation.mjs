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
for (const r of ["src", "db", "test"]) if (existsSync(r)) for (const f of walk(r, [])) {
  readFileSync(f, "utf8").split("\n").forEach((line, i) => { for (const re of NET) if (re.test(line)) fail(`${f}:${i + 1} 疑似网络或 AI 调用：${re}`); });
}
let netFiles = 0;
for (const r of ["src", "db", "test"]) if (existsSync(r)) netFiles += walk(r, []).length;
const all = walk(".", []).filter((f) => !f.startsWith("node_modules") && !f.startsWith(".git") && !f.startsWith("dist"));
for (const f of all) {
  if (/(^|\/)gen_[^/]*\.py$/.test(f) || f.endsWith(".py")) fail(`包含 Python 脚本（生成脚本不得进入引擎仓库）：${f}`);
  if (/\.(sqlite|db|sqlite-wal|sqlite-shm)$/.test(f)) fail(`出现数据库文件（只允许内存临时库）：${f}`);
}
// ---------------------------------------------------------------- E2 持久化隔离与模拟记录隔离（E2 实施授权书第六节；审核清单 DB-D-10、DB-D-37、DB-G-01、DB-G-02、DB-G-06）
const code = ["src", "db", "test", "scripts"].filter(existsSync).flatMap((r) => walk(r, [])).filter((f) => /\.(ts|mjs|js|sql|in)$/.test(f));
const SELF = "scripts/check-isolation.mjs";
const T = "TEST" + "-";
let e2 = 0;
const e2fail = (m) => { fail(m); e2++; };
for (const f of code) {
  if (f === SELF) continue;
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    const at = `${f}:${i + 1}`;
    // 只允许 DatabaseSync(":memory:")；禁止 backup、扩展加载、journal_mode、VACUUM INTO、非内存 ATTACH
    if (/new\s+DatabaseSync\s*\(/.test(line) && !/new\s+DatabaseSync\s*\(\s*["']:memory:["']/.test(line)) e2fail(`${at} DatabaseSync 只许 ":memory:"`);
    if (/\.backup\s*\(|\bbackup\s*\(\s*db|enableLoadExtension|loadExtension\s*\(|allowExtension\s*:\s*true/.test(line)) e2fail(`${at} 禁止 backup / 扩展加载`);
    if (/journal_mode\s*=|VACUUM\s+INTO/i.test(line) && !/禁止|只许|检查/.test(line)) e2fail(`${at} 禁止设置 journal_mode / VACUUM INTO`);
    if (/ATTACH\s+(DATABASE\s+)?['"`]/i.test(line) && !/ATTACH\s+(DATABASE\s+)?['"`]:memory:['"`]/i.test(line)) e2fail(`${at} 只许 ATTACH ':memory:'`);
    // DB-D-10：xs_del_* / xs_audit_write 只在删除模块注册（测试替身须在同行标注“DB-D-10 测试替身”，或紧邻上一行注明）
    if (/\.function\(\s*["'](xs_del_\w+|xs_audit_write)["']/.test(line) && f !== "db/deletion.ts"
        && !(f.startsWith("test/") && (line.includes("DB-D-10 测试替身") || (lines[i - 1] ?? "").includes("DB-D-10 测试替身")))) e2fail(`${at} 删除模块之外注册 xs_del_* / xs_audit_write（DB-D-10）`);
    // DB-G-01：TEST- 稳定 ID 只在 test/fixtures/
    if (line.includes(T) && !f.startsWith("test/fixtures/")) e2fail(`${at} 出现 ${T} 稳定 ID（只许在 test/fixtures/，DB-G-01）`);
    // 测试注入（删除钩子、封存钩子）不得出现在非测试代码中（定义处除外）
    if (!f.startsWith("test/") && f !== "db/pipeline.ts" && f !== "db/deletion.ts" && /\b(skipPrecheck|omitSnapshot|beforeDep|DeletionHooks|SealHooks)\b/.test(line)) e2fail(`${at} 非测试代码引用测试注入点`);
  });
  // DB-D-37：删除模块内，开启与结束事务的语句只在 <tx-wrappers> 区内
  if (f === "db/deletion.ts") {
    let inside = false;
    lines.forEach((line, i) => {
      if (line.includes("// <tx-wrappers>")) inside = true;
      if (line.includes("// </tx-wrappers>")) inside = false;
      if (/["'`]\s*(BEGIN|COMMIT|ROLLBACK)\b/.test(line) && !inside) e2fail(`db/deletion.ts:${i + 1} 包装函数之外出现事务语句（DB-D-37）`);
    });
  }
}
// DB-G-02：夹具的 data_release 只用 TEST-*
const RELEASE_KEY = /^(data_release|ref_release|upstream_release|source_release|component_release|base_data_release|release)$/;
const walkJson = (v, path, f) => {
  if (Array.isArray(v)) v.forEach((x, k) => walkJson(x, `${path}[${k}]`, f));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
    if (RELEASE_KEY.test(k) && typeof x === "string" && !x.startsWith(T)) e2fail(`${f} ${path}.${k} = ${x}：夹具 data_release 只许 ${T}*（DB-G-02）`);
    if (k === "releases" && Array.isArray(x)) for (const r of x) { const s = typeof r === "string" ? r : r?.data_release; if (typeof s === "string" && !s.startsWith(T)) e2fail(`${f} ${path}.releases 含 ${s}（DB-G-02）`); }
    walkJson(x, `${path}.${k}`, f);
  }
};
if (existsSync("test/fixtures")) for (const f of walk("test/fixtures", []).filter((x) => x.endsWith(".json"))) walkJson(JSON.parse(readFileSync(f, "utf8")), "$", f);
// DB-G-06：无发布包
if (pkg.private !== true) e2fail("package.json 须 private: true（DB-G-06）");
for (const k of ["files", "publishConfig", "bin", "main", "exports"]) if (k in pkg) e2fail(`package.json 含打包字段 ${k}（DB-G-06）`);
if (existsSync(".npmignore")) e2fail("存在 .npmignore（不设发布，DB-G-06）");
if (!e2) console.log(`✅ E2 隔离：只用 DatabaseSync(":memory:") 与 ATTACH ':memory:'；无 backup、扩展加载、journal_mode、VACUUM INTO；xs_del_* 只在删除模块注册；事务语句只在包装函数内；${T} 只在 test/fixtures/；夹具 data_release 全为 ${T}*；package.json private、无打包字段（扫描 ${code.length} 个代码文件）`);

console.log(`隔离检查范围：依赖 = package.json；网络 / AI 调用 = src、db、test 共 ${netFiles} 个文件；Python 与数据库文件 = 全仓库（除 node_modules、.git、dist）共 ${all.length} 个文件`);
if (!bad) console.log(`✅ 隔离检查：无运行时依赖，开发依赖仅白名单（typescript、@types/node）；无网络 / AI 调用；无生成脚本；无数据库文件`);
process.exit(bad ? 1 : 0);
