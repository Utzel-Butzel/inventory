import gc
import json
import os
from pathlib import Path
import sys
import time

from run_job import state

os.environ.setdefault('PYTORCH_ENABLE_MPS_FALLBACK', '1')
directory = Path(sys.argv[1])
request = json.loads((directory / 'request.json').read_text())
sys.path.insert(0, request['runtime']['source'])
import numpy as np
import torch
import trimesh
from PIL import Image
from safetensors.torch import load_model
from mapanything.models import MapAnything
from mapanything.utils.image import load_images
from geometry import analyze, InsufficientGeometry

torch.set_num_threads(min(6, os.cpu_count() or 1))
device = 'cuda' if torch.cuda.is_available() else 'mps' if torch.backends.mps.is_available() else None
if device is None:
    raise RuntimeError('MapAnything requires an available CUDA or Apple MPS GPU.')
config = json.loads(Path(request['runtime']['config']).read_text())
config['encoder_config']['torch_hub_pretrained'] = False
# A compact checkpoint may contain F16 weights. Safetensors' model loader
# correctly verifies tied parameters rather than reporting their aliases missing.
torch.set_default_dtype(torch.float16)
model = MapAnything(**config)
torch.set_default_dtype(torch.float32)
load_model(model, request['runtime']['weights'], strict=True, device='cpu')
gc.collect()
model.float().eval().to(device)
images = [str(directory / f'image-{i}.jpg') for i in range(request['imageCount'])]
with Image.open(images[0]) as first:
    source_size = first.size
views = load_images(images)
state(directory, {'status': 'reconstructing'})
started = time.monotonic()
amp_dtype = 'bf16' if device == 'mps' or torch.cuda.is_bf16_supported() else 'fp16'
with torch.inference_mode():
    predictions = model.infer(views, memory_efficient_inference=True, minibatch_size=1,
                              use_amp=True, amp_dtype=amp_dtype, apply_mask=True, mask_edges=True)
arrays = {}
for i, prediction in enumerate(predictions):
    for key in ['pts3d', 'depth_z', 'intrinsics', 'camera_poses', 'img_no_norm', 'mask']:
        arrays[f'{key}_{i}'] = prediction[key][0].detach().float().cpu().numpy()
seconds = time.monotonic()-started
del model, predictions
gc.collect()
if device == 'mps':
    torch.mps.empty_cache()
else:
    torch.cuda.empty_cache()
state(directory, {'status': 'analyzing'})
warnings = ['hiddenBottom', 'partShape', 'manualMarks']
try:
    estimate, frame = analyze(arrays, request['marks'], request['assumptions'], source_size)
    if frame['sampleSpread'] > .2:
        warnings.append('sampleSpread')
except (InsufficientGeometry, ValueError) as error:
    print('Geometry unavailable:', str(error), flush=True)
    estimate, frame = None, None
    warnings.append('geometry')

scene = trimesh.Scene()
for i in range(request['imageCount']):
    points = arrays[f'pts3d_{i}']
    colors = np.clip(arrays[f'img_no_norm_{i}']*255, 0, 255).astype(np.uint8)
    if colors.shape[0] == 3:
        colors = colors.transpose(1, 2, 0)
    valid = arrays[f'mask_{i}'].squeeze().astype(bool) & np.isfinite(points).all(-1)
    if frame is not None:
        points = (points-frame['origin']) @ frame['rotation']
        eq, length = frame['equations'], frame['length']
        valid &= np.all(points[:, :, :2] @ eq[:, :2].T + eq[:, 2] < length*2, axis=-1)
        valid &= (points[:, :, 2] > -length*.1) & (points[:, :, 2] < frame['medianHeight']+length*12)
        # GLTF/Three uses Y-up; preserve handedness when mapping our Z-up frame.
        points = points[:, :, [0, 2, 1]] * np.array([1, 1, -1])
    else:
        # Camera frame has Y-down and Z-forward.
        points = points * np.array([1, -1, -1])
    h, w = valid.shape
    indices = np.arange(h*w).reshape(h, w)
    a, b, c, d = indices[:-1, :-1], indices[:-1, 1:], indices[1:, :-1], indices[1:, 1:]
    faces = np.concatenate([np.stack([a, b, c], -1).reshape(-1, 3), np.stack([b, d, c], -1).reshape(-1, 3)])
    faces = faces[np.all(valid.ravel()[faces], axis=1)]
    mesh = trimesh.Trimesh(vertices=points.reshape(-1, 3), faces=faces, vertex_colors=colors.reshape(-1, 3), process=False)
    mesh.remove_unreferenced_vertices()
    scene.add_geometry(mesh, node_name=f'view_{i+1}')
scene.export(directory / 'model.glb')
if (directory / 'model.glb').stat().st_size > 64*1024*1024:
    raise RuntimeError('Model exceeds export size limit.')
state(directory, {'status': 'completed', 'result': {
    'method': 'bulk_3d', 'version': 'mapanything_manual_v1', 'model': 'facebook/map-anything',
    'isExact': False, 'accuracyValidated': False, 'estimate': estimate, 'warningCodes': warnings,
    'imageCount': request['imageCount'], 'sampleCount': len(request['marks']['edges']),
    'inferenceSeconds': min(seconds, 600),
}})
