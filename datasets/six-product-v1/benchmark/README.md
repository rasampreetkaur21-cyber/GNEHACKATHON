# Benchmark handoff

Run every candidate LLM or vision model on the same data/cases.json image cases. Do not tune prompts on the test split. Export one row per image case to predictions.csv with:

model_name,case_id,selected_model_id,expected_status,predicted_status,reason_code,confidence,latency_ms

Copy predictions_template.csv, fill predictions, and run:

    python scripts/make_graphs.py --results benchmark/predictions.csv --out benchmark/graphs

The charts are measured only from supplied predictions. NOT_RUN belongs in a separate report and must not be converted into a score. The manifest includes synthetic fixtures, AI-generated fixtures and openly licensed references. Report each origin separately. A graph from synthetic fixtures does not establish real-world photo performance.
