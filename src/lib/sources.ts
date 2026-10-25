import { PMTiles } from 'pmtiles';
import { decodeTerrarium, encodeTerrarium, type HeightGrid } from './terrarium';
import {
	ancestorTile,
	fillTemplate,
	lngLatToTile,
	resampleFromAncestor,
	type TileIndex
} from './tiles';

export const MAPTERHORN_URL = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';
export const MAPTERHORN_MAX_ZOOM = 17;
export const MAPTERHORN_TILE_SIZE = 512;
/** build_tiles.py の --maxzoom と合わせる */
export const GEOID_MAX_ZOOM = 4;

let geoidArchive: PMTiles | undefined;
const geoidCache = new Map<string, Promise<HeightGrid>>();

export function setGeoidUrl(url: string) {
	geoidArchive = new PMTiles(url);
	geoidCache.clear();
}

export async function fetchGeoidBlob({ z, x, y }: TileIndex, signal?: AbortSignal): Promise<Blob> {
	if (!geoidArchive) throw new Error('setGeoidUrl() が呼ばれていません');
	const res = await geoidArchive.getZxy(z, x, y, signal);
	if (!res) throw new Error(`ジオイドタイルがありません: ${z}/${x}/${y}`);
	return new Blob([res.data], { type: 'image/webp' });
}

function loadGeoidGrid(tile: TileIndex): Promise<HeightGrid> {
	const key = `${tile.z}/${tile.x}/${tile.y}`;
	let grid = geoidCache.get(key);
	if (!grid) {
		// 複数タイルから共有されるので、個々のタイルの中断シグナルは渡さない
		grid = fetchGeoidBlob(tile).then(decodeTerrarium);
		grid.catch(() => geoidCache.delete(key));
		geoidCache.set(key, grid);
	}
	return grid;
}

/** 任意のタイルの各ピクセルのジオイド高 */
export async function geoidForTile(tile: TileIndex, size: number): Promise<HeightGrid> {
	const ancestor = ancestorTile(tile, GEOID_MAX_ZOOM);
	return resampleFromAncestor(await loadGeoidGrid(ancestor), ancestor, tile, size);
}

export async function fetchMapterhorn(tile: TileIndex, signal?: AbortSignal) {
	const url = fillTemplate(MAPTERHORN_URL, tile);
	const res = await fetch(url, { signal });
	// 海域などデータのないタイルは 404 になるので、標高 0 m (平均海面) とみなす
	if (res.status === 404)
		return { size: MAPTERHORN_TILE_SIZE, data: new Float32Array(MAPTERHORN_TILE_SIZE ** 2) };
	if (!res.ok) throw new Error(`Mapterhorn タイルの取得に失敗: ${res.status} ${url}`);
	return decodeTerrarium(await res.blob());
}

/** 楕円体高 h = 標高 H (Mapterhorn) + ジオイド高 N (EGM2008) を Terrarium 画像にする */
export async function fetchEllipsoidalBlob(tile: TileIndex, signal?: AbortSignal): Promise<Blob> {
	const orthometric = await fetchMapterhorn(tile, signal);
	const geoid = await geoidForTile(tile, orthometric.size);
	const data = orthometric.data;
	for (let i = 0; i < data.length; i++) data[i] += geoid.data[i];
	return encodeTerrarium(orthometric);
}

export type PointHeights = {
	/** 標高 (Mapterhorn) */
	orthometric: number;
	/** ジオイド高 (EGM2008) */
	geoid: number;
	/** 楕円体高 */
	ellipsoidal: number;
};

/** 地点の H・N・h を求める。zoom は Mapterhorn のタイルを読むズーム。 */
export async function queryPoint(lng: number, lat: number, zoom: number): Promise<PointHeights> {
	const z = Math.min(Math.max(Math.floor(zoom), 0), MAPTERHORN_MAX_ZOOM);
	const { tile, u, v } = lngLatToTile(lng, lat, z);
	const orthometricGrid = await fetchMapterhorn(tile);
	const size = orthometricGrid.size;
	const index =
		Math.min(Math.floor(v * size), size - 1) * size + Math.min(Math.floor(u * size), size - 1);
	const geoidGrid = await geoidForTile(tile, size);
	const orthometric = orthometricGrid.data[index];
	const geoid = geoidGrid.data[index];
	return { orthometric, geoid, ellipsoidal: orthometric + geoid };
}
