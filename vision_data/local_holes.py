"""Weakly supervised local-hole experiment. Run with PYTHONPATH=vision_data/vendor."""
import json
from pathlib import Path
import cv2
import mediapipe as mp
import numpy as np
import pandas as pd
import torch
from torchvision.models import mobilenet_v3_small

root = Path("datasets")
weights = Path("vision_data/weights")
out = root / "vision_evaluation/local_holes"
out.mkdir(exist_ok=True)
rows = pd.read_csv(root / "vision_evaluation/pretrained/predictions.csv")
meta = {x["recording_id"]: x for x in json.loads((root/"reels_data/manifest.json").read_text())}
names = "Sa|komal Re|Re|komal Ga|Ga|Ma|tivra Ma|Pa|komal Dha|Dha|komal Ni|Ni".split("|")
# Open, partially covered and closed. Don't supervise downstream of the first vent.
patterns = ["2220","221","220","21","20","1","0","222222","222221","222220","22221","22220"]
face_detector = cv2.FaceDetectorYN.create(str(weights/"yunet.onnx"), "", (320,320), 0.6)
samples, indices, coordinates = [], [], []
for rid, group in rows.groupby("recording_id", sort=False):
    opts = mp.tasks.vision.HandLandmarkerOptions(base_options=mp.tasks.BaseOptions(model_asset_path=str(weights/"hands.task")),num_hands=2,running_mode=mp.tasks.vision.RunningMode.VIDEO)
    mouth = None
    with mp.tasks.vision.HandLandmarker.create_from_options(opts) as tracker:
        for r in group.itertuples():
            im = cv2.imread(str(root/r.folder/r.frame_path))
            if rid in meta:
                a,b,c,d = meta[rid]["caption_crop_xyxy"]
                im[b:d,a:c] = 0
            h,w = im.shape[:2]
            small = cv2.resize(im,(w//2,h//2))
            face_detector.setInputSize((small.shape[1],small.shape[0]))
            _,faces = face_detector.detect(small)
            if faces is not None:
                face = max(faces,key=lambda rect:rect[2]*rect[3])
                mouth = face[10:12]+face[12:14]  # Mean of mouth corners, scaled to original size.
                face_time = r.timestamp_ms
            rgb = cv2.cvtColor(im,cv2.COLOR_BGR2RGB)
            detection = tracker.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB,data=rgb),round(r.timestamp_ms))
            if len(detection.hand_landmarks)!=2 or mouth is None or r.timestamp_ms-face_time>1000:
                continue
            hands = [np.array([(pt.x*w,pt.y*h) for pt in hand]) for hand in detection.hand_landmarks]
            centers = [hand[[6,10,14]].mean(0) for hand in hands]
            axis = centers[1]-centers[0]
            if np.linalg.norm(axis)<12: continue
            axis /= np.linalg.norm(axis)
            if np.linalg.norm(centers[1]-mouth)<np.linalg.norm(centers[0]-mouth): axis *= -1
            # Approximate the bore from six finger-pad locations; projections are
            # candidate hole positions, including where fingers hide the bore.
            pads = np.concatenate([(hand[[7,11,15]]+hand[[8,12,16]])/2 for hand in hands])
            origin = pads.mean(0)
            along = np.sort((pads-origin)@axis)
            # Fit a regular six-site grid to the projected pads. Refine the
            # bore axis using parallel edges close to the observed fingers.
            spacing = (along[-1]-along[0])/5
            if spacing < 3: continue
            normal = np.array([-axis[1],axis[0]])
            gray = cv2.cvtColor(im,cv2.COLOR_BGR2GRAY)
            lines = cv2.HoughLinesP(cv2.Canny(gray,55,130),1,np.pi/180,20,
                                    minLineLength=max(12,round(spacing*1.3)),maxLineGap=6)
            offsets = []
            for line in ([] if lines is None else lines[:,0]):
                ends = line.reshape(2,2)
                vec = ends[1]-ends[0]
                mid = ends.mean(0)-origin
                if abs(vec@axis)>0.97*np.linalg.norm(vec) and abs(mid@normal)<spacing and abs(mid@axis)<4*spacing:
                    offsets.append(mid@normal)
            if offsets: origin += np.median(offsets)*normal
            positions = origin + np.linspace(along[0],along[-1],6)[:,None]*axis
            radius = max(8,min(48,spacing*.6))
            patches = [cv2.resize(cv2.getRectSubPix(rgb,(round(2*radius),)*2,tuple(p.astype(float))),(48,48)) for p in positions]
            indices.append(r.Index)
            samples.append(patches)
            coordinates.append(positions.tolist())

