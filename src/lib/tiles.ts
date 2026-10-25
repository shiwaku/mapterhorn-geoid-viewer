import type { HeightGrid } from './terrarium';

export type TileIndex = { z: number; x: number; y: number };

/** maxZoom を超えるタイルについて、それを含む maxZoom の祖先タイルを返す */
export function ancestorTile(tile: TileIndex, maxZoom: number): TileIndex {
	const dz = Math.max(0, tile.z - maxZoom);
	return { z: tile.z - dz, x: tile.x >> dz, y: tile.y >> dz };
}

/** グリッドのピクセル座標 (fx, fy) を双一次補間する。範囲外は端の値 */
export function bilinear(src: HeightGrid, fx: number, fy: number): number {
	const max = src.size - 1;
	fx = Math.min(Math.max(fx, 0), max);
	fy = Math.min(Math.max(fy, 0), max);
	const x0 = Math.min(Math.floor(fx), max - 1);
	const y0 = Math.min(Math.floor(fy), max - 1);
	const tx = fx - x0;
	const ty = fy - y0;
	const a = src.data[y0 * src.size + x0];
	const b = src.data[y0 * src.size + x0 + 1];
	const c = src.data[(y0 + 1) * src.size + x0];
	const d = src.data[(y0 + 1) * src.size + x0 + 1];
	return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/** tile が祖先タイル内で占める範囲 (祖先のピクセル座標の原点と幅) */
function spanInAncestor(src: HeightGrid, ancestor: TileIndex, tile: TileIndex) {
	const dz = tile.z - ancestor.z;
	const span = src.size / (1 << dz);
	return {
		ox: (tile.x - (ancestor.x << dz)) * span,
		oy: (tile.y - (ancestor.y << dz)) * span,
		span
	};
}

/** 祖先タイルのグリッドから、tile の範囲を size × size のピクセル中心で切り出す */
export function resampleFromAncestor(
	src: HeightGrid,
	ancestor: TileIndex,
	tile: TileIndex,
	size: number
): HeightGrid {
	const { ox, oy, span } = spanInAncestor(src, ancestor, tile);
	const scale = span / size;
	const data = new Float32Array(size * size);
	for (let j = 0; j < size; j++) {
		const fy = oy + (j + 0.5) * scale - 0.5;
		for (let i = 0; i < size; i++) {
			data[j * size + i] = bilinear(src, ox + (i + 0.5) * scale - 0.5, fy);
		}
	}
	return { size, data };
}

/**
 * 祖先タイルのグリッドから、tile を segments 分割した格子点 ((segments + 1)² 個) の値を取る。
 * 格子点はタイルの四隅を含むので、隣のタイルと端がそろう。
 */
export function sampleCornersFromAncestor(
	src: HeightGrid,
	ancestor: TileIndex,
	tile: TileIndex,
	segments: number
): HeightGrid {
	const { ox, oy, span } = spanInAncestor(src, ancestor, tile);
	const scale = span / segments;
	const size = segments + 1;
	const data = new Float32Array(size * size);
	for (let j = 0; j < size; j++) {
		const fy = oy + j * scale - 0.5;
		for (let i = 0; i < size; i++) {
			data[j * size + i] = bilinear(src, ox + i * scale - 0.5, fy);
		}
	}
	return { size, data };
}

/** 経緯度を含むタイルと、タイル内の位置 (0〜1) を返す */
export function lngLatToTile(lng: number, lat: number, z: number) {
	const n = 1 << z;
	const fx = ((lng + 180) / 360) * n;
	const sin = Math.sin((lat * Math.PI) / 180);
	const fy = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n;
	const x = Math.min(Math.floor(fx), n - 1);
	const y = Math.min(Math.max(Math.floor(fy), 0), n - 1);
	return { tile: { z, x, y }, u: fx - x, v: fy - y };
}

export function fillTemplate(template: string, { z, x, y }: TileIndex) {
	return template.replace('{z}', `${z}`).replace('{x}', `${x}`).replace('{y}', `${y}`);
}

/** タイル座標 (小数可) の経緯度 */
export function tileToLngLat(z: number, fx: number, fy: number): [number, number] {
	const n = 1 << z;
	const lng = (fx / n) * 360 - 180;
	const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * fy) / n))) * 180) / Math.PI;
	return [lng, lat];
}
