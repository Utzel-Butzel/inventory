# Experimental bulk counting with MapAnything

The stock movement/count form exposes **Menge per Foto → 3D-Schätzung**. It accepts three or four photos of one unchanged bin. The first image is the top view. Users outline its fill surface, mark at least three representative part lengths and select three well-separated points on the table. Shape, width/length, height/length, packing and the hidden bottom offset are explicit assumptions. No counted reference batch or physical dimensions are required.

The application displays an actual reconstructed GLB and a conditional volume-based count with a sensitivity range. The user must acknowledge the uncertainty before copying the estimate to the quantity field. This does not book stock. Geometry failure leaves the 3D model available with no applicable count. This method does not support counting empty bins.

**This is a semi-automatic experiment, not a validated inventory measurement.** The earlier spacer case underestimated 1,513 parts by 57%. No adjustment based on that true count is applied. Shape envelopes, hidden bottom height, occlusion and interlocking parts remain major sources of error. The displayed range is not a confidence interval. Do not promise ±15% accuracy.

## Runtime requirements

- A persistent Node application host with Python 3.12 and an available CUDA GPU or Apple MPS GPU. The implementation uses POSIX process/file locking and is intended for Linux/macOS, not Windows or an ephemeral serverless runtime.
- The application process must be allowed to launch Python subprocesses. One local filesystem lock serializes GPU use. App replicas must share the job files and lock on the same GPU host; independent multi-host scheduling is not implemented.
- Plan for several GB of memory for the model and activations. Tested locally on an Apple Mac with 32 GB unified memory. The compact checkpoint occupies about 2.46 GB, dependencies about 1 GB, plus transient jobs. No GPU memory safety limits are disabled.
- The normal Docker image does not include Python, PyTorch or GPU support. Use a suitably provisioned persistent host/container and mount the runtime/data paths; merely enabling the environment flag is insufficient.

## Setup

Run from the repository root. The model source is pinned; it is not installed from an unversioned branch at runtime. Install the PyTorch wheel appropriate for the host's GPU if the generic requirement does not match its CUDA environment.

```sh
export BULK_3D_DATA_PATH="$HOME/.local/share/open-inventory/bulk-3d"
python3.12 -m venv "$BULK_3D_DATA_PATH/runtime"
"$BULK_3D_DATA_PATH/runtime/bin/python" -m pip install -r services/bulk-3d/requirements.txt
"$BULK_3D_DATA_PATH/runtime/bin/python" -m pip install --no-deps uniception==0.1.7
git clone https://github.com/facebookresearch/map-anything.git "$BULK_3D_DATA_PATH/map-anything"
git -C "$BULK_3D_DATA_PATH/map-anything" checkout 3d10cf7a3016fc0f9bb13a071ee66c47b10be0d9
"$BULK_3D_DATA_PATH/runtime/bin/python" services/bulk-3d/download_weights.py "$BULK_3D_DATA_PATH/weights"
```

The downloader streams the official F32 checkpoint at revision `a1d87e9086706fb9974f3be5a3e3a0ca5401c5aa` into a compact F16 copy, checks the full original SHA-256, and only then publishes the output file. It refuses to overwrite existing weights. Source weights, licenses and model information: [Meta MapAnything](https://github.com/facebookresearch/map-anything) and [official model](https://huggingface.co/facebook/map-anything). Respect the upstream model/encoder licenses for deployment. The encoder may fetch its official DINOv2 source code on the first model load; pretrained encoder weights are not downloaded separately.

Set `BULK_3D_ENABLED=true` and restart Next.js. Defaults are under `~/.local/share/open-inventory/bulk-3d` for the application process's OS user; absolute paths can be configured through `BULK_3D_DATA_PATH`, `BULK_3D_PYTHON`, `BULK_3D_SOURCE_PATH`, `BULK_3D_WEIGHTS_PATH`, and `BULK_3D_MODEL_CONFIG_PATH`. Keep these persistent paths outside the repository so Turbopack does not traverse Python executable symlinks or bundle private jobs. These variables are server-only. The Python worker files are included in Next standalone tracing; the Python environment, model source and weights must be provisioned separately.

On the development Mac for this task, the runtime and weights were installed under `/Users/utzel/.local/share/open-inventory/bulk-3d` and the local `.env.local` flag enabled. This does not configure any deployed server. The existing temporary test environment was relocated here; its old `/tmp` location remains a compatibility symlink for the earlier experiment scripts.

## Jobs, privacy and access

- `GET /api/v1/ai/count/3d?itemId=UUID` reports availability after article permission checks.
- `POST /api/v1/ai/count/3d` accepts multipart `input` JSON and 3–4 `images`, with a required `Idempotency-Key`. Coordinates are normalized to `[0,1]` in the first oriented image. The strict input schema is in `lib/inventory-bulk-3d.ts`.
- Uploaded images are bounded while streaming, decoded sequentially, rotated and normalized. Duplicate files, invalid outlines, collinear table points and insufficient length samples are rejected. HEIC conversion takes place on the client.
- The existing durable AI-operation claim prevents duplicate work. The operation ID doubles as a job ID. A successfully launched job remains retrievable after an ambiguous response. Preflight failures release the claim. The existing `ai.count` permission, article access and counting rate-limit/disable settings apply. This local runtime does not call a paid inference API or charge OpenAI usage.
- `GET /api/v1/ai/count/3d/JOB_ID` polls durable state; `?asset=model` downloads the GLB. Both check the organization, initiating actor and current article access. Neither assets nor job metadata are served from `public`.
- A separate supervisor limits queueing plus execution to ten minutes. It kills a timed-out inference subprocess and releases the GPU lock. A lost supervisor is reported as timed out by polling after the deadline. Request disconnects do not cancel the underlying job.
- Uploads are removed when the worker attempt finishes. Results are inaccessible after 24 hours. Expired job directories are physically removed on a subsequent job submission, not by a guaranteed wall-clock deletion scheduler. Install an operational cleanup schedule if guaranteed disk-retention timing is required. Do not serve the data directory through another web server.
- Worker failures are summarized in the UI. Detailed local logs are in `$BULK_3D_DATA_PATH/jobs/JOB_ID/worker.log`. Images, weights and jobs stay outside Git and Docker build context.

## Calculation and verification

MapAnything predicts point maps, camera intrinsics and poses. The marked table points define a reference plane. The top-view pile mask defines a horizontal footprint; median nearby surface heights are integrated above an assumed hidden bottom. Marked image lengths are converted using the predicted camera depth. A common unknown global scale cancels in the volume ratio. The part volume uses a cuboid, ellipsoid or triangular-prism approximation; no filament-volume measurement is used. Varying shape dimensions, packing, orientation and bottom offset yields the sensitivity range.

The worker loads the compact weights into an F32 model with mixed precision. On MPS, the upstream precision helper maps a BF16 request to FP16; CUDA uses BF16 when supported. This is not an exact numerical reproduction of the original cloud demo.

```sh
npm run test:bulk-3d
"$BULK_3D_DATA_PATH/runtime/bin/python" -m unittest discover -s services/bulk-3d -p 'test_*.py'
npm run typecheck
```

Tests cover input geometry, scale cancellation, shape volume, abstention, job reuse/deadlines/cleanup, permissions, tenant/actor isolation, rate limits and private artifact delivery. A real local worker test with the four spacer photos produced a GLB and an estimate of 646 with unchanged central shape/packing assumptions. This verifies execution, not counting accuracy. Browser interaction tests use an isolated temporary fixture for transport and the real exported model; they do not bypass application authentication or book stock. The fixture is removed after testing.
