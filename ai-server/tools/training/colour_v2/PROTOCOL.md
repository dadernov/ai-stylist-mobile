# Colour head v2: protocol, frozen 2026-11-04 before any download or training
TEST (never used for fitting, label audit, or choosing anything):
 - real: the 75 labelled items of feat_real.npz (ev.py real_truth)
 - kagl: the 340 items of feat_kagl.npz; rows, item_IDs and normalised titles excluded from all training/dev data
 - swatch: 552 items of swatch.npz, truth swatch_lib.COLOURS
DEV: 20% of newly downloaded KAGL (by normalised title hash), and dev swatches rendered at hexes that are not in COLOURS.
AUDIT of label mappings: only on newly downloaded non-test KAGL.
Truth on test: ev.py's sets, unchanged ("old truth"). Audited sets reported additionally, for both heads alike.
Warm swatch set (from ev.py): caramel caramel2 caramel_dk camel tan cognac terracotta rust brown sand. Reported separately: mustard mustard2 khaki khaki2 olive olive_dk beige.
Warm KAGL set: Khaki Tan Beige Cream Brown Mustard Olive Rust Peach Nude Mushroom Brown Off White.
SHIP RULE, head+deployed veto vs shipped head+deployed veto:
 (a) real: right count not lower than shipped;
 (b) warm swatches: right share strictly higher AND warm KAGL not lower;
 (c) kagl overall not lower by more than 1 item in 100 (3 items), as a guard;
 (d) warm->Хаки/Оливковый/Зеленый on swatches not more than shipped.
Any one failing: keep the old head.
Veto: three variants compared on test, one chosen on DEV only: on (as deployed), off, soft (hue margin 18, lightness gap 20, certainty 0.99).
Softening is recommended only if the variant chosen on dev also satisfies (a)-(d) on test against head+veto-on, without regressions.
Model selection (candidates, hyperparameters) on DEV only; final candidate frozen before the first test run.
