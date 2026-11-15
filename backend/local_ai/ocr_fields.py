import re,unicodedata,datetime
MODEL_PATTERNS={
 "samsung-galaxy-a26-5g":r"\b(?:galaxy\s*)?a26(?:\s*5g)?\b|\bsm[ -]?a266[a-z0-9/]*\b",
 "samsung-galaxy-a36-5g":r"\b(?:galaxy\s*)?a36(?:\s*5g)?\b|\bsm[ -]?a366[a-z0-9/]*\b",
 "samsung-galaxy-a56-5g":r"\b(?:galaxy\s*)?a56(?:\s*5g)?\b|\bsm[ -]?a566[a-z0-9/]*\b",
 "boat-rockerz-450":r"\brockerz\s*450\b|\br450\b",
 "boat-rockerz-550":r"\brockerz\s*550\b|\br550\b",
 "boat-rockerz-650":r"\brockerz\s*650\b|\br650\b"}
def model_candidates(text):
 text=unicodedata.normalize("NFKC",text).replace("–","-").replace("—","-")
 return [model for model,pattern in MODEL_PATTERNS.items() if re.search(pattern,text,re.I)]
def serial_candidate(text):
 m=re.search(r"(?:serial(?:\s*(?:number|no\.?))?|s/n)\s*[:#-]\s*([A-Z0-9][A-Z0-9/-]{3,99})",text,re.I)
 return m.group(1) if m else None
def invoice_fields(text):
 fields={k:"UNKNOWN" for k in ["seller_name","invoice_number","invoice_date","product_name","product_model","serial_number","customer_name","gstin"]}
 for key,pattern in {"seller_name":r"(?:sold by|seller|merchant)\s*[:：]\s*([^\n]{2,150})", "invoice_number":r"(?:invoice|bill)\s*(?:number|no\.?|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{2,70})", "customer_name":r"(?:customer name|bill to)\s*[:：]\s*([^\n]{2,100})"}.items():
  m=re.search(pattern,text,re.I)
  if m:fields[key]=m.group(1).strip()
 gst=re.search(r"\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b",text.upper())
 if gst:fields["gstin"]=gst.group()
 serial=serial_candidate(text)
 if serial:fields["serial_number"]=serial
 dates=re.findall(r"(?:invoice date|bill date|purchase date|\bdate)\s*[:：-]?\s*(\d{4}[-/]\d{2}[-/]\d{2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})",text,re.I)
 converted=[]
 for raw in dates:
  numbers=[int(x) for x in re.split(r"[-/]",raw)]
  try:
   if len(str(numbers[0]))==4:y,m,d=numbers
   elif numbers[0]>12:d,m,y=numbers
   elif numbers[1]>12:m,d,y=numbers
   else:continue
   value=datetime.date(y,m,d)
   if value<=datetime.date.today():converted.append(value.isoformat())
  except ValueError:pass
 if len(set(converted))==1:fields["invoice_date"]=converted[0]
 return fields

def other_model_text(text):
 patterns=[r"\b(?:samsung\s*)?galaxy\s*a\d{2}(?:\s*5g)?\b",r"\biphone(?:\s*\d{1,2})?(?:\s*(?:pro|max|plus|mini)){0,2}\b",r"\brockerz\s*\d{3,4}\b"]
 values=[]
 for pattern in patterns:
  for match in re.finditer(pattern,text,re.I):
   value=match.group().strip()
   if not model_candidates(value) and value.lower() not in [v.lower() for v in values]:values.append(value)
 return values[0] if len(values)==1 else None
