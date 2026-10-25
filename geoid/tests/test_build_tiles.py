import io

import numpy as np
import pytest
from PIL import Image

from build_tiles import encode_terrarium, sample_bilinear, tile_lonlat


def decode(data: bytes) -> np.ndarray:
    rgb = np.asarray(Image.open(io.BytesIO(data)).convert("RGB")).astype(np.float64)
    return rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768


def test_encode_roundtrip_within_quantum():
    height = np.linspace(-110.0, 90.0, 512 * 512).reshape(512, 512)
    decoded = decode(encode_terrarium(height, quantum=64))
    assert np.max(np.abs(decoded - height)) <= 1 / 128 + 1e-9


def test_tile_lonlat_covers_world_at_z0():
    lon, lat = tile_lonlat(0, 0, 0)
    assert lon[0, 0] == pytest.approx(-180 + 360 / 1024)
    assert lon[0, -1] == pytest.approx(180 - 360 / 1024)
    assert lat[0, 0] < 85.06 and lat[-1, 0] > -85.06
    assert lat[0, 0] == pytest.approx(-lat[-1, 0])


def test_sample_bilinear_interpolates_and_wraps_longitude():
    # 経度方向に 0, 1, 2, 3 と増える 3 行 4 列のグリッド (間隔 90 度、左上が (-180, 90))
    grid = np.tile(np.arange(4, dtype=np.float64), (3, 1))
    lon = np.array([-180.0, -135.0, 90.0, 135.0])
    lat = np.zeros(4)
    got = sample_bilinear(grid, -180.0, 90.0, 90.0, lon, lat)
    # 135 度は 3 (90 度) と 0 (180 度 = -180 度) の中間
    np.testing.assert_allclose(got, [0.0, 0.5, 3.0, 1.5])
