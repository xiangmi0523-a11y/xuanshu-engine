# 装卦与八字查表：期望值推导脚本（独立 Python）

只用规则推算与原文卦例，不读 `data/static/` 的静态表，也不调用引擎；运行后生成 `vectors/zhuanggua.json`。依赖的规则推算函数见数据仓库 `crosscheck/gemini/G-1_对照推算_ref.py`（全文附后）。

```python
# 装卦与八字查表的独立期望值：只用规则推算（京房八宫由本宫逐爻变出、纳甲口诀、生克、六神起例、六旬），
# 不读 Muse 的静态表 CSV，也不调用引擎。另含《增删卜易》乾为天卦例（Muse M-1 T3 旁证所引原文）。
import json
exec(open("/home/claude/g1/ref.py",encoding="utf-8").read())
def zg(yao, day):
    ben="".join("1" if v in (7,9) else "0" for v in yao)
    mov=[i+1 for i,v in enumerate(yao) if v in (6,9)]
    bian="".join(("0" if ben[i]=="1" else "1") if (i+1) in mov else ben[i] for i in range(6)) if mov else None
    PW={"乾":"金","兑":"金","离":"火","震":"木","巽":"木","坎":"水","艮":"土","坤":"土"}
    def one(bits, me, gods):
        lo,up=TRI[bits[:3]],TRI[bits[3:]]; p=PAL[bits]
        lines=[]
        for i in range(6):
            gz=NAJIA[lo if i<3 else up][i]
            d={"stem_branch":gz,"wuxing":BEL[gz[1]],"liuqin":liuqin(me,BEL[gz[1]])}
            if gods: d["liushen"]=gods[i]
            lines.append(d)
        return {"name":fullname(up,lo),"palace":p[0],"palace_position":p[1],"shi":p[2],"ying":p[3],"lines":lines}
    me={"乾":"金","兑":"金","离":"火","震":"木","巽":"木","坎":"水","艮":"土","坤":"土"}[PAL[ben][0]]
    gods=[GODS[(GSTART[day[0]]+k)%6] for k in range(6)]
    i=S.index(day[0]); j=B.index(day[1]); idx=[k for k in range(60) if k%10==i and k%12==j][0]; h=idx-idx%10
    return {"ben":one(ben,me,gods),"bian":one(bian,me,None) if bian else None,"moving":mov,
            "xunkong":{"xun_head":S[h%10]+B[h%12],"void":[B[(h+10)%12],B[(h+11)%12]]}}
cases=[
 ("ZG01_QIAN_STATIC",[7,7,7,7,7,7],"甲子","乾为天静卦；六亲与《增删卜易》乾为天卦例一致（上→初：父母戌土、兄弟申金、官鬼午火、父母辰土、妻财寅木、子孙子水）"),
 ("ZG02_QIAN_TO_GOU",[9,7,7,7,7,7],"戊戌","乾初九动变天风姤（乾宫一世）；变爻丑土仍依乾宫金论父母（P-B-04）；戊日六神勾陈起；甲午旬辰巳空"),
 ("ZG03_GU_XUN_GUIHUN",[8,7,7,8,8,7],"丁卯","山风蛊为巽宫归魂（P-B-01 巽宫末从胡一桂）；世三应六；静卦"),
 ("ZG04_JIN_TO_XU_CROSS_PALACE",[6,6,6,9,6,9],"癸亥","火地晋（乾宫游魂）六爻皆动变水天需（坤宫游魂）；变卦寻宫按变卦本身，六亲仍依本卦乾宫金"),
 ("ZG05_TAI_TWO_MOVING",[9,7,7,8,6,8],"庚申","地天泰（坤宫三世）初、五爻动变；庚日白虎起"),
]
out=[]
for cid,yao,day,why in cases:
    out.append({"id":cid,"yao":yao,"day_ganzhi":day,"expect":zg(yao,day),"basis":why})
# 乾为天卦例核对（原文，上→初）
q=[l["liuqin"]+l["stem_branch"][1]+l["wuxing"] for l in out[0]["expect"]["ben"]["lines"]][::-1]
assert q==["父母戌土","兄弟申金","官鬼午火","父母辰土","妻财寅木","子孙子水"], q
# 八字：ResultNormal 示例 庚午 甲申 壬子 丁未（日主壬）
pill=["庚午","甲申","壬子","丁未"]; dm="壬"
bz={"pillars":pill,"stem_shishen":[shishen(dm,p[0]) if i!=2 else "日主" for i,p in enumerate(pill)],
    "day_master_changsheng":[STATES[[B[(B.index(CS[dm][0])+CS[dm][1]*k)%12] for k in range(12)].index(p[1])] for p in pill]}
# 藏干集合：Muse M-1 T8 来源 1 所引《渊海子平》〈又地支藏遁歌〉原文
GE="子宫癸水在其中，丑癸辛金己土同，寅宫甲木兼丙戊，卯宫乙木独相逢，辰藏乙戊三分癸，巳中庚金丙戊丛，午宫丁火并己土，未宫乙己丁共宗，申位庚金壬水戊，酉宫辛字独丰隆，戌宫辛金及丁戊，亥藏壬甲是真踪"
sets={}
for clause in GE.split("，"):
    sets[clause[0]]=sorted({c for c in clause[1:] if c in S})
json.dump({"spec":"vectors/SPEC.md §8","generated_by":"独立 Python（规则推算 + 原文卦例），不读静态表、不调用引擎；脚本见 reports/evidence/zhuanggua/derive.md",
           "cases":out,"bazi":bz,"canggan_sets_from_yuanhai_song":{"text":GE,"sets":sets}},open("zhuanggua.json","w",encoding="utf-8"),ensure_ascii=False,indent=1)
print("ok", [c["expect"]["ben"]["name"]+("→"+c["expect"]["bian"]["name"] if c["expect"]["bian"] else "") for c in out], bz, sets["丑"], sets["午"])
```

