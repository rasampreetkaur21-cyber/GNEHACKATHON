# Local AI connected

The website now uses AI_PROVIDER=local. Frozen CLIP ONNX image/text encoders run on CPU, RapidOCR reads text, and a ridge head was trained using the 16 real_open_license dataset images. The 51 generated images were excluded from real-reference training.

The exploratory leave-one-image-out fine-model classifier scored 5/16, so fine-model identity deployment is disabled. The trained coarse head provides a supporting category hint. There are no real boAt camera-training references in the supplied dataset. No independent real-camera accuracy is claimed.

The working local engine detects broad subject classes, OCR model candidates, dark/blurry/low-resolution images and visible synthetic-label disclaimers. Exact label attachment, authenticity and warranty eligibility remain unverified. Visual resemblance cannot approve a claim. Existing hash/provenance and server-side claim checks remain active.

New photo/invoice uploads in LOCAL mode queue local extraction automatically. Remote mode retains explicit start behavior. The /verify page displays local category and OCR results.

## Run

Python 3.13 was used for this runtime. Run npm ci, then python backend/local_ai/setup.py, then npm run dev. The models and fitted weights are included. Setup installs the pinned Python requirements into backend/local_ai/.deps and enables local mode. Normal inference requires no network connection or paid API key. The platform-specific .deps folder is excluded from source delivery; setup recreates it. To retrain, run python backend/local_ai/train.py.

## Evidence and attribution

models/training-report.json records actual training results. models/source.json pins the pretrained checkpoint revision. Model source: https://huggingface.co/Xenova/clip-vit-base-patch32 . OCR source: https://github.com/RapidAI/RapidOCR . The CLIP license is included. This is pretrained vision/OCR plus a newly trained reference head, not a large model trained from scratch.
