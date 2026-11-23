"""Replay timestamped held-out takes with a rigid flute grid and independent finger tracking."""
import argparse
import json
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
import pandas as pd
import torch
from torchvision.models import mobilenet_v3_small

root = Path("datasets/vision_evaluation")
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--bamboo-anchor", action="store_true")
args = parser.parse_args()
out = root / ("bamboo_fusion" if args.bamboo_anchor else "tracked_fusion")
out.mkdir(exist_ok=True)
mixed = pd.read_csv(root/"mixed_cnn/manifest.csv")
train = mixed[mixed.split.eq("train")].copy()
coverage = train.groupby("target").agg(frames=("target","size"), players=("player_id","nunique"), takes=("recording_id","nunique"))
coverage.to_csv(out/"coverage.csv")
# Equal expected exposure per note and contributing recording, with no changes to splits.
group = train.groupby(["target","recording_id"]).target.transform("size")
train["sampling_probability"] = 1/(len(coverage)*train.target.map(coverage.takes)*group)
assert np.allclose(train.groupby("target").sampling_probability.sum(),1/len(coverage))
train[["frame_path","folder","target","recording_id","sampling_probability"]].to_csv(out/"training_sampler.csv",index=False)
print(coverage, flush=True)

torch.set_num_threads(2)
model=mobilenet_v3_small()
model.classifier=torch.nn.Linear(576,3)
model.load_state_dict(torch.load(root/"local_holes/mobilenet.pt"))
model.eval()
rows=pd.read_csv(root/"pretrained/predictions.csv").query("part=='prompt_test'").copy()
seeds=pd.read_csv(root/"local_holes/closure.csv").groupby("recording_id").first()
names="Sa|komal Re|Re|komal Ga|Ga|Ma|tivra Ma|Pa|komal Dha|Dha|komal Ni|Ni".split("|")
chart=["2220","221","220","21","20","1","0","222222","222221","222220","22221","22220"]
importance=np.array([1.6,1.4,1.2,1,.9,.8])
rows["fused"]=rows.pesto
manual_path=root/"tracked_fusion/calibration.json"
manual=json.loads(manual_path.read_text()) if manual_path.exists() else {}
demo=None
for rid,segment in rows.groupby("recording_id"):
    if rid not in manual and rid not in seeds.index: continue
    seed=manual.get(rid)
    if seed is None:
        seed=dict(timestamp_ms=seeds.loc[rid,"timestamp_ms"],points=json.loads(seeds.loc[rid,"positions_xy"]))
    holes=np.array(seed["points"],np.float32)
    assert holes.shape==(6,2)
    capture=cv2.VideoCapture(segment.video_path.iloc[0])
    samples=list(segment.itertuples())
    i=0
    previous=None
    reference=None
    anchor_points=None
    guess=None
    seed_holes=holes.copy()
    opts=mp.tasks.vision.HandLandmarkerOptions(base_options=mp.tasks.BaseOptions(model_asset_path="vision_data/weights/hands.task"),num_hands=2,running_mode=mp.tasks.vision.RunningMode.VIDEO)
    with mp.tasks.vision.HandLandmarker.create_from_options(opts) as tracker:
        while i<len(samples):
            ok,frame=capture.read()
            if not ok:break
            t=capture.get(cv2.CAP_PROP_POS_MSEC)
            if t+0.5<seed["timestamp_ms"]:continue
            gray=cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY)
            spacing=np.linalg.norm(holes[-1]-holes[0])/5
            if args.bamboo_anchor:
                if reference is None:
                    reference = gray
                    step = (holes[-1]-holes[0])/5
                    ends = seed.get("bamboo_ends", [holes[0]-3*step, holes[0]-1.1*step])
                    mask = np.zeros_like(gray)
                    first, last = np.asarray(ends).astype(int)
                    cv2.line(mask, tuple(first), tuple(last), 255, max(8,round(spacing*.6)))
                    anchor_points = cv2.goodFeaturesToTrack(gray,40,.01,3,mask=mask)
                    if anchor_points is None or len(anchor_points)<4:
                        break
                    guess = anchor_points.copy()
                forward,ok1,_ = cv2.calcOpticalFlowPyrLK(
                    reference,gray,anchor_points,guess.copy(),flags=cv2.OPTFLOW_USE_INITIAL_FLOW)
                back,ok2,_ = cv2.calcOpticalFlowPyrLK(gray,reference,forward,None)
                keep = (ok1.ravel()>0)&(ok2.ravel()>0)&(np.linalg.norm(anchor_points-back,axis=2).ravel()<1.5)
                if keep.sum()<4:
                    continue
                transform,inliers=cv2.estimateAffinePartial2D(anchor_points[keep],forward[keep],ransacReprojThreshold=2)
                if transform is None or inliers.sum()<4 or not .78<np.linalg.norm(transform[0,:2])<1.25:
                    continue
                guess=cv2.transform(anchor_points,transform)
                holes=cv2.transform(seed_holes[None],transform)[0]
                spacing=np.linalg.norm(holes[-1]-holes[0])/5
            elif previous is not None:
                mask=np.zeros_like(gray)
                cv2.line(mask,tuple(holes[0].astype(int)),tuple(holes[-1].astype(int)),255,max(6,round(spacing*.7)))
                points=cv2.goodFeaturesToTrack(previous,60,.01,3,mask=mask)
                if points is None or len(points)<4:break
                forward,ok1,_=cv2.calcOpticalFlowPyrLK(previous,gray,points,None)
                back,ok2,_=cv2.calcOpticalFlowPyrLK(gray,previous,forward,None)
                keep=ok1.ravel().astype(bool)&ok2.ravel().astype(bool)&(np.linalg.norm(points-back,axis=2).ravel()<1.5)
                if keep.sum()<4:break
                transform,inliers=cv2.estimateAffinePartial2D(points[keep],forward[keep],ransacReprojThreshold=2)
                if transform is None or inliers.sum()<4 or not .94<np.linalg.norm(transform[0,:2])<1.06:break
                holes=cv2.transform(holes[None],transform)[0]
            previous=gray
            while i<len(samples) and samples[i].timestamp_ms < t-18:i+=1
            if i==len(samples) or abs(samples[i].timestamp_ms-t)>18:continue
            row=samples[i]
            i+=1
            rgb=cv2.cvtColor(frame,cv2.COLOR_BGR2RGB)
            result=tracker.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB,data=rgb),round(t))
            if len(result.hand_landmarks)!=2:continue
            h,w=gray.shape
            hands=[np.array([(p.x*w,p.y*h) for p in hand]) for hand in result.hand_landmarks]
            pads=np.concatenate([(hand[[7,11,15]]+hand[[8,12,16]])/2 for hand in hands])
            dist=np.linalg.norm(holes[:,None]-pads[None],axis=2).min(axis=1)/max(spacing,1)
            side=max(12,round(spacing*1.2))
            patches=[cv2.resize(cv2.getRectSubPix(rgb,(side,side),tuple(p)),(48,48)) for p in holes]
            x=torch.tensor(np.stack(patches)).permute(0,3,1,2).float()/255
            x=(x-torch.tensor([.485,.456,.406])[None,:,None,None])/torch.tensor([.229,.224,.225])[None,:,None,None]
            with torch.no_grad():probs=model(x).softmax(-1).numpy()
            expected=np.array([1,.5,0])
            logp=np.log(probs.clip(1e-7))-.5*((dist[:,None].clip(0,1.5)-expected)/.45)**2
            scores=np.array([np.average(logp[np.arange(len(p)),list(map(int,p))],weights=importance[:len(p)]) for p in chart])
            idx=row.Index
            rows.loc[idx,"visual"]=names[scores.argmax()]
            rows.loc[idx,"hole_xy"]=json.dumps(holes.tolist())
            rows.loc[idx,"distance_in_spacings"]=json.dumps(dist.tolist())
            if row.pesto in names:
                steps=np.abs(np.arange(12)-names.index(row.pesto))
                steps=np.minimum(steps,12-steps)
                combined=scores-(1+4*row.pesto_conf)*steps**2
                rows.loc[idx,"fused"]=names[combined.argmax()]
            for j,p in enumerate(holes.astype(int)):
                cv2.circle(frame,tuple(p),4,(0,220,255),2)
                cv2.putText(frame,str(j+1),tuple(p+[2,-5]),0,.4,(0,220,255),1)
            for p in pads.astype(int):cv2.circle(frame,tuple(p),3,(255,200,0),-1)
            if demo is None:demo=cv2.VideoWriter(str(out/"tracked_samples.mp4"),cv2.VideoWriter_fourcc(*"mp4v"),2,(w,h))
            demo.write(frame)
    capture.release()
if demo is not None:demo.release()
rows.to_csv(out/"predictions.csv",index=False)
print("coverage",rows.visual.notna().sum() if "visual" in rows else 0,"audio",rows.pesto.eq(rows.target).sum(),"fused",rows.fused.eq(rows.target).sum(),"changes",rows.fused.ne(rows.pesto).sum(),"total",len(rows))
