import type { HeightGrid } from './terrarium';

export type TileIndex = { z: number; x: number; y: number };

/** maxZoom を超えるタイルについて、それを含む maxZoom の祖先タイルを返す */
export function ancestorTile(tile: TileIndex, maxZoom: number): TileIndex {
	const dz = Math.max(0, tile.z - maxZoom);
	return { z: tile.z - dz, x: tile.x >> dz, y: tile.y >> dz };
}

/** 祖先タイルのグリッドから、tile の範囲を size × size に双一次補間で切り出す */
export function resampleFromAncestor(
	src: HeightGrid,
	ancestor: TileIndex,
	tile: TileIndex,
	size: number
): HeightGrid {
	const dz = tile.z - ancestor.z;
	// tile が祖先タイル内で占める範囲 (祖先のピクセル座標)
	const span = src.size / (1 << dz);
	const ox = (tile.x - (ancestor.x << dz)) * span;
	const oy = (tile.y - (ancestor.y << dz)) * span;
	const scale = span / size;
	const max = src.size - 1;

	const data = new Float32Array(size * size);
	for (let j = 0; j < size; j++) {
		const fy = Math.min(Math.max(oy + (j + 0.5) * scale - 0.5, 0), max);
		const y0 = Math.min(Math.floor(fy), max - 1);
		const ty = fy - y0;
		for (let i = 0; i < size; i++) {
			const fx = Math.min(Math.max(ox + (i + 0.5) * scale - 0.5, 0), max);
			const x0 = Math.min(Math.floor(fx), max - 1);
			const tx = fx - x0;
			const a = src.data[y0 * src.size + x0];
			const b = src.data[y0 * src.size + x0 + 1];
			const c = src.data[(y0 + 1) * src.size + x0];
			const d = src.data[(y0 + 1) * src.size + x0 + 1];
			data[j * size + i] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
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
