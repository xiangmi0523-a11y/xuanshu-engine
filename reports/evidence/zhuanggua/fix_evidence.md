# 验收修复证据：变异检查与结果快照（原始输出）

脚本在仓库外运行（引擎仓库禁止 .py），全文附后。

## 1. 语义校验变异（mutate_static.py 原始输出）

| 编号 | 位置 | 校验（取自源码信息串） | 结果 |
|---|---|---|---|
| S01 | static.ts:64 | , | 测出（1 败） |
| S02 | static.ts:66 | ${name} 应为 ${expected} 行 × ${header.length} 列 | 测出（10 败） |
| S03 | static.ts:77 | ${name} 键非法：${k} | 测出（10 败） |
| S04 | static.ts:78 | ${name} 键重复：${k} | 测出（10 败） |
| S05 | static.ts:81 | ${name} 缺键：${k} | 未测出 |
| S06 | static.ts:94 | ${t} 上下卦非法 | 测出（1 败） |
| S07 | static.ts:95 | ${t} 上下卦与卦画不一致 | 测出（1 败） |
| S08 | static.ts:96 | ${t} 卦名非法 | 测出（1 败） |
| S09 | static.ts:97 | ${t} 卦名重复 | 测出（1 败） |
| S10 | static.ts:99 | ${t} 卦宫非法 | 测出（1 败） |
| S11 | static.ts:100 | ${t} 宫内位置非法 | 测出（1 败） |
| S12 | static.ts:101 | ${t} 世应须为 1～6 | 测出（1 败） |
| S13 | static.ts:102 | ${t} 世爻与宫内位置不合（P-B-03） | 测出（1 败） |
| S14 | static.ts:103 | ${t} 应 ≠ 世 + 3（P-B-03） | 测出（1 败） |
| S15 | static.ts:104 | ${t} 本宫卦须为本宫纯卦 | 测出（1 败） |
| S16 | static.ts:109 | ${p}宫 应有 8 卦，实有 ${members.length} | 测出（1 败） |
| S17 | static.ts:110 | ${p}宫 宫内位置须各一 | 测出（1 败） |
| S18 | static.ts:115 | ${k}宫 五行非法：${w} | 测出（1 败） |
| S19 | static.ts:120 | 纳甲 ${k} 干支非法：${gz} | 测出（1 败） |
| S20 | static.ts:124 | 地支 ${k} 五行非法：${w} | 测出（1 败） |
| S21 | static.ts:129 | 六亲 ${k} 取值非法：${q} | 测出（2 败） |
| S22 | static.ts:135 | 六神 ${k} 取值非法 | 测出（1 败） |
| S23 | static.ts:136 | 六神 ${k} 一行内重复 | 测出（1 败） |
| S24 | static.ts:138 | 六神 ${k} 次序不合（P-B-05） | 测出（1 败） |
| S25 | static.ts:145 | 甲 | 测出（1 败） |
| S26 | static.ts:146 | 旬空 ${k} 空亡地支非法：${v1}${v2} | 测出（1 败） |
| S27 | static.ts:148 | 旬空 ${k} 旬首应为 ${JIAZI[h]}，表中为 ${head} | 测出（1 败） |
| S28 | static.ts:149 | 旬空 ${k} 空亡与旬首不对应 | 测出（1 败） |
| S29 | static.ts:156 | 十神 ${k} 取值非法：${s} | 测出（1 败） |
| S30 | static.ts:161 | 藏干 ${k} 本气非法或为空：${x} | 测出（1 败） |
| S31 | static.ts:162 |  | 测出（1 败） |
| S32 | static.ts:163 |  | 测出（1 败） |
| S33 | static.ts:164 |  | 测出（1 败） |
| S34 | static.ts:172 | 十二长生 ${k} 地支非法 | 测出（1 败） |
| S35 | static.ts:173 | 十二长生 ${k} 一行内地支重复 | 测出（1 败） |
| S36 | static.ts:175 | need(b.every((x, i) => i === 0 || BRANCHES.indexOf | 测出（1 败） |
| S37 | static.ts:179 | 戊 | 测出（1 败） |

合计 37 处，测出 36，未测出 1

## 2. 计算代码变异 M1～M6（mutate.sh 原始输出）

| 变异 | 结果 |
|---|---|
| M1 变卦六亲改依变卦宫（违 P-B-04） | # pass 99 # fail 2  |
| M2 纳甲上下卦颠倒 | # pass 97 # fail 4  |
| M3 六神按日支起 | # pass 98 # fail 3  |
| M4 动爻标记偏一位 | # pass 98 # fail 3  |
| M5 十二长生阴干改顺行（取阳干表） | # pass 100 # fail 1  |
| M6 十神日干与他干对调 | # pass 100 # fail 1  |

## 3. 结果快照

修复前（3a53779 构建）：
```json
{
 "tables": "8842c4d9d0648d8a13ec748fdc20fb6cb6329ae87b05627d8aaab8de86e2f156",
 "zhuanggua_calls": 245760,
 "zhuanggua": "ec763a0399a831345a0f9a76e251624d353f9d7e87aa92ddb0532bc826408e5c",
 "bazi": "eb1798669cb676dc22313b4db41641c51f84a90c8acb87fa82ad4da6235990d7"
}
```
修复后（d0a27a3 构建）：
```json
{
 "tables": "8842c4d9d0648d8a13ec748fdc20fb6cb6329ae87b05627d8aaab8de86e2f156",
 "zhuanggua_calls": 245760,
 "zhuanggua": "ec763a0399a831345a0f9a76e251624d353f9d7e87aa92ddb0532bc826408e5c",
 "bazi": "eb1798669cb676dc22313b4db41641c51f84a90c8acb87fa82ad4da6235990d7"
}
```

## 附：snapshot.mjs
```js
// 全量结果快照：解析后的十张表 + 4096 种爻值 × 60 日辰的装卦 + 十神/藏干/十二长生全表。只输出哈希。
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const eng = process.argv[2];
const E = await import(`${eng}/dist/src/index.js`);
const names = ["liuyao_hexagrams","liuyao_palace_wuxing","liuyao_najia","branch_wuxing","liuyao_liuqin","liuyao_liushen","xunkong","bazi_shishen","bazi_canggan","bazi_changsheng"];
const csv = Object.fromEntries(names.map((n) => [n, readFileSync(`${eng}/data/static/${n}.csv`, "utf8")]));
const st = E.parseStaticTables(csv);
const h = (o) => createHash("sha256").update(JSON.stringify(o)).digest("hex");
const tables = Object.fromEntries(Object.entries(st).map(([k, m]) => [k, [...m.entries()]]));
const S = "甲乙丙丁戊己庚辛壬癸", B = "子丑寅卯辰巳午未申酉戌亥";
const days = Array.from({ length: 60 }, (_, i) => S[i % 10] + B[i % 12]);
const zg = createHash("sha256"); let n = 0;
for (let c = 0; c < 4096; c++) {
  const yao = Array.from({ length: 6 }, (_, i) => 6 + ((c >> (2 * i)) & 3));
  for (const d of days) { const r = E.computeZhuanggua(yao, d, st); zg.update(JSON.stringify([r.ben, r.bian, r.xunkong, r.layer, r.not_implemented])); n++; }
}
const bz = [];
for (const a of S) for (const b of S) bz.push(E.shishenOf(a, b, st));
for (const b of B) bz.push(E.cangganOf(b, st));
for (const a of S) for (const b of B) bz.push(E.changshengOf(a, b, st));
console.log(JSON.stringify({ tables: h(tables), zhuanggua_calls: n, zhuanggua: zg.digest("hex"), bazi: h(bz) }, null, 1));
```

## 附：mutate_static.py
```python
# 逐个使 src/static.ts 中的 need(...) 失效（条件改为恒真），构建并跑全部测试，记录是否被测出。跑完还原。
import re, subprocess, shutil, sys
ENG = "/home/claude/xuanshu-engine"; SRC = f"{ENG}/src/static.ts"
orig = open(SRC, encoding="utf-8").read()
lines = orig.split("\n")
sites = [(i, l) for i, l in enumerate(lines) if re.search(r"\bneed\(", l) and "const need" not in l]
out = []
try:
    for n, (i, l) in enumerate(sites, 1):
        mutated = lines.copy()
        mutated[i] = re.sub(r"\bneed\(", "need(true || ", l, count=1)
        open(SRC, "w", encoding="utf-8").write("\n".join(mutated))
        shutil.rmtree(f"{ENG}/dist", ignore_errors=True)
        subprocess.run(["npx", "tsc", "-p", "tsconfig.json"], cwd=ENG, capture_output=True)
        r = subprocess.run("node --test \"dist/test/**/*.test.js\"", shell=True, cwd=ENG, capture_output=True, text=True)
        fail = re.search(r"^# fail (\d+)", r.stdout, re.M)
        f = int(fail.group(1)) if fail else -1
        msg = re.search(r"`([^`]*)`|\"([^\"]*)\"", l[l.index("need("):])
        label = (msg.group(1) or msg.group(2)) if msg else l.strip()[:50]
        out.append((n, i + 1, f, label))
        print(f"| S{n:02d} | static.ts:{i+1} | {label} | {'测出（' + str(f) + ' 败）' if f > 0 else '未测出'} |", flush=True)
finally:
    open(SRC, "w", encoding="utf-8").write(orig)
caught = sum(1 for o in out if o[2] > 0)
print(f"\n合计 {len(out)} 处，测出 {caught}，未测出 {len(out) - caught}")
```

## 附：mutate.sh
```bash
#!/bin/bash
# 变异检查：每次只改一处，跑构建+测试，记录失败数后还原
cd /home/claude/xuanshu-engine
run() { # $1 name, $2 file, $3 python-replace-expr
  cp "$2" /tmp/mut.bak
  python3 -c "import sys;p=sys.argv[1];t=open(p,encoding='utf-8').read();o,n=sys.argv[2],sys.argv[3];assert o in t,('未命中',o);open(p,'w',encoding='utf-8').write(t.replace(o,n,1))" "$2" "$3" "$4"
  rm -rf dist; npx tsc -p tsconfig.json >/dev/null 2>&1
  r=$(node --test "dist/test/**/*.test.js" 2>&1 | grep -E "^# (fail|pass)" | tr '\n' ' ')
  echo "| $1 | $r |"
  cp /tmp/mut.bak "$2"
}
echo "| 变异 | 结果 |"; echo "|---|---|"
run "M1 变卦六亲改依变卦宫（违 P-B-04）" src/zhuanggua.ts 'hexagram(ly.bian_lines.join(""), st, self, null)' 'hexagram(ly.bian_lines.join(""), st, st.palaceWuxing.get(st.hexagrams.get(ly.bian_lines.join(""))!.palace)!, null)'
run "M2 纳甲上下卦颠倒" src/zhuanggua.ts 'i <= 3 ? h.lower : h.upper' 'i <= 3 ? h.upper : h.lower'
run "M3 六神按日支起" src/zhuanggua.ts 'st.liushen.get(dayGanzhi[0]!)!' '(st.liushen.get(STEMS[BRANCHES.indexOf(dayGanzhi[1]!) % 10]!) ?? st.liushen.get(dayGanzhi[0]!))!'
run "M4 动爻标记偏一位" src/zhuanggua.ts 'ly.moving_lines.includes(l.line)' 'ly.moving_lines.includes(l.line - 1)'
run "M5 十二长生阴干改顺行（取阳干表）" src/bazi_detail.ts 'st.changsheng.get(s)!.indexOf(b)' 'st.changsheng.get(STEMS[STEMS.indexOf(s) & ~1]!)!.indexOf(b)'
run "M6 十神日干与他干对调" src/bazi_detail.ts 'st.shishen.get(`${dayStem}|${other}`)!' 'st.shishen.get(`${other}|${dayStem}`)!'
```
