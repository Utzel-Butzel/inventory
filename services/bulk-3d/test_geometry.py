import unittest
import numpy as np
from geometry import analyze, image_coordinates, InsufficientGeometry


class GeometryTests(unittest.TestCase):
    def setUp(self):
        y, x = np.indices((100, 100))
        z = np.where((x >= 25) & (x <= 75) & (y >= 25) & (y <= 75), .25, 0.)
        pose = np.eye(4); pose[2, 3] = 1
        self.arrays = {'pts3d_0': np.stack([x*.01, y*.01, z], -1), 'mask_0': np.ones((100,100,1)),
                       'depth_z_0': np.ones((100,100,1)), 'intrinsics_0': np.diag([100.,100.,1.]), 'camera_poses_0': pose}
        self.marks = {'pile': [[.25,.25],[.75,.25],[.75,.75],[.25,.75]],
                      'table': [[.1,.1],[.9,.1],[.1,.9]],
                      'edges': [[[.3,.3],[.4,.3]],[[.4,.4],[.5,.4]],[[.5,.5],[.6,.5]]]}
        self.assumptions = {'shape': 'cuboid', 'widthRatio': .8, 'heightRatio': .8, 'packing': .6, 'floorOffset': .6}

    def test_unknown_global_scale_cancels(self):
        first, _ = analyze(self.arrays, self.marks, self.assumptions, (100,100))
        scaled = {key: value.copy() for key, value in self.arrays.items()}
        scaled['pts3d_0'] *= 3; scaled['depth_z_0'] *= 3; scaled['camera_poses_0'][:3,3] *= 3
        second, _ = analyze(scaled, self.marks, self.assumptions, (100,100))
        self.assertLessEqual(abs(first['count']-second['count']), 1)
        self.assertLess(first['lowerBound'], first['count']); self.assertGreater(first['upperBound'], first['count'])

    def test_smaller_outer_shape_increases_count(self):
        block, _ = analyze(self.arrays, self.marks, self.assumptions, (100,100))
        wedge, _ = analyze(self.arrays, self.marks, {**self.assumptions, 'shape': 'triangular_prism'}, (100,100))
        self.assertLessEqual(abs(wedge['count']-2*block['count']), 1)

    def test_plane_and_sample_failures_abstain(self):
        with self.assertRaises(InsufficientGeometry):
            analyze(self.arrays, {**self.marks, 'table': [[.1,.1],[.2,.1],[.3,.1]]}, self.assumptions, (100,100))
        with self.assertRaises(InsufficientGeometry):
            analyze(self.arrays, self.marks, {**self.assumptions, 'floorOffset': 3}, (100,100))
        self.arrays['mask_0'][:] = 0
        with self.assertRaises(InsufficientGeometry):
            analyze(self.arrays, self.marks, self.assumptions, (100,100))

    def test_original_to_processed_crop_mapping(self):
        np.testing.assert_allclose(image_coordinates([[.5,.5]], (1200,1600), (392,518)), [[196,259]])


if __name__ == '__main__':
    unittest.main()
