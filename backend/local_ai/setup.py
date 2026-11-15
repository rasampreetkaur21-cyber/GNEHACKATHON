from pathlib import Path
import subprocess
import sys
import re

root = Path(__file__).resolve().parent
if not (root / '.deps/onnxruntime').exists():
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', '--target', str(root / '.deps'), '-r', str(root / 'requirements.txt')])
if not (root / 'models/dataset_classifier.npz').exists():
    subprocess.check_call([sys.executable, str(root / 'train.py')])
env = root.parents[1] / '.env'
text = env.read_text(encoding='utf-8-sig') if env.exists() else (root.parents[1] / '.env.example').read_text()
text = re.sub(r'^AI_PROVIDER=.*$', 'AI_PROVIDER=local', text, flags=re.M) if re.search(r'^AI_PROVIDER=', text, re.M) else text + '\nAI_PROVIDER=local\n'
env.write_text(text, encoding='utf-8')
print('Local AI configured. Start npm run dev. No paid API key required.')