torch.manual_seed(29)
torch.set_num_threads(3)
x = torch.tensor(np.asarray(samples)).permute(0,1,4,2,3).float()/255
x = (x-torch.tensor([.485,.456,.406])[None,None,:,None,None])/torch.tensor([.229,.224,.225])[None,None,:,None,None]
sub = rows.loc[indices].copy()
train = np.flatnonzero((sub.part=="train") & sub.target.notna())
model = mobilenet_v3_small()
model.load_state_dict(torch.load(weights/"mobilenet_v3_small-047dcff4.pth"))
model.classifier = torch.nn.Linear(576,3)
model.requires_grad_(False).eval()
for layer in [model.features[-2:],model.classifier]: layer.requires_grad_(True)
opt = torch.optim.AdamW(filter(lambda p:p.requires_grad,model.parameters()),lr=.0004)
for epoch in range(6):
    for batch in torch.tensor(train)[torch.randperm(len(train))].split(8):
        logits = model(x[batch].flatten(0,1)).reshape(-1,6,3)
        labels = torch.full((len(batch),6),-100)
        for j,i in enumerate(batch):
            pattern = patterns[names.index(sub.target.iloc[int(i)])]
            labels[j,:len(pattern)] = torch.tensor(list(map(int,pattern)))
        loss = torch.nn.functional.cross_entropy(logits.transpose(1,2),labels,reduction="none")
        importance = torch.tensor([1.6,1.4,1.2,1,.9,.8])
        opt.zero_grad()
        ((loss*importance).sum()/((labels!=-100)*importance).sum()).backward()
        opt.step()
torch.save(model.state_dict(),out/"mobilenet.pt")
with torch.no_grad():
    probs = torch.cat([model(batch.flatten(0,1)).softmax(-1).reshape(-1,6,3) for batch in x.split(12)]).numpy()
sub["positions_xy"] = list(map(json.dumps,coordinates))
sub["closure_probabilities_open_partial_closed"] = [json.dumps(p.tolist()) for p in probs]
for mode,imp in [("equal",np.ones(6)),("proximal",importance.numpy())]:
    scores = np.stack([np.average(np.log(probs[:,np.arange(len(p)),list(map(int,p))].clip(1e-8)),axis=1,weights=imp[:len(p)]) for p in patterns],axis=1)
    pred = np.array(names)[scores.argmax(1)]
    rows.loc[indices,mode] = pred
    # Only use vision to resolve an adjacent audio candidate on uncertain frames.
    diff = (np.array([names.index(n) for n in pred])-sub.pesto.map(dict(zip(names,range(12)))).to_numpy(float)+6)%12-6
    supported = (np.abs(diff)==1) & (sub.pesto_conf.to_numpy()<.5)
    rows[mode+"_fusion"] = rows.pesto.copy()
    rows.loc[np.array(indices)[supported],mode+"_fusion"] = pred[supported]
sa = rows.loc[rows.part=="calibration","yin_hz"].median()
rows["audio_register_relative_to_calibration"] = np.floor(np.round(12*np.log2(rows.pesto_hz/sa))/12).where(rows.part=="prompt_test")
rows.to_csv(out/"predictions.csv",index=False)
sub.to_csv(out/"closure.csv",index=False)
mask=rows.part=="prompt_test"
for k in ["equal","proximal","pesto","equal_fusion","proximal_fusion"]:
 print(k,rows.loc[mask,k].notna().sum(),(rows.loc[mask,k]==rows.loc[mask,"target"]).sum(),mask.sum())
print("training frames",len(train))
