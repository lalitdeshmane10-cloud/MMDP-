"""Player-disjoint pilot. Run from the project root with vision_data/vendor on PYTHONPATH."""
import json
import subprocess
import tempfile
from pathlib import Path
from time import perf_counter

import cv2
import mediapipe as mp
import numpy as np
import pandas as pd
import pesto
import timm
import torch
from scipy.io import wavfile
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from torchvision.models import resnet18

torch.manual_seed(17)
torch.set_num_threads(3)
root = Path("datasets")
weights = Path("vision_data/weights")
out = root / "vision_evaluation/pretrained"
out.mkdir(exist_ok=True)
names = "Sa|komal Re|Re|komal Ga|Ga|Ma|tivra Ma|Pa|komal Dha|Dha|komal Ni|Ni".split("|")
reels = pd.read_csv(root / "reels_data/annotations.csv")
reels["part"] = reels.player_id.map({"shivam_thefluteguy":"train", "harshvdave":"validation", "parth_flute":"reel_test"})
reels["folder"] = "reels_data"
reels["target"] = reels.estimated_swara
# Deterministic ~4 Hz sample, independent of note identity.
reels = reels[reels.groupby("recording_id").cumcount()%8 == 0]
own = pd.read_csv(root / "vision_prepared/annotations.csv")
own["part"] = np.where(own.prompted_swara=="Sa","calibration","prompt_test")
own["target"] = own.prompted_swara
own["folder"] = "vision_prepared"
rows = pd.concat([reels,own],ignore_index=True)
meta = {m["recording_id"]:m for m in json.loads((root/"reels_data/manifest.json").read_text())}
views = {"fixed":[], "tracked":[]}
geometry = []
track_times = []
for rid, group in rows.groupby("recording_id",sort=False):
    options = mp.tasks.vision.HandLandmarkerOptions(base_options=mp.tasks.BaseOptions(model_asset_path=str(weights/"hands.task")),num_hands=2,running_mode=mp.tasks.vision.RunningMode.VIDEO)
    with mp.tasks.vision.HandLandmarker.create_from_options(options) as tracker:
        for r in group.itertuples():
            rgb = cv2.cvtColor(cv2.imread(str(root/r.folder/r.frame_path)),cv2.COLOR_BGR2RGB)
            if rid in meta:
                a,b,c,d=meta[rid]["caption_crop_xyxy"]
                rgb[b:d,a:c]=0
            h,w=rgb.shape[:2]
            fixed=rgb[h//5:4*h//5,w//12:11*w//12]
            start=perf_counter()
            detection=tracker.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB,data=rgb),round(r.timestamp_ms))
            track_times.append(1000*(perf_counter()-start))
            hands=[np.array([(p.x*w,p.y*h) for p in hand]) for hand in detection.hand_landmarks]
            tracked=fixed
            features=np.full(12,np.nan)
            if len(hands)==2:
                pts=np.concatenate(hands)
                lo=pts.min(0); hi=pts.max(0); pad=np.maximum((hi-lo)*.2,8)
                x,y=np.maximum(lo-pad,0).astype(int)
                X,Y=np.minimum(hi+pad,[w,h]).astype(int)
                if X>x and Y>y: tracked=rgb[y:Y,x:X]
                # Relative tip extension and bend for index, middle and ring fingers.
                ordered=sorted(hands,key=lambda hand:hand[0,0])
                features=[]
                for hand in ordered:
                    scale=max(1,np.linalg.norm(hand[9]-hand[0]))
                    for tip in [8,12,16]:
                        features.extend([np.linalg.norm(hand[tip]-hand[tip-3])/scale,np.linalg.norm(hand[tip]-hand[tip-2])/scale])
            geometry.append(features)
            for key,crop in [('fixed',fixed),('tracked',tracked)]:
                views[key].append(cv2.resize(crop,(112,112)))
rows["both_hands"]=np.isfinite(geometry).all(1)
rows["tracker_ms"]=track_times
train=(rows.part=="train") & rows.target.notna()
classes=rows.target.map(dict(zip(names,range(12)))).fillna(-1)
# Identical weak supervision for all vision models.
geom=make_pipeline(StandardScaler(),LogisticRegression(max_iter=500))
usable=train & rows.both_hands
if usable.any() and classes[usable].nunique()>1:
    geom.fit(np.array(geometry)[usable],classes[usable])
    rows.loc[rows.both_hands,"geometry"]=[names[int(i)] for i in geom.predict(np.array(geometry)[rows.both_hands])]
