"""EGM2008 のジオイド高グリッドを Terrarium エンコードの PMTiles に変換する。

入力: PROJ が配布する us_nga_egm08_25.tif (2.5 分格子、PixelIsPoint、WGS 84 楕円体基準のジオイド高)
出力: 512px の Terrarium タイル (WebP 可逆圧縮) を z0..maxzoom で格納した PMTiles

ズーム 4 で日本付近の格子間隔 (約 4 km) とほぼ同じ解像度になる。
EGM2008 自体の精度は 10 cm 程度なので、高さは 1/64 m 単位に丸めて圧縮率を上げる。
"""

import argparse
import io
import math
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

TILE_SIZE = 512
MAX_LAT = 85.0511287798066
SOURCE_URL = "https://cdn.proj.org/us_nga_egm08_25.tif"


def load_grid(path: Path) -> tuple[np.ndarray, float, float, float]:
    """グリッドと、左上格子点の経緯度・格子間隔を返す。"""
    with tifffile.TiffFile(path) as tif:
        page = tif.pages[0]
        grid = page.asarray().astype(np.float64)
        scale = page.tags["ModelPixelScaleTag"].value
        tiepoint = page.tags["ModelTiepointTag"].value
    if not math.isclose(scale[0], scale[1]):
        raise ValueError("経度・緯度方向の格子間隔が異なるグリッドには未対応")
    # PixelIsPoint なので tiepoint は格子点 (0, 0) の座標そのもの
    return grid, tiepoint[3], tiepoint[4], scale[0]


def sample_bilinear(
    grid: np.ndarray, lon0: float, lat0: float, step: float, lon: np.ndarray, lat: np.ndarray
) -> np.ndarray:
    rows, cols = grid.shape
    fx = (lon - lon0) / step
    fy = (lat0 - lat) / step
    x0 = np.floor(fx).astype(np.int64)
    y0 = np.clip(np.floor(fy).astype(np.int64), 0, rows - 2)
    tx = fx - x0
    ty = np.clip(fy - y0, 0.0, 1.0)
    # 経度方向は全周なので折り返す
    xa = np.mod(x0, cols)
    xb = np.mod(x0 + 1, cols)
    top = grid[y0, xa] * (1 - tx) + grid[y0, xb] * tx
    bottom = grid[y0 + 1, xa] * (1 - tx) + grid[y0 + 1, xb] * tx
    return top * (1 - ty) + bottom * ty


def tile_lonlat(z: int, x: int, y: int) -> tuple[np.ndarray, np.ndarray]:
    """タイル内の各ピクセル中心の経緯度。"""
    world = TILE_SIZE * (1 << z)
    px = (np.arange(TILE_SIZE) + 0.5 + x * TILE_SIZE) / world
    py = (np.arange(TILE_SIZE) + 0.5 + y * TILE_SIZE) / world
    lon = px * 360.0 - 180.0
    lat = np.degrees(np.arctan(np.sinh(math.pi * (1.0 - 2.0 * py))))
    return np.meshgrid(lon, lat)


def encode_terrarium(height: np.ndarray, quantum: int) -> bytes:
    """height = (R * 256 + G + B / 256) - 32768。quantum は 1 m あたりの分割数。"""
    height = np.round(height * quantum) / quantum
    v = np.round((height + 32768.0) * 256.0).astype(np.int64)
    rgb = np.stack([(v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF], axis=-1).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(rgb, "RGB").save(buf, format="WEBP", lossless=True, quality=50, method=2)
    return buf.getvalue()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="us_nga_egm08_25.tif")
    parser.add_argument("output", type=Path, help="出力する .pmtiles")
    parser.add_argument("--maxzoom", type=int, default=4)
    parser.add_argument("--quantum", type=int, default=64, help="1 m あたりの分割数")
    args = parser.parse_args()

    grid, lon0, lat0, step = load_grid(args.input)
    print(f"grid {grid.shape}, origin ({lon0}, {lat0}), step {step}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    tiles: list[tuple[int, bytes]] = []
    for z in range(args.maxzoom + 1):
        n = 1 << z
        for y in range(n):
            for x in range(n):
                lon, lat = tile_lonlat(z, x, y)
                height = sample_bilinear(grid, lon0, lat0, step, lon, lat)
                tiles.append((zxy_to_tileid(z, x, y), encode_terrarium(height, args.quantum)))
        print(f"z{z}: {n * n} tiles")

    tiles.sort(key=lambda t: t[0])
    with args.output.open("wb") as f:
        writer = Writer(f)
        for tile_id, data in tiles:
            writer.write_tile(tile_id, data)
        writer.finalize(
            {
                "tile_type": TileType.WEBP,
                "tile_compression": Compression.NONE,
                "min_zoom": 0,
                "max_zoom": args.maxzoom,
                "min_lon_e7": -1800000000,
                "min_lat_e7": int(-MAX_LAT * 1e7),
                "max_lon_e7": 1800000000,
                "max_lat_e7": int(MAX_LAT * 1e7),
                "center_zoom": 0,
                "center_lon_e7": 0,
                "center_lat_e7": 0,
            },
            {
                "name": "EGM2008 geoid undulation",
                "description": "EGM2008 geoid height above the WGS 84 ellipsoid (metres)",
                "encoding": "terrarium",
                "tileSize": TILE_SIZE,
                "attribution": "EGM2008: NGA (via PROJ-data)",
                "source": SOURCE_URL,
            },
        )
    print(f"wrote {args.output} ({args.output.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
