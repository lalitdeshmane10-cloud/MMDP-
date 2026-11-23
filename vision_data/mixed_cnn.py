"""Fine-tune ImageNet CNNs on balanced frames from multiple flute recordings."""
from pathlib import Path
import json
import cv2
import numpy as np
import pandas as pd
import torch
from torch import nn
from torchvision.models import resnet18, resnet50

root = Path("datasets")
out = root / "vision_evaluation/mixed_cnn"
out.mkdir(exist_ok=True)
names = "Sa|komal Re|Re|komal Ga|Ga|Ma|tivra Ma|Pa|komal Dha|Dha|komal Ni|Ni".split("|")
# Generous session-calibrated boxes, estimated from one still per camera setup.
boxes = {"krishna_theme": (.02,.50,1,.77), "sairat": (.025,.41,.69,.69),
         "mera_naam_tu": (.28,.38,.99,.66), "omg_tune": (.30,.39,1,.65)}
own_box = (.23,.45,1,.78)
manifest = json.loads((root/"reels_data/manifest.json").read_text())
captions = {m["recording_id"]:m["caption_crop_xyxy"] for m in manifest}
reels = pd.read_csv(root/"reels_data/annotations.csv").dropna(subset=["estimated_swara"]).copy()
reels["target"] = reels.estimated_swara
reels["folder"] = "reels_data"
own = pd.read_csv(root/"vision_prepared/annotations.csv")
own["target"] = own.prompted_swara
own["folder"] = "vision_prepared"
split = pd.read_csv(root/"vision_evaluation/pilot/splits.csv")
rows = pd.concat([own,reels],ignore_index=True).drop(columns=["split","player_id"]).merge(split,on="recording_id",validate="many_to_one")
rows.to_csv(out/"manifest.csv",index=False)
torch.set_num_threads(3)
train = np.flatnonzero(rows.split=="train")
validation = np.flatnonzero(rows.split=="validation")
test = np.flatnonzero(rows.split=="test")
y = torch.tensor([names.index(n) for n in rows.target])
# Give each swara equal probability, then balance contributing recordings within it.
groups = rows.iloc[train].groupby(["target","recording_id"]).size()
counts = groups.groupby(level=0).size()
sampling = torch.tensor([1/(counts[n]*groups[n,r]) for n,r in rows.iloc[train][["target","recording_id"]].itertuples(index=False,name=None)])
summary=[]
for cropped in [True,False]:
    images=[]
    for r in rows.itertuples():
        im=cv2.imread(str(root/r.folder/r.frame_path))
        if r.recording_id in captions:
            a,b,c,d=captions[r.recording_id]
            im[b:d,a:c]=0
        if cropped:
            h,w=im.shape[:2]
            a,b,c,d=boxes.get(r.recording_id,own_box)
            im=im[int(h*b):int(h*d),int(w*a):int(w*c)]
        images.append(cv2.cvtColor(cv2.resize(im,(112,64),interpolation=cv2.INTER_AREA),cv2.COLOR_BGR2RGB))
    pixels=torch.from_numpy(np.stack(images)).permute(0,3,1,2)
    for depth in ([18,50] if cropped else [50]):
        torch.manual_seed(47)
        model=(resnet18 if depth==18 else resnet50)()
        checkpoint="resnet18-f37072fd.pth" if depth==18 else "resnet50.pth"
        model.load_state_dict(torch.load(Path("vision_data/weights")/checkpoint))
        model.fc=nn.Linear(model.fc.in_features,12)
        model.eval()
        trunk=nn.Sequential(*list(model.children())[:7])
        tail=nn.Sequential(model.layer4,model.avgpool,nn.Flatten(),model.fc)
        features=[]
        with torch.no_grad():
            for batch in pixels.split(32):
                x=batch.float()/255
                x=(x-torch.tensor([.485,.456,.406])[None,:,None,None])/torch.tensor([.229,.224,.225])[None,:,None,None]
                features.append(trunk(x))
        x=torch.cat(features)
        optimizer=torch.optim.AdamW(tail.parameters(),lr=.0001)
        key=f"resnet{depth}_{'crop' if cropped else 'full'}"
        best=-1
        for epoch in range(3):
            order=train[torch.multinomial(sampling,len(train),replacement=True).numpy()]
            for batch in np.array_split(order,40):
                optimizer.zero_grad()
                nn.functional.cross_entropy(tail(x[batch]),y[batch]).backward()
                optimizer.step()
            with torch.no_grad():
                pred=torch.cat([tail(b).argmax(1) for b in x[validation].split(32)])
                score=pred.eq(y[validation]).float().mean().item()
            if score>best:
                best=score
                torch.save(tail.state_dict(),out/(key+".pt"))
        tail.load_state_dict(torch.load(out/(key+".pt")))
        with torch.no_grad():
            pred=torch.cat([tail(b).argmax(1) for b in x[test].split(32)])
        rows.loc[test,key]=[names[i] for i in pred]
        summary.append(dict(model=key,validation=best,test=pred.eq(y[test]).float().mean().item(),n_test=len(test)))
        pd.DataFrame(summary).to_csv(out/"metrics.csv",index=False)
        rows.iloc[test].to_csv(out/"predictions.csv",index=False)
        print(summary[-1],flush=True)
