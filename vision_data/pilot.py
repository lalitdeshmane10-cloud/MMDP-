from pathlib import Path
import pandas as pd, numpy as np, cv2, json,time
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.neighbors import KNeighborsClassifier
root=Path('datasets')
out=root/'vision_evaluation'/'pilot'
out.mkdir(parents=True,exist_ok=True)
own=pd.read_csv(root/'vision_prepared/annotations.csv')
reels=pd.read_csv(root/'reels_data/annotations.csv')
own['target']=own.prompted_swara
own['folder']='vision_prepared'
own['player_id']='own_player'
own['split']='train'
reels['folder']='reels_data'
reels['target']=reels.estimated_swara
reels['split']=reels.player_id.map({'shivam_thefluteguy':'train','harshvdave':'validation','parth_flute':'test'})
assert reels.split.notna().all()
data=pd.concat([own,reels],ignore_index=True)
data[['recording_id','player_id','split']].drop_duplicates().to_csv(out/'splits.csv',index=False)
meta={x['recording_id']:x for x in json.loads((root/'reels_data/manifest.json').read_text())}
rows=data[data.target.notna()].copy()
features=[]
for r in rows.itertuples():
 im=cv2.imread(str(root/r.folder/r.frame_path),0)
 if r.recording_id in meta:
  x,y,X,Y=meta[r.recording_id]['caption_crop_xyxy']
  im[y:Y,x:X]=0
 small=cv2.resize(im,(64,64))
 features.append(cv2.HOGDescriptor((64,64),(16,16),(8,8),(8,8),9).compute(small).ravel())
features=np.array(features)
train=rows.split.eq('train')
models={'linear':LogisticRegression(max_iter=300,C=.02),'knn':KNeighborsClassifier(n_neighbors=7)}
for name,model in models.items():
 model=make_pipeline(StandardScaler(),model).fit(features[train],rows.target[train])
 for split in ['validation','test']:
  mask=rows.split.eq(split)
  pred=model.predict(features[mask])
  rows.loc[mask,name]=pred
  print(name,split,len(pred), round(np.mean(pred==rows.target[mask])*100,1))
rows[~train][['recording_id','timestamp_ms','split','target','linear','knn']].to_csv(out/'agreement.csv',index=False)
