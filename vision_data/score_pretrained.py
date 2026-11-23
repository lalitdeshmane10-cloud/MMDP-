"""Score the reel-trained models against held-out take prompts."""
from pathlib import Path
import numpy as np
import pandas as pd

out = Path("datasets/vision_evaluation/pretrained")
rows = pd.read_csv(out / "predictions.csv")
names = "Sa|komal Re|Re|komal Ga|Ga|Ma|tivra Ma|Pa|komal Dha|Dha|komal Ni|Ni".split("|")
models = ["resnet_fixed", "resnet_tracked", "dino_fixed", "dino_tracked"]
val = rows.part.eq("validation") & rows.target.notna()
test = rows.part.eq("prompt_test")
winner = max(models, key=lambda key: (rows.loc[val,key] == rows.loc[val,"target"]).mean())
prob = np.load(out / (winner + ".npy"))
# Fixed fusion rule: visual fallback on missing audio or a low-confidence PESTO observation.
for audio in ["yin","pesto"]:
    use = rows[audio].isna()
    if audio == "pesto":
        use |= rows.pesto_conf.lt(.5)
    rows[audio+"_fusion"] = rows[audio].where(~use,rows[winner])
metrics = []
for key in ["geometry", *models, "yin","yin_fusion","pesto","pesto_fusion"]:
    for split in ["validation","reel_test","prompt_test"]:
        mask = rows.part.eq(split) & rows.target.notna()
        metrics.append(dict(model=key,split=split,n=int(mask.sum()),coverage=rows.loc[mask,key].notna().mean(),
                            agreement=rows.loc[mask,key].eq(rows.loc[mask,"target"]).mean()))
metrics=pd.DataFrame(metrics)
metrics.to_csv(out/"metrics.csv",index=False)
rows.to_csv(out/"predictions.csv",index=False)
print("Selected:",winner)
print(metrics.pivot(index="model",columns="split",values="agreement").round(3))
print("Tracker time (median, p95 ms)",rows.tracker_ms.quantile([.5,.95]).round(1).tolist())
print("Two hands on prompt test",rows.loc[test,"both_hands"].mean())
