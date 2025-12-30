python - << 'PY'
import csv, collections

branch_names = {"高知駅前","桟橋通五丁目","桟橋五丁目","桟橋車庫前","桟橋四丁目","梅ノ辻"}
trip_to_branch = collections.Counter()

with open("stop_times.txt", encoding="utf-8") as f:
    r = csv.DictReader(f)
    for row in r:
        tid = row["trip_id"]
        hs  = (row.get("stop_headsign") or "")
        # stop_headsignに支線っぽい文字が入るならそれも拾う（保険）
        if any(k in hs for k in ["桟橋", "高知駅前"]):
            trip_to_branch[tid] += 1

print("支線っぽい stop_headsign を含む trip数:", sum(1 for k,v in trip_to_branch.items() if v>0))
print("例（上位10）:", trip_to_branch.most_common(10))
PY