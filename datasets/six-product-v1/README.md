# ClaimShield AI six-product image dataset

Yeh handoff package Codex ya Antigravity ko dekar website mein integrate kiya ja sakta hai. Supported catalog sirf ye six products hai:

- Samsung Galaxy A26 5G
- Samsung Galaxy A36 5G
- Samsung Galaxy A56 5G
- boAt Rockerz 450
- boAt Rockerz 550
- boAt Rockerz 650

data/assets.csv aur data/assets.json image manifest hain. data/cases.csv aur data/cases.json expected outcomes hain. integration_contract.json website ke API response contract ko define karta hai.

## Integration flow

1. Product selector ko catalog.json se populate karo. User ko arbitrary free-text model select karne ka option mat do.
2. Selected model_id ke saath ek image upload karo.
3. Image analysis se category, model evidence, quality, authenticity signals, duplicate hash aur model relation collect karo.
4. integration_contract.json ke paanch statuses mein se ek return karo.
5. VALID_MATCH ko claim approval mat samjho. Invoice, serial, policy aur fraud checks alag evidence hain.
6. Clear photo mein unsupported phone, headphone, laptop, mug ya random object ho to INVALID_DEVICE return karo. Blurry, cropped, dark ya label-only evidence ko UNCLEAR_IMAGE return karo. AI-generated, edited, screenshot/replay, duplicate ya registry conflict ko HUMAN_REVIEW return karo.

Model identity ke liye photo-only guess ko exact proof mat samjho. Device ke saath readable model label/About screen ya human review path rakho. Dataset mein generated fixtures ko real photos ke roop mein present mat karo.

## Dataset contents

- data/images/commons/ openly licensed reference photos with attribution in data/sources.csv
- data/images/attached/ files copied from the supplied ZIP. These are labelled project-generated fixtures and include visible synthetic labels, packaging-only cases and unsupported subjects.
- data/images/ai_generated/ AI-generated damage fixtures. These are explicitly labelled as generated test fixtures.
- data/assets.* one row per image with hash, origin, model, angle, condition, quality, identity evidence and source/licence fields
- data/cases.* supported matches, cross-model pairs, unsupported subjects, unclear images, packaging-only evidence, synthetic/edit/replay/duplicate/review signals
- legacy-claimshield-image-dataset.zip the supplied ZIP preserved unchanged for audit
- scripts/import_photos.py imports a real camera-photo collection using templates/photo_intake.csv
- scripts/augment_photos.py creates separate blur/dark/crop/low-resolution stress variants
- scripts/evaluate.py exports requests and scores predictions
- scripts/make_graphs.py creates measured accuracy, coverage and confusion-matrix graphs
- scripts/validate_dataset.py verifies hashes, closed-set IDs and synthetic-origin labels

## Run

From this folder:

    python -m pip install -r requirements.txt
    python scripts/validate_dataset.py data
    python -m unittest discover -s tests -v
    python scripts/evaluate.py requests data benchmark/requests.json

For real photos, put files in a separate input folder, fill templates/photo_intake.csv, then run:

    python scripts/import_photos.py --input my_photos --labels templates/photo_intake.csv --out data-camera-v1
    python scripts/augment_photos.py --dataset data-camera-v1 --out data-camera-v1-augmented --split train

Graph generation uses measured model predictions only:

    python scripts/make_graphs.py --results benchmark/predictions.csv --out benchmark/graphs

The package does not invent LLM accuracy. Supply each model's predictions on the same frozen test cases, then create graphs and compare accuracy, macro-F1, invalid-device recall, human-review recall, coverage and latency.

## Hinglish user messages

- VALID_MATCH — "Selected product aur photo ka linked model evidence match karta hai. Claim ke baaki checks continue karein."
- DEVICE_MISMATCH — "Photo kisi doosre supported model ki lagti hai. Selected product ki clear photo upload karein."
- INVALID_DEVICE — "Photo supported six products mein nahi hai. Sahi device ki photo upload karein."
- UNCLEAR_IMAGE — "Photo se device identity verify nahi ho paayi. Bright, sharp photo mein device aur model label/About screen dikhayein."
- HUMAN_REVIEW — "Photo ki authenticity ya evidence uncertain hai. Fresh photo aur reviewer check required hai."
