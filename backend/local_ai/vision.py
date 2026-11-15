import os,sys,json,re,base64,io
from pathlib import Path
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/".deps"))
os.environ.setdefault("OMP_NUM_THREADS","2")
import numpy as np
import onnxruntime as ort
from PIL import Image,ImageOps
from tokenizers import Tokenizer
from ocr_fields import model_candidates, serial_candidate, invoice_fields, other_model_text
MODELS=ROOT/"models"
class Vision:
 def __init__(self,ocr=True):
  options=ort.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1
  self.vision=ort.InferenceSession(str(MODELS/"vision_model_quantized.onnx"),sess_options=options,providers=["CPUExecutionProvider"])
  self.text=ort.InferenceSession(str(MODELS/"text_model_quantized.onnx"),sess_options=options,providers=["CPUExecutionProvider"])
  self.tokenizer=Tokenizer.from_file(str(MODELS/"tokenizer.json"))
  self.tokenizer.enable_truncation(max_length=77);self.tokenizer.enable_padding(length=77,pad_id=49407,pad_token="<|endoftext|>")
  self.categories=["phone","headphones","laptop","tablet","mug","scenery","document","packaging","screenshot","indoor_scene","people","furniture","vehicle","animal"]
  prompts=["a photo of a smartphone mobile phone", "a photo of over-ear headphones", "a photo of a laptop computer", "a photo of a tablet computer", "a photo of a coffee mug or drinking cup", "a landscape or scenery photograph without a device", "a flat document, invoice or printed sample label", "a cardboard product packaging box", "a screenshot or a screen capture", "a photograph of an indoor room or hallway", "a photograph of people with no device", "a photograph of furniture or a wheeled bed", "a photograph of a vehicle", "a photograph of an animal"]
  self.category_features=self.text_features(prompts)
  self.trained=np.load(MODELS/"dataset_classifier.npz") if (MODELS/"dataset_classifier.npz").exists() else None
  self.ocr=None
  if ocr:
   from rapidocr_onnxruntime import RapidOCR
   self.ocr=RapidOCR()
 def text_features(self,texts):
  encoded=self.tokenizer.encode_batch(texts)
  values={"input_ids":np.array([x.ids for x in encoded],dtype=np.int64),"attention_mask":np.array([x.attention_mask for x in encoded],dtype=np.int64)}
  inputs={x.name:values[x.name] for x in self.text.get_inputs()}
  outputs=dict(zip([x.name for x in self.text.get_outputs()],self.text.run(None,inputs)))
  features=outputs.get("text_embeds",next(iter(outputs.values())))
  return features/np.linalg.norm(features,axis=-1,keepdims=True)
 def image_features(self,image):
  image=ImageOps.exif_transpose(image).convert("RGB")
  w,h=image.size;scale=224/min(w,h);image=image.resize((round(w*scale),round(h*scale)),Image.Resampling.BICUBIC)
  w,h=image.size;image=image.crop(((w-224)//2,(h-224)//2,(w+224)//2,(h+224)//2))
  a=np.asarray(image,dtype=np.float32)/255
  a=(a-np.array([.48145466,.4578275,.40821073],np.float32))/np.array([.26862954,.26130258,.27577711],np.float32)
  values={self.vision.get_inputs()[0].name:np.transpose(a,(2,0,1))[None].astype(np.float32)}
  outputs=dict(zip([x.name for x in self.vision.get_outputs()],self.vision.run(None,values)))
  features=outputs.get("image_embeds",next(iter(outputs.values())))[0]
  return features/np.linalg.norm(features)
 def analyse(self,bytes_,kind):
  image=ImageOps.exif_transpose(Image.open(io.BytesIO(bytes_))).convert("RGB");feature=self.image_features(image)
  scores=self.category_features@feature;order=np.argsort(scores)[::-1];category=self.categories[order[0]];gap=float(scores[order[0]]-scores[order[1]])
  outside_gap=float(max(scores[i] for i,c in enumerate(self.categories) if c not in ["phone","headphones","document","packaging","screenshot"])-max(scores[0],scores[1]))
  import cv2
  grey=np.asarray(image.convert("L"));sharpness=float(cv2.Laplacian(grey,cv2.CV_64F).var());brightness=float(grey.mean())
  quality="LOW_RESOLUTION" if min(image.size)<160 else "DARK" if brightness<32 else "BLURRY" if sharpness<18 else "CLEAR"
  lines=[];ocr_passes=[]
  def read_words(candidate,label):
   found,_=self.ocr(np.asarray(candidate));ocr_passes.append(label)
   result=[x for x in (found or []) if float(x[2])>=.65]
   for x in result:
    word=str(x[1]).strip()
    if word and word not in lines:lines.append(word)
   return result
  if self.ocr and quality not in ["DARK","LOW_RESOLUTION"]:
   base=image
   if max(image.size)<1000:
    scale=min(2,1200/max(image.size));base=image.resize((round(image.width*scale),round(image.height*scale)),Image.Resampling.BICUBIC)
   words=read_words(base,"full_image")
   if category in ["phone","headphones","document"] and not model_candidates("\n".join(lines)) and (len(lines)<3 or re.search(r"model|galaxy|rockerz|sm[- ]", " ".join(lines),re.I)):
    for angle in [90,270]:
     read_words(base.rotate(angle,expand=True),f"rotation_{angle}")
     if model_candidates("\n".join(lines)):break
   if not model_candidates("\n".join(lines)) and category in ["phone","headphones","document"]:
    hint=next((x for x in words if re.search(r"model|galaxy|rockerz|sm[- ]",str(x[1]),re.I)),None)
    if hint:
     box=np.asarray(hint[0]);cx,cy=box.mean(axis=0);w,h=base.size
     crop=base.crop((max(0,int(cx-w*.25)),max(0,int(cy-h*.15)),min(w,int(cx+w*.25)),min(h,int(cy+h*.15))))
     if min(crop.size)>0:
      scale=min(2,1600/max(crop.size));read_words(crop.resize((round(crop.width*scale),round(crop.height*scale)),Image.Resampling.BICUBIC),"label_detail")
  if self.ocr and quality == "CLEAR" and category in ["phone","headphones"] and not model_candidates("\n".join(lines)) and len(ocr_passes)<4:
   w,h=image.size;crop=image.crop((0,int(h*.45),w,h))
   read_words(crop,"lower_device_detail")
  text="\n".join(lines);matches=model_candidates(text)
  other_model=other_model_text(text) if not matches else None
  signals=[]
  if re.search(r"synthetic|ai[ -]generated|sample label|generated fixture",text,re.I):signals.append("SYNTHETIC_SIGNAL")
  if category=="screenshot" and gap>.015:signals.append("REPLAY_SIGNAL")
  model=matches[0] if len(matches)==1 else None
  names={"samsung-galaxy-a26-5g":"Galaxy A26 5G","samsung-galaxy-a36-5g":"Galaxy A36 5G","samsung-galaxy-a56-5g":"Galaxy A56 5G","boat-rockerz-450":"Rockerz 450","boat-rockerz-550":"Rockerz 550","boat-rockerz-650":"Rockerz 650"}
  suggestion=None
  coarse_hint=None
  if self.trained is not None:
   raw=np.r_[feature,1]@self.trained["coarse_weights"];coarse_hint=str(self.trained["coarse_classes"][int(np.argmax(raw))])
  assessment={"engine":"LOCAL_CLIP_DATASET_CLASSIFIER_OCR","category":category,"readable_model_candidate":model,"other_model_text":other_model,"reference_classifier_hint":suggestion,"dataset_category_hint":coarse_hint,"ocr_text":text[:3000],"identity_limit":"OCR text and visual similarity do not establish that a label is attached to this physical device.","training_origin":"real_open_license_only","quality":quality,"ocr_passes":ocr_passes,"image_dimensions":{"width":image.width,"height":image.height},"authenticity_signals":signals,"category_margin_uncalibrated":gap}
  if kind=="invoice":
   fields=["seller_name","invoice_number","invoice_date","product_name","product_model","serial_number","customer_name","gstin"]
   o=invoice_fields(text);o.update(type="invoice",original_text=text[:12000] or "No readable invoice text.")
   if model:o["product_model"]=names[model];o["product_name"]="Mobile phone" if model.startswith("samsung") else "Headphones"
   o["unknown_fields"]=[k for k in fields if o[k]=="UNKNOWN"]
  elif kind=="device_check":
   o={"quality":quality,"device_category":category,"observed_brand":("Samsung" if model.startswith("samsung") else "boAt") if model else None,"observed_model_text":names.get(model) or other_model,"serial_text":serial_candidate(text),"identifying_evidence_kind":"BOX" if category=="packaging" else "NONE","identifier_linked_to_pictured_device":None,"outside_catalog":True if category in ["laptop","tablet","mug","scenery","indoor_scene","people","furniture","vehicle","animal"] and outside_gap>.04 else None,"authenticity_assessed":False,"authenticity_signals":signals,"confidence":None}
  else:
   o={"type":"product_photo","device_category":"Mobile phone" if category=="phone" else "Headphones" if category=="headphones" else category,"visible_damage_types":["UNKNOWN"],"damage_location":"UNKNOWN","visible_cracks":"UNKNOWN","visible_dents":"UNKNOWN","visible_liquid_contact_indicator":"UNKNOWN","visible_tamper_signs":"UNKNOWN","serial_text":serial_candidate(text) or "UNKNOWN","model_text":names.get(model) or other_model or "UNKNOWN","image_relevance":"IRRELEVANT" if category in ["mug","scenery","indoor_scene","people","furniture","vehicle","animal"] and outside_gap>.04 else "UNKNOWN","observable_facts":f"Local vision suggests {category}. OCR: {text[:1800] or 'no readable text'}. Exact device linkage and authenticity remain unverified.","observed_brand":("Samsung" if model.startswith("samsung") else "boAt") if model else "UNKNOWN","observed_model_text":names.get(model) or other_model or "UNKNOWN","identifying_evidence_kind":"BOX" if category=="packaging" else "NONE","identifier_linked_to_pictured_device":"UNKNOWN","image_quality":"BLURRY" if quality=="BLURRY" else "CLEAR" if quality=="CLEAR" else "AMBIGUOUS","unknown_fields":[]}
  return {"observations":o,"local_assessment":assessment,"model":"local-clip-ridge-ocr-v1","promptVersion":"local-vision-v2"}