## 附：G-1_对照推算_ref.py

```python
# Claude 按通行规则机械推算的对照表（不是来源，只用于发现分歧）
S="甲乙丙丁戊己庚辛壬癸"; B="子丑寅卯辰巳午未申酉戌亥"
TRI={"111":"乾","110":"兑","101":"离","100":"震","011":"巽","010":"坎","001":"艮","000":"坤"}  # 初→三
BITS={v:k for k,v in TRI.items()}
IMG={"乾":"天","坤":"地","震":"雷","巽":"风","坎":"水","离":"火","艮":"山","兑":"泽"}
SHORT={ # (上,下) → 卦名
"乾":dict(乾="乾",坤="否",震="无妄",巽="姤",坎="讼",离="同人",艮="遁",兑="履"),
"坤":dict(乾="泰",坤="坤",震="复",巽="升",坎="师",离="明夷",艮="谦",兑="临"),
"震":dict(乾="大壮",坤="豫",震="震",巽="恒",坎="解",离="丰",艮="小过",兑="归妹"),
"巽":dict(乾="小畜",坤="观",震="益",巽="巽",坎="涣",离="家人",艮="渐",兑="中孚"),
"坎":dict(乾="需",坤="比",震="屯",巽="井",坎="坎",离="既济",艮="蹇",兑="节"),
"离":dict(乾="大有",坤="晋",震="噬嗑",巽="鼎",坎="未济",离="离",艮="旅",兑="睽"),
"艮":dict(乾="大畜",坤="剥",震="颐",巽="蛊",坎="蒙",离="贲",艮="艮",兑="损"),
"兑":dict(乾="夬",坤="萃",震="随",巽="大过",坎="困",离="革",艮="咸",兑="兑")}
def fullname(up,lo):
    s=SHORT[up][lo]
    return f"{s}为{IMG[up]}" if up==lo else f"{IMG[up]}{IMG[lo]}{s}"
def flip(bits,idx): b=list(bits); [b.__setitem__(i,"1" if b[i]=="0" else "0") for i in idx]; return "".join(b)
PAL={}
for p,tb in BITS.items():
    pure=tb+tb
    seq=[("本宫",pure,6)]
    for k in range(1,6): seq.append((["一世","二世","三世","四世","五世"][k-1], flip(pure,range(k)),k))
    you=flip(seq[5][1],[3]); seq.append(("游魂",you,4))
    gui=tb+you[3:]; seq.append(("归魂",gui,3))
    for pos,h,shi in seq: PAL[h]=(p,pos,shi,(shi+3-1)%6+1)
assert len(PAL)==64
NAJIA={"乾":["甲子","甲寅","甲辰","壬午","壬申","壬戌"],"坤":["乙未","乙巳","乙卯","癸丑","癸亥","癸酉"],
"震":["庚子","庚寅","庚辰","庚午","庚申","庚戌"],"巽":["辛丑","辛亥","辛酉","辛未","辛巳","辛卯"],
"坎":["戊寅","戊辰","戊午","戊申","戊戌","戊子"],"离":["己卯","己丑","己亥","己酉","己未","己巳"],
"艮":["丙辰","丙午","丙申","丙戌","丙子","丙寅"],"兑":["丁巳","丁卯","丁丑","丁亥","丁酉","丁未"]}
BEL=dict(zip(B,"水土木木土火火土金金土水"))
EL="木火土金水"
def liuqin(me,x):
    d=(EL.index(x)-EL.index(me))%5
    return {0:"兄弟",1:"子孙",2:"妻财",3:"官鬼",4:"父母"}[d]
GODS=["青龙","朱雀","勾陈","螣蛇","白虎","玄武"]
GSTART={"甲":0,"乙":0,"丙":1,"丁":1,"戊":2,"己":3,"庚":4,"辛":4,"壬":5,"癸":5}
SEL=dict(zip(S,"木木火火土土金金水水"))
def shishen(d,o):
    same=(S.index(d)%2)==(S.index(o)%2); r=(EL.index(SEL[o])-EL.index(SEL[d]))%5
    return [("比肩","劫财"),("食神","伤官"),("偏财","正财"),("七杀","正官"),("偏印","正印")][r][0 if same else 1]
STATES="长生 沐浴 冠带 临官 帝旺 衰 病 死 墓 绝 胎 养".split()
CS={"甲":("亥",1),"丙":("寅",1),"戊":("寅",1),"庚":("巳",1),"壬":("申",1),"乙":("午",-1),"丁":("酉",-1),"己":("酉",-1),"辛":("子",-1),"癸":("卯",-1)}
```
