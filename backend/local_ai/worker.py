import contextlib,traceback
from vision import *
with contextlib.redirect_stdout(sys.stderr): vision=Vision()
print(json.dumps({"ready":True}),flush=True)
for line in sys.stdin:
 try:
  request=json.loads(line)
  with contextlib.redirect_stdout(sys.stderr): result=vision.analyse(base64.b64decode(request["image"]),request["kind"])
  print(json.dumps({"id":request["id"],"result":result}),flush=True)
 except Exception as e:
  traceback.print_exc(file=sys.stderr);print(json.dumps({"id":request.get("id"),"error":str(e)}),flush=True)
