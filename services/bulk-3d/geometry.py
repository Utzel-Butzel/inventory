"""Image measurements and an explicitly uncalibrated volume-ratio estimate.

No reference count, object-specific annotations, container colors or correction
factors from the development photos are used here.
"""
import itertools
import math
import numpy as np
from PIL import Image, ImageDraw
from scipy.spatial import ConvexHull, cKDTree


class InsufficientGeometry(ValueError):
    pass


def image_coordinates(points, source_size, processed_size):
    source = np.asarray(source_size, float)
    target = np.asarray(processed_size, float)
    resized = np.floor(source * (max(target / source) + 1e-8))
    offset = np.floor((resized - target) / 2)
    return np.asarray(points, float) * resized - offset


def analyze(arrays, marks, assumptions, source_size):
    points = arrays['pts3d_0']
    valid = arrays['mask_0'].squeeze().astype(bool) & np.isfinite(points).all(-1)
    height, width = valid.shape
    convert = lambda xy: image_coordinates(xy, source_size, (width, height))
    references = []
    for x, y in np.round(convert(marks['table'])).astype(int):
        if not (2 <= x < width - 2 and 2 <= y < height - 2):
            raise InsufficientGeometry('Reference point is too close to an image edge.')
        patch = points[y-2:y+3, x-2:x+3][valid[y-2:y+3, x-2:x+3]]
        if len(patch) < 12:
            raise InsufficientGeometry('Reference plane is not reconstructed.')
        references.append(np.median(patch, axis=0))
    origin = np.mean(references, axis=0)
    u, v = references[1] - references[0], references[2] - references[0]
    normal = np.cross(u, v)
    if np.linalg.norm(normal) < .05 * np.linalg.norm(u) * np.linalg.norm(v):
        raise InsufficientGeometry('Reference points are collinear.')
    normal /= np.linalg.norm(normal)
    camera = arrays['camera_poses_0'][:3, 3]
    if normal @ (camera - origin) < 0:
        normal = -normal
    axis = u / np.linalg.norm(u)
    rotation = np.stack([axis, np.cross(normal, axis), normal], axis=1)
    aligned = (points - origin) @ rotation
    mask_image = Image.new('1', (width, height))
    ImageDraw.Draw(mask_image).polygon([tuple(x) for x in convert(marks['pile'])], fill=1)
    pile = np.asarray(mask_image).astype(bool) & valid
    surface = aligned[pile]
    if len(surface) < 100:
        raise InsufficientGeometry('Too little visible fill surface.')
    lengths = []
    depth = arrays['depth_z_0'].squeeze()
    intrinsics = arrays['intrinsics_0']
    for edge in marks['edges']:
        endpoints = convert(edge)
        x, y = np.round(endpoints.mean(0)).astype(int)
        if not (2 <= x < width - 2 and 2 <= y < height - 2) or not pile[y, x]:
            raise InsufficientGeometry('Sample must lie on the fill surface.')
        local_valid = valid[y-2:y+3, x-2:x+3]
        z = np.median(depth[y-2:y+3, x-2:x+3][local_valid])
        lengths.append(np.linalg.norm((endpoints[1]-endpoints[0]) / intrinsics.diagonal()[:2] * z))
    lengths = np.array(lengths)
    if not np.isfinite(lengths).all() or lengths.min() <= 0:
        raise InsufficientGeometry('Invalid sample lengths.')
    if np.quantile(lengths, .9) / np.quantile(lengths, .1) > 2.5:
        raise InsufficientGeometry('Sample lengths disagree substantially.')
    reference_length = np.quantile(lengths, .75)
    length = reference_length * 1.05
    hull = ConvexHull(surface[:, :2])
    equations = hull.equations
    spacing = length / 8
    lo, hi = surface[:, :2].min(0), surface[:, :2].max(0)
    if np.prod(np.ceil((hi-lo)/spacing)+1) > 300_000:
        raise InsufficientGeometry('Sample scale is too small for the fill area.')
    gx, gy = np.meshgrid(np.arange(lo[0], hi[0], spacing), np.arange(lo[1], hi[1], spacing))
    xy = np.stack([gx.ravel(), gy.ravel()], 1)
    xy = xy[np.all(xy @ equations[:, :2].T + equations[:, 2] <= 0, axis=1)]
    if len(xy) < 20:
        raise InsufficientGeometry('Fill area is too small.')
    _, nearest = cKDTree(surface[:, :2]).query(xy, k=7)
    heights = np.median(surface[nearest, 2], axis=1)
    shape = {'cuboid': 1., 'ellipsoid': math.pi / 6, 'triangular_prism': .5}[assumptions['shape']]

    def count(orientation, width_scale, height_scale, packing_scale, floor_offset):
        size = reference_length * orientation
        floor = size * floor_offset
        volume = np.maximum(heights-floor, 0).sum() * spacing**2
        item = shape * size**3 * assumptions['widthRatio'] * width_scale * assumptions['heightRatio'] * height_scale
        return volume * min(1., assumptions['packing'] * packing_scale) / item

    best = count(1.05, 1., 1., 1., assumptions['floorOffset'])
    scenarios = [count(o, w, h, p, b) for o, w, h, p, b in itertools.product(
        [1., 1.05, 1.15], [.75, 1., 1.25], [.75, 1., 1.25], [.8, 1., 1.15],
        [0., assumptions['floorOffset'], assumptions['floorOffset']+1.])]
    if np.median(heights) <= assumptions['floorOffset'] * length or best < 1 or max(scenarios) > 1_000_000:
        raise InsufficientGeometry('Depth or scale does not support an estimate.')
    estimate = {'count': max(1, round(best)), 'lowerBound': max(0, math.floor(min(scenarios))), 'upperBound': math.ceil(max(scenarios))}
    return estimate, {'origin': origin, 'rotation': rotation, 'equations': equations, 'length': length,
                      'medianHeight': float(np.median(heights)), 'sampleSpread': float(np.std(lengths)/np.mean(lengths))}
