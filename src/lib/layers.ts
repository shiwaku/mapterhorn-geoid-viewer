import { COORDINATE_SYSTEM, type Layer } from '@deck.gl/core';
import { TileLayer, type TileLayerProps } from '@deck.gl/geo-layers';
import { SimpleMeshLayer } from '@deck.gl/mesh-layers';
import { geoidColor } from './colors';
import { geoidCornersForTile } from './sources';
import { tileToLngLat, type TileIndex } from './tiles';

/** 1 タイルの分割数。globe では三角形が球面の弦になるので、粗いと面が地球の内側に沈む */
const SEGMENTS = 32;

export type GeoidLayerOptions = {
	exaggeration: number;
	visible: boolean;
	opacity: number;
};

type GeoidMesh = {
	attributes: {
		POSITION: { value: Float32Array; size: 3 };
		COLOR_0: { value: Float32Array; size: 3 };
	};
	indices: { value: Uint32Array; size: 1 };
};

// 格子の三角形の並びはどのタイルでも同じ
const indices = (() => {
	const size = SEGMENTS + 1;
	const out = new Uint32Array(SEGMENTS * SEGMENTS * 6);
	let k = 0;
	for (let j = 0; j < SEGMENTS; j++) {
		for (let i = 0; i < SEGMENTS; i++) {
			const a = j * size + i;
			out.set([a, a + size, a + 1, a + 1, a + size, a + size + 1], k);
			k += 6;
		}
	}
	return out;
})();

/** ジオイド面のメッシュ。頂点は経緯度とジオイド高 (m) */
async function buildGeoidMesh(tile: TileIndex, exaggeration: number): Promise<GeoidMesh> {
	const grid = await geoidCornersForTile(tile, SEGMENTS);
	const size = SEGMENTS + 1;
	const positions = new Float32Array(size * size * 3);
	const colors = new Float32Array(size * size * 3);
	for (let j = 0; j < size; j++) {
		for (let i = 0; i < size; i++) {
			const k = j * size + i;
			const [lng, lat] = tileToLngLat(tile.z, tile.x + i / SEGMENTS, tile.y + j / SEGMENTS);
			const n = grid.data[k];
			positions.set([lng, lat, n * exaggeration], k * 3);
			colors.set(
				geoidColor(n).map((c) => c / 255),
				k * 3
			);
		}
	}
	return {
		attributes: {
			POSITION: { value: positions, size: 3 },
			COLOR_0: { value: colors, size: 3 }
		},
		indices: { value: indices, size: 1 }
	};
}

const renderSubLayers: TileLayerProps<GeoidMesh>['renderSubLayers'] = (props) =>
	props.data &&
	new SimpleMeshLayer({
		id: props.id,
		data: [0],
		mesh: props.data,
		// メッシュの頂点をそのまま経緯度として扱う
		_instanced: false,
		coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
		getPosition: () => [0, 0, 0],
		// 色は頂点ごとの段彩で決める
		getColor: [255, 255, 255],
		material: { ambient: 0.75, diffuse: 0.35, shininess: 1, specularColor: [0, 0, 0] },
		opacity: props.opacity,
		// 陸ではジオイド面は地表の下にあり、海上では地表面 (h = N) と同じ高さになる。
		// どちらでも見えるよう、地形との前後関係は無視して半透明で重ねる
		parameters: { depthCompare: 'always', depthWriteEnabled: false }
	});

export function createGeoidLayer(opts: GeoidLayerOptions): Layer {
	return new TileLayer<GeoidMesh>({
		id: 'geoid',
		visible: opts.visible,
		opacity: opts.opacity,
		tileSize: 512,
		// ジオイドは滑らかなので、これより先は拡大して使う
		maxZoom: 12,
		getTileData: ({ index }) => buildGeoidMesh(index, opts.exaggeration),
		renderSubLayers,
		updateTriggers: { getTileData: opts.exaggeration }
	});
}
