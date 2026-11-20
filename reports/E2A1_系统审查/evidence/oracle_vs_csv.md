# 证据：审查起点时十张 CSV 与独立推导逐格比对（步骤 4.2）

运行：`python3 oracle_vs_csv.py engine/data/static xuanshu-data/crosscheck/gemini/G-1_对照推算_ref.py`（仓库外；引擎仓库禁止 .py，故以文本存档）。此比对随后固化为数据仓库 check_static_oracle 与引擎 test/oracle.test.ts。

输出：
```json
{
 "cells": {
  "liuyao_hexagrams": 448,
  "liuyao_palace_wuxing": 8,
  "liuyao_najia": 48,
  "branch_wuxing": 12,
  "liuyao_liuqin": 25,
  "liuyao_liushen": 60,
  "xunkong": 180,
  "bazi_shishen": 100,
  "bazi_changsheng": 120,
  "bazi_canggan(集合)": 12
 },
 "total": 1013,
 "diffs": []
}
```

## oracle_vs_csv.py
```python
# 现行 10 张静态表 CSV 与独立规则推算（G-1_对照推算_ref.py）逐格比对。只读，不改任何文件。
import csv, sys, json
ref = {}; exec(open(sys.argv[2], encoding="utf-8").read(), ref)
D = sys.argv[1]
def load(n): return list(csv.DictReader(open(f"{D}/{n}.csv", encoding="utf-8")))
S, B, TRI, PAL, NAJIA, BEL = ref["S"], ref["B"], ref["TRI"], ref["PAL"], ref["NAJIA"], ref["BEL"]
PW = {"乾":"金","兑":"金","离":"火","震":"木","巽":"木","坎":"水","艮":"土","坤":"土"}  # 八宫五行=本宫卦五行（八卦五行）
cells = {}; diffs = []
def cmp(t, key, got, want):
    cells[t] = cells.get(t, 0) + 1
    if got != want: diffs.append((t, key, got, want))
for r in load("liuyao_hexagrams"):
    b = r["bits_bottom_up"]; p = PAL[b]; lo, up = TRI[b[:3]], TRI[b[3:]]
    for f, w in [("lower", lo), ("upper", up), ("name", ref["fullname"](up, lo)), ("palace", p[0]), ("palace_position", p[1]), ("shi", str(p[2])), ("ying", str(p[3]))]:
        cmp("liuyao_hexagrams", f"{b}.{f}", r[f], w)
for r in load("liuyao_palace_wuxing"): cmp("liuyao_palace_wuxing", r["palace"], r["wuxing"], PW[r["palace"]])
for r in load("liuyao_najia"): cmp("liuyao_najia", f'{r["trigram"]}{r["line"]}', r["stem_branch"], NAJIA[r["trigram"]][int(r["line"]) - 1])
for r in load("branch_wuxing"): cmp("branch_wuxing", r["branch"], r["wuxing"], BEL[r["branch"]])
for r in load("liuyao_liuqin"): cmp("liuyao_liuqin", r["self_wuxing"] + r["line_wuxing"], r["liuqin"], ref["liuqin"](r["self_wuxing"], r["line_wuxing"]))
for r in load("liuyao_liushen"):
    for k in range(6): cmp("liuyao_liushen", f'{r["day_stem"]}{k+1}', r[f"line{k+1}"], ref["GODS"][(ref["GSTART"][r["day_stem"]] + k) % 6])
for r in load("xunkong"):
    i = [k for k in range(60) if S[k % 10] + B[k % 12] == r["ganzhi"]][0]; h = i - i % 10
    for f, w in [("xun_head", S[h % 10] + B[h % 12]), ("void1", B[(h + 10) % 12]), ("void2", B[(h + 11) % 12])]: cmp("xunkong", f'{r["ganzhi"]}.{f}', r[f], w)
for r in load("bazi_shishen"): cmp("bazi_shishen", r["day_stem"] + r["other_stem"], r["shishen"], ref["shishen"](r["day_stem"], r["other_stem"]))
cols = ["changsheng","muyu","guandai","linguan","diwang","shuai","bing","si","mu","jue","tai","yang"]
for r in load("bazi_changsheng"):
    st, d = ref["CS"][r["stem"]]
    for k, c in enumerate(cols): cmp("bazi_changsheng", f'{r["stem"]}.{c}', r[c], B[(B.index(st) + d * k) % 12])
# 藏干：规则推算无“三列次序”的独立来源，只比对“所藏之干的集合”（《渊海子平》〈又地支藏遁歌〉原文）
GE = "子宫癸水在其中，丑癸辛金己土同，寅宫甲木兼丙戊，卯宫乙木独相逢，辰藏乙戊三分癸，巳中庚金丙戊丛，午宫丁火并己土，未宫乙己丁共宗，申位庚金壬水戊，酉宫辛字独丰隆，戌宫辛金及丁戊，亥藏壬甲是真踪"
sets = {c[0]: sorted({x for x in c[1:] if x in S}) for c in GE.split("，")}
for r in load("bazi_canggan"): cmp("bazi_canggan(集合)", r["branch"], sorted(x for x in (r["benqi"], r["zhongqi"], r["yuqi"]) if x), sets[r["branch"]])
print(json.dumps({"cells": cells, "total": sum(cells.values()), "diffs": diffs}, ensure_ascii=False, indent=1))
```
