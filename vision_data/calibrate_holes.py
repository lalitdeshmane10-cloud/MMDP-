"""Mark six hole centers and two bamboo anchors on a paused take for the tracked_fusion replay."""
import argparse
import json
from pathlib import Path

import cv2
import pandas as pd

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("recording_id")
parser.add_argument("seconds", type=float)
args = parser.parse_args()
root = Path("datasets/vision_evaluation")
rows = pd.read_csv(root / "pretrained/predictions.csv")
matches = rows[rows.recording_id.eq(args.recording_id)]
if matches.empty or args.seconds < 0:
    parser.error("Choose a recording_id from predictions.csv and a nonnegative timestamp.")
capture = cv2.VideoCapture(matches.video_path.iloc[0])
# Decode sequentially: browser WebM files can lack a seek index.
while True:
    ok, frame = capture.read()
    if not ok:
        parser.error("Timestamp is past the last decodable frame.")
    timestamp = capture.get(cv2.CAP_PROP_POS_MSEC)
    if timestamp >= args.seconds * 1000:
        break
capture.release()
points = []
window = "Click 6 holes from mouth end, then 2 points on bare bamboo | Enter saves"
cv2.namedWindow(window)
def click(event, x, y, flags, data):
    if event == cv2.EVENT_LBUTTONDOWN and len(points) < 8:
        points.append([x,y])
cv2.setMouseCallback(window, click)
while True:
    preview = frame.copy()
    for i, point in enumerate(points,1):
        cv2.circle(preview,point,4,(0,255,255),2)
        cv2.putText(preview,str(i),point,0,.5,(0,255,255),1)
    cv2.imshow(window,preview)
    key=cv2.waitKey(30) & 255
    if key==27 or cv2.getWindowProperty(window,cv2.WND_PROP_VISIBLE)<1:break
    if key==8 and points:points.pop()
    if key in (10,13) and len(points)==8:
        path=root/"tracked_fusion/calibration.json"
        path.parent.mkdir(exist_ok=True)
        data=json.loads(path.read_text()) if path.exists() else {}
        data[args.recording_id]=dict(timestamp_ms=timestamp,points=points[:6],bamboo_ends=points[6:])
        temp=path.with_suffix(".tmp")
        temp.write_text(json.dumps(data,indent=2))
        temp.replace(path)
        print("Saved",path)
        break
cv2.destroyAllWindows()
