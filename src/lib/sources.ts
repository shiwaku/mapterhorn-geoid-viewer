import { PMTiles } from 'pmtiles';
import { contourInterval, contourLevels, isolines } from './contours';
import { decodeTerrarium, encodeTerrarium, type HeightGrid } from './terrarium';
import {
	greatCircleDistance,
	greatCirclePoints,
	wrapLng,
	zoomForSpacing,
	type LngLat
} from './profile';
import {
	ancestorTile,
	bilinear,
	fillTemplate,
	lngLatToTile,
	resampleFromAncestor,
	sampleCornersFromAncestor,
	tileToLngLat,
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

/** タイルを segments 分割した格子点のジオイド高 (メッシュの頂点用) */
export async function geoidCornersForTile(tile: TileIndex, segments: number): Promise<HeightGrid> {
	const ancestor = ancestorTile(tile, GEOID_MAX_ZOOM);
	return sampleCornersFromAncestor(await loadGeoidGrid(ancestor), ancestor, tile, segments);
}

/** 地点のジオイド高 (ジオイドタイルを双一次補間) */
export async function geoidAt(lng: number, lat: number): Promise<number> {
	const { tile, u, v } = lngLatToTile(wrapLng(lng), lat, GEOID_MAX_ZOOM);
	const grid = await loadGeoidGrid(tile);
	return bilinear(grid, u * grid.size - 0.5, v * grid.size - 0.5);
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

/** 地点の標高。load はタイルの読み込み (同じタイルを何度も読まないようにキャッシュを渡せる) */
async function orthometricAt(
	lng: number,
	lat: number,
	z: number,
	load: (tile: TileIndex) => Promise<HeightGrid> = fetchMapterhorn
): Promise<number> {
	const { tile, u, v } = lngLatToTile(wrapLng(lng), lat, z);
	const { size, data } = await load(tile);
	return data[
		Math.min(Math.floor(v * size), size - 1) * size + Math.min(Math.floor(u * size), size - 1)
	];
}

/** 地点の H・N・h を求める。zoom は Mapterhorn のタイルを読むズーム。 */
export async function queryPoint(lng: number, lat: number, zoom: number): Promise<PointHeights> {
	const z = Math.min(Math.max(Math.floor(zoom), 0), MAPTERHORN_MAX_ZOOM);
	const [orthometric, geoid] = await Promise.all([orthometricAt(lng, lat, z), geoidAt(lng, lat)]);
	return { orthometric, geoid, ellipsoidal: orthometric + geoid };
}

export type ProfileSample = PointHeights & {
	/** 始点からの距離 (m) */
	distance: number;
	lngLat: LngLat;
};

export type Profile = {
	/** 全長 (m) */
	length: number;
	/** 標高を読んだ Mapterhorn のズーム */
	zoom: number;
	samples: ProfileSample[];
};

/** 2 点を結ぶ大円に沿って count 点の H・N・h を求める */
export async function queryProfile(
	a: LngLat,
	b: LngLat,
	count = 512,
	signal?: AbortSignal
): Promise<Profile> {
	const length = greatCircleDistance(a, b);
	const points = greatCirclePoints(a, b, count);
	const spacing = length / Math.max(count - 1, 1);
	// 1 サンプルが 1 ピクセル程度になるズーム。緯度が低いほどピクセルが大きいので、いちばん低い緯度で決める
	const minAbsLat = Math.min(...points.map(([, lat]) => Math.abs(lat)));
	const zoom = zoomForSpacing(spacing, minAbsLat, MAPTERHORN_TILE_SIZE, MAPTERHORN_MAX_ZOOM);

	const tiles = new Map<string, Promise<HeightGrid>>();
	const load = (tile: TileIndex) => {
		const key = `${tile.z}/${tile.x}/${tile.y}`;
		let grid = tiles.get(key);
		if (!grid) tiles.set(key, (grid = fetchMapterhorn(tile, signal)));
		return grid;
	};
	const samples = await Promise.all(
		points.map(async (lngLat, i): Promise<ProfileSample> => {
			const [orthometric, geoid] = await Promise.all([
				orthometricAt(lngLat[0], lngLat[1], zoom, load),
				geoidAt(lngLat[0], lngLat[1])
			]);
			return {
				distance: i * spacing,
				lngLat,
				orthometric,
				geoid,
				ellipsoidal: orthometric + geoid
			};
		})
	);
	return { length, zoom, samples };
}

export type GeoidView = {
	/** 見えている範囲のジオイド高の最小・最大 (m) */
	min: number;
	max: number;
	/** 等値線の間隔 (m) */
	interval: number;
	/** 等ジオイド高線。properties.n がジオイド高、properties.major が太線 (間隔の 5 倍ごと) */
	contours: GeoJSON.FeatureCollection<GeoJSON.LineString>;
};

/** 範囲を覆うタイル。数が maxTiles を超えないようにズームを下げる */
export function tilesCovering(
	bounds: { west: number; south: number; east: number; north: number },
	zoom: number,
	maxTiles: number
): TileIndex[] {
	const south = Math.max(bounds.south, -85.05);
	const north = Math.min(bounds.north, 85.05);
	for (let z = Math.max(Math.floor(zoom), 0); z >= 0; z--) {
		const n = 1 << z;
		// 経度は ±180° を超えることがあるので、タイル番号も折り返す前の値で数える
		const xWest = Math.floor(((bounds.west + 180) / 360) * n);
		let xEast = Math.floor(((bounds.east + 180) / 360) * n);
		if (xEast < xWest) xEast += n;
		const xs = Math.min(xEast - xWest + 1, n);
		const yNorth = lngLatToTile(0, north, z).tile.y;
		const ySouth = lngLatToTile(0, south, z).tile.y;
		if (xs * (ySouth - yNorth + 1) > maxTiles && z > 0) continue;
		const tiles: TileIndex[] = [];
		for (let i = 0; i < xs; i++) {
			for (let y = yNorth; y <= ySouth; y++) tiles.push({ z, x: (((xWest + i) % n) + n) % n, y });
		}
		return tiles;
	}
	return [{ z: 0, x: 0, y: 0 }];
}

/**
 * 見えている範囲のジオイド高の範囲と等ジオイド高線。
 * 範囲は画面上の地点 (visiblePoints) の値から決める。視点を傾けると bounds は画面の外の遠くまで含むため
 */
export async function geoidView(
	bounds: { west: number; south: number; east: number; north: number },
	zoom: number,
	visiblePoints: LngLat[]
): Promise<GeoidView> {
	const tiles = tilesCovering(bounds, zoom - 1, 64);
	// タイルが少ないとき (地球全体など) は細かく分ける
	const segments = tiles.length <= 4 ? 128 : 64;
	const [grids, visible] = await Promise.all([
		Promise.all(tiles.map((t) => geoidCornersForTile(t, segments))),
		Promise.all(visiblePoints.map(([lng, lat]) => geoidAt(lng, lat)))
	]);
	let min = Infinity;
	let max = -Infinity;
	for (const v of visible.length ? visible : grids.flatMap((g) => Array.from(g.data))) {
		if (v < min) min = v;
		if (v > max) max = v;
	}
	const interval = contourInterval(min, max);
	// 画面の外の遠くで線が混み合わないよう、見えている範囲の少し外までにする
	const levels = contourLevels(min - 2 * interval, max + 2 * interval, interval);
	const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
	for (const level of levels) {
		const major = Math.abs(level / (interval * 5) - Math.round(level / (interval * 5))) < 1e-9;
		tiles.forEach((tile, k) => {
			for (const line of isolines(grids[k], level)) {
				features.push({
					type: 'Feature',
					properties: { n: level, major },
					geometry: {
						type: 'LineString',
						coordinates: line.map(([gx, gy]) =>
							tileToLngLat(tile.z, tile.x + gx / segments, tile.y + gy / segments)
						)
					}
				});
			}
		});
	}
	return { min, max, interval, contours: { type: 'FeatureCollection', features } };
}
