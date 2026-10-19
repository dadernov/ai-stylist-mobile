# Training the category head and the style space

Both sit on top of the production SigLIP image encoder (models/clip), which stays frozen; only small layers are
trained, on a CPU, in seconds, from embeddings computed once.

1. `harvest.py <source> [cap]` downloads a HF dataset shard by shard (polyvore, fashion200k, atlas, product), maps
   its labels to the app's categories (`labels.py`; ambiguous labels are dropped), embeds the photos and keeps only
   embeddings, labels and thumbnails in `emb/`.
2. `grigorev_embed.py` embeds the real-life photos of the CC0 clothing dataset
   (github.com/alexeygrigorev/clothing-dataset): the domain the app sees, used half for training and half,
   by sender, for testing.
3. `train.py [l2 ...]` (env REAL_W, weight of the real-life photos) trains the category head: a correction to the
   description scores, pulled towards zero, so a category with few examples keeps the descriptions' answer.
   Export `W`, `b` and `clothing_analysis.prompt_signature()` to `category_head.npz`.
4. `compat.py [epochs]` trains the style space on Polyvore outfits (fill-in-the-blank); export `P`, `E`, `slots`
   to `style_space.npz`.
5. `prod_eval.py` checks the head on the production path (rembg cut-out + ClothingClassifier.predict).

Results of 2026-10-19 (held-out senders' real photos, production path, 520 photos): 84.4% → 91.9% right
category. Style space on held-out Polyvore outfits: FITB 69% (53% raw embedding, 25% chance), AUC 0.89.

The text features the head was trained over must be the ones deployed (`text_features.json` signature); the
classifier refuses a head built over others.
