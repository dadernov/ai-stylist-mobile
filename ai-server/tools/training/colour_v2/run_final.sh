#!/bin/bash
# Lambda 1e-4 and veto "on" were chosen on dev; this runs the frozen test.
cd "$(dirname "$0")"
PY="nice -n 15 /opt/wardrobe/ai-server/.venv/bin/python"
$PY train.py final data/shipped.npz 1e-4 data/final.npz 2>&1 | tail -1
for v in on soft off; do
  for h in shipped final; do
    echo "=== $h veto=$v"
    $PY heldout.py "$PWD/data/$h.npz" $v data/r_${h}_$v.json 2>&1
  done
done > data/test.txt
echo finished
