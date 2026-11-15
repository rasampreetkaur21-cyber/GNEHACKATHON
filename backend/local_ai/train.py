from vision import *
from collections import Counter
root=ROOT.parents[1]/"datasets"/"six-product-v1"
assets=json.loads((root/"data/assets.json").read_text())
real=[a for a in assets if a["origin"]=="real_open_license"]
vision=Vision(ocr=False)
x=np.array([vision.image_features(Image.open(root/"data"/a["image_path"])) for a in real])
classes=sorted(set(a["model_id"] for a in real));y=np.array([classes.index(a["model_id"]) for a in real]);target=np.eye(len(classes))[y]
x=np.c_[x,np.ones(len(x))]
def fit(x,y):return np.linalg.solve(x.T@x+.05*np.eye(x.shape[1]),x.T@y)
loo=[]
for i in range(len(x)):
 mask=np.arange(len(x))!=i;weights=fit(x[mask],target[mask]);pred=int(np.argmax(x[i]@weights));loo.append({"asset_id":real[i]["asset_id"],"expected":classes[y[i]],"predicted":classes[pred]})
coarse=["headphones" if a["asset_id"]=="commons-sony" else "mug" if a["asset_id"]=="commons-mug" else "tablet" if a["asset_id"]=="commons-tablet" else "phone" for a in real]
coarse_classes=sorted(set(coarse));coarse_target=np.eye(len(coarse_classes))[[coarse_classes.index(c) for c in coarse]]
np.savez(MODELS/"dataset_classifier.npz",weights=fit(x,target),classes=np.array(classes),coarse_weights=fit(x,coarse_target),coarse_classes=np.array(coarse_classes))
report={"trained":True,"fine_identity_deployment_enabled":False,"deployment_reason":"Only 5/16 fine-model predictions correct in exploratory leave-one-image-out; exact identity classifier disabled. Coarse category head used only as a supporting signal.","training_samples":len(real),"excluded_generated_samples":len(assets)-len(real),"classes":classes,"missing_real_training_classes":["boat-rockerz-450","boat-rockerz-550","boat-rockerz-650"],"method":"ridge classification head on frozen pretrained CLIP embeddings","evaluation":"exploratory leave-one-image-out; physical-device independence not established; not frozen-test benchmark", "leave_one_image_out_correct":sum(r["expected"]==r["predicted"] for r in loo),"leave_one_image_out_total":len(loo),"rows":loo,"limits":"Small reference corpus. Classifier hints must never independently verify exact identity or approve warranty claims."}
(MODELS/"training-report.json").write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
