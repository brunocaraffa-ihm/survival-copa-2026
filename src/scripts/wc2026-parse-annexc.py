import re,json
html=open("page.html").read()
tables=re.findall(r"<table\b.*?</table>", html, flags=re.S)
t=tables[0]
rows=re.findall(r"<tr\b.*?</tr>", t, flags=re.S)
def expand(row):
    out=[]
    for m in re.finditer(r"<(t[hd])\b([^>]*)>(.*?)</\1>", row, flags=re.S):
        cs=re.search(r'colspan="?(\d+)', m.group(2)); cs=int(cs.group(1)) if cs else 1
        txt=re.sub(r"<[^>]+>","",m.group(3)).replace("&#160;"," ").replace("&nbsp;"," ").strip()
        out+= [txt]*cs
    return out

SLOTS=["A","B","D","E","G","I","K","L"]  # column order in header
annexC=[]
errors=[]
elig={s:set() for s in SLOTS}

for i in range(1,496):
    ex=expand(rows[i])
    groups=[c for c in ex if re.fullmatch(r"[A-L]",c)]
    thirds=[c[1] for c in ex if re.fullmatch(r"3[A-L]",c)]  # letter only, in column order
    if len(groups)!=8 or len(thirds)!=8:
        errors.append(("count",i,groups,thirds)); continue
    assign={SLOTS[j]:thirds[j] for j in range(8)}
    annexC.append({"no":i,"groups":sorted(groups),"assign":assign})
    for s in SLOTS:
        elig[s].add(assign[s])

# VALIDATIONS
val={}
val["row_count"]=len(annexC)
val["row_count_ok"]= (len(annexC)==495)

# bijection: assigned thirds == qualifying groups (set), each used once
bij_fail=[]
for r in annexC:
    used=sorted(r["assign"].values())
    if used != r["groups"]:
        bij_fail.append(r["no"])
    if len(set(used))!=8:
        bij_fail.append(("dup",r["no"]))
val["bijection_ok"]=(len(bij_fail)==0)
val["bijection_failures"]=bij_fail[:20]

# eligibility respected (trivially yes since derived from data) - report sets
elig_sorted={s:sorted(elig[s]) for s in SLOTS}
val["eligibility"]=elig_sorted
val["eligibility_sizes"]={s:len(elig[s]) for s in SLOTS}

# self-group check: slot for winner of group X never faces 3X
self_fail=[]
for r in annexC:
    for s,third in r["assign"].items():
        if s==third:
            self_fail.append((r["no"],s))
val["no_self_group_ok"]=(len(self_fail)==0)
val["self_group_failures"]=self_fail[:20]

# every row respects derived eligibility (sanity)
er=[]
for r in annexC:
    for s,third in r["assign"].items():
        if third not in elig[s]:
            er.append((r["no"],s,third))
val["all_rows_respect_eligibility"]=(len(er)==0)

json.dump({"annexC":annexC,"validation":val,"slots":SLOTS}, open("annexc_parsed.json","w"), indent=1)
print("errors during parse:",len(errors))
print(json.dumps({k:v for k,v in val.items() if k not in ("eligibility",)}, indent=2))
print("ELIGIBILITY:")
for s in SLOTS:
    print(f"  1{s} <- {elig_sorted[s]}")