for backbone in ["resnet","dino"]:
    for view in views:
        torch.manual_seed(17)
        if backbone=="resnet":
            model=resnet18()
            model.load_state_dict(torch.load(weights/"resnet18-f37072fd.pth"))
            model.fc=torch.nn.Linear(512,12)
            layers=[model.layer4,model.fc]
        else:
            model=timm.create_model("vit_small_patch14_dinov2",img_size=112,num_classes=12)
            state=torch.load(weights/"dinov2.pth")
            state.pop("mask_token")
            state["pos_embed"]=timm.layers.resample_abs_pos_embed(state["pos_embed"],(8,8))
            missing=model.load_state_dict(state,strict=False)
            assert set(missing.missing_keys)=={"head.weight","head.bias"} and not missing.unexpected_keys
            layers=[model.blocks[-1],model.head]
        model.requires_grad_(False).eval()
        for layer in layers: layer.requires_grad_(True)
        opt=torch.optim.AdamW([p for p in model.parameters() if p.requires_grad],lr=.0003)
        x=torch.tensor(np.stack(views[view])).permute(0,3,1,2).float()/255
        x=(x-torch.tensor([.485,.456,.406])[None,:,None,None])/torch.tensor([.229,.224,.225])[None,:,None,None]
        idx=torch.tensor(np.flatnonzero(train))
        y=torch.tensor(classes.to_numpy(),dtype=torch.long)
        for epoch in range(4):
            for batch in idx[torch.randperm(len(idx))].split(16):
                opt.zero_grad()
                torch.nn.functional.cross_entropy(model(x[batch]),y[batch]).backward()
                opt.step()
        with torch.no_grad(): probs=torch.cat([model(b).softmax(1) for b in x.split(16)]).numpy()
        key=backbone+"_"+view
        rows[key]=[names[i] for i in probs.argmax(1)]
        np.save(out/(key+".npy"),probs)
        torch.save({n:p.detach() for n,p in model.named_parameters() if p.requires_grad},out/(key+".pt"))
        rows.to_csv(out/"predictions.csv",index=False)
        print(key,"complete",flush=True)

ffmpeg=next(Path("reel_dataset/downloads/.deps").rglob("ffmpeg*.exe"))
for rid,group in rows.groupby("recording_id",sort=False):
    if group.part.iloc[0]=="train":continue
    with tempfile.TemporaryDirectory() as tmp:
        path=Path(tmp)/"audio.wav"
        subprocess.run([str(ffmpeg),"-loglevel","error","-i",group.video_path.iloc[0],"-ac","1","-ar","16000",str(path)],check=True)
        sr,sig=wavfile.read(path)
        _,hz,conf,_=pesto.predict(torch.tensor(sig.astype(np.float32)/32768),sr)
        yin=json.loads(subprocess.check_output(["node","reel_dataset/track_audio.mjs",str(path)]))
    times=np.rint(group.timestamp_ms/10).astype(int)
    rows.loc[group.index,"yin_hz"]=[yin[min(i,len(yin)-1)].get("hz",np.nan) for i in times]
    indices=np.minimum(times,len(hz)-1)
    rows.loc[group.index,"pesto_hz"]=hz.numpy()[indices]
    rows.loc[group.index,"pesto_conf"]=conf.numpy()[indices]
calibration=rows[rows.part=="calibration"].yin_hz.median()
for rid,g in rows[~train & rows.yin_hz.notna() | rows.pesto_hz.notna()].groupby("recording_id"):
    sa=calibration if rid not in meta else 440*2**(("C C# D D# E F F# G G# A A# B".split().index(meta[rid]["inferred_sa"]["pitch_class"])-9)/12)
    for algo in ["yin","pesto"]:
        rows.loc[g.index,algo]=[names[round(12*np.log2(f/sa))%12] if pd.notna(f) and f>0 else '' for f in g[algo+"_hz"]]
rows.to_csv(out/"predictions.csv",index=False)

