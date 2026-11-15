# Real dataset preparation

Initial status: NOT_LOADED. No real repair records are fabricated or bundled.

Source: https://github.com/openrepair/data . Current EEE object: OpenRepairData_v0.3_aggregate_202607_eee.csv (Git LFS; repository reports 76.7 MB). Schema inspected 2026-11-14 at https://raw.githubusercontent.com/openrepair/data/main/tableschema.json .

Attribution: Open Repair Alliance and contributing repair organizations. License: CC-BY-SA-4.0.

ora-header.txt contains only the actual CSV header, fetched with a ranged request and early connection close. It matches the published ORDS v0.3 columns. No repair records were imported. Import a locally obtained CSV explicitly with `npm run import:ora -- C:/absolute/path/file.csv`.

Records are aggregate repair context, never proof of individual warranty or service history. Setup does not download large optional datasets.
