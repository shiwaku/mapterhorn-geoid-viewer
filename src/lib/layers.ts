import { TerrainLayer } from '@deck.gl/geo-layers';
import type { Layer } from '@deck.gl/core';
import { load } from '@loaders.gl/core';
import { TerrainWorkerLoader } from '@loaders.gl/terrain';
// メッシュ生成用の loaders.gl Worker を CDN ではなく自前で配信する
import terrainWorkerUrl from '@loaders.gl/terrain/terrain-worker.js?url';
import { requestEllipsoidal } from './ground-client';
import { GEOID_MAX_ZOOM, MAPTERHORN_MAX_ZOOM, fetchGeoidBlob } from './sources';
import type { TileIndex } from './tiles';
import { terrariumDecoder } from './terrarium';

export const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export type LayerOptions = {
	exaggeration: number;
	showGround: boolean;
	showGeoid: boolean;
	groundOpacity: number;
	geoidOpacity: number;
	groundTexture: boolean;
};

type FetchContext = {
	propName: string;
	loadOptions?: Record<string, unknown>;
	signal?: AbortSignal;
};

/** elevationData に渡す独自スキームの URL ({z}/{x}/{y} は deck.gl が置換する) */
function parseTileUrl(url: string): TileIndex {
	const m = url.match(/(\d+)\/(\d+)\/(\d+)$/);
	if (!m) throw new Error(`タイル URL を解釈できません: ${url}`);
	return { z: Number(m[1]), x: Number(m[2]), y: Number(m[3]) };
}

async function fetchTexture(url: string, signal?: AbortSignal) {
	const res = await fetch(url, { signal });
	if (!res.ok) throw new Error(`テクスチャの取得に失敗: ${res.status}`);
	return createImageBitmap(await res.blob());
}

function terrainFetch(
	fetchHeights: (tile: TileIndex, signal?: AbortSignal) => Promise<Blob | ArrayBuffer>
) {
	return async (url: string, { propName, loadOptions, signal }: FetchContext) => {
		if (propName === 'texture') return fetchTexture(url, signal);
		const image = await fetchHeights(parseTileUrl(url), signal);
		return load(image, TerrainWorkerLoader, loadOptions);
	};
}

// レイヤを作り直しても再読み込みにならないよう、関数と設定は使い回す
const loadOptions = { terrain: { workerUrl: terrainWorkerUrl } };
const fetchGround = terrainFetch(requestEllipsoidal);
const fetchGeoid = terrainFetch(fetchGeoidBlob);

export function createLayers(opts: LayerOptions): Layer[] {
	const elevationDecoder = terrariumDecoder(opts.exaggeration);
	const layers: Layer[] = [];

	// 半透明の地表越しにジオイド面が見えるよう、ジオイド面を先に描く
	if (opts.showGeoid) {
		layers.push(
			new TerrainLayer({
				id: 'geoid',
				elevationData: 'geoid://{z}/{x}/{y}',
				elevationDecoder,
				maxZoom: GEOID_MAX_ZOOM,
				color: [40, 110, 230],
				opacity: opts.geoidOpacity,
				meshMaxError: 0.5,
				material: { ambient: 0.6, diffuse: 0.5, shininess: 32, specularColor: [80, 80, 80] },
				fetch: fetchGeoid,
				loadOptions,
				updateTriggers: { elevationDecoder: opts.exaggeration }
			})
		);
	}

	if (opts.showGround) {
		layers.push(
			new TerrainLayer({
				id: 'ground',
				elevationData: 'ellipsoid://{z}/{x}/{y}',
				texture: opts.groundTexture ? OSM_URL : null,
				elevationDecoder,
				maxZoom: MAPTERHORN_MAX_ZOOM,
				color: [214, 196, 160],
				opacity: opts.groundOpacity,
				meshMaxError: 4,
				fetch: fetchGround,
				loadOptions,
				updateTriggers: { elevationDecoder: opts.exaggeration }
			})
		);
	}

	return layers;
}
