import { COORDINATE_SYSTEM, type Layer } from '@deck.gl/core';
import { TileLayer, type TileLayerProps } from '@deck.gl/geo-layers';
import { PathLayer } from '@deck.gl/layers';
import { SimpleMeshLayer } from '@deck.gl/mesh-layers';
import { colorAt, type ColorStops, type RGB } from './colors';
import { geoidCornersForTile } from './sources';
import { tileToLngLat, type TileIndex } from './tiles';

/** 1 タイルの分割数。globe では三角形が球面の弦になるので、粗いと面が地球の内側に沈む */
const SEGMENTS = 32;

/** 水面の色 */
export const WATER_COLOR: RGB = [56, 130, 210];

export type GeoidLayerOptions = {
	exaggeration: number;
	visible: boolean;
	opacity: number;
	/** 地表面を描かないとき。奥行きを判定して立体として描く */
	solid: boolean;
	/**
	 * color: ジオイド高で色分けする。
	 * water: ジオイドを水面として描き、地表面との前後関係を判定する (低い土地は沈む)
	 */
	style: 'color' | 'water';
	colorStops: ColorStops;
	/** 水面をジオイドから何 m 上げるか */
	waterLevel: number;
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

/** ジオイド面のメッシュ。頂点は経緯度と高さ (m) */
async function buildGeoidMesh(tile: TileIndex, opts: GeoidLayerOptions): Promise<GeoidMesh> {
	const grid = await geoidCornersForTile(tile, SEGMENTS);
	const water = opts.style === 'water';
	const size = SEGMENTS + 1;
	const positions = new Float32Array(size * size * 3);
	const colors = new Float32Array(size * size * 3);
	for (let j = 0; j < size; j++) {
		for (let i = 0; i < size; i++) {
			const k = j * size + i;
			const [lng, lat] = tileToLngLat(tile.z, tile.x + i / SEGMENTS, tile.y + j / SEGMENTS);
			const n = grid.data[k];
			positions.set([lng, lat, (n + (water ? opts.waterLevel : 0)) * opts.exaggeration], k * 3);
			colors.set(
				(water ? WATER_COLOR : colorAt(opts.colorStops, n)).map((c) => c / 255),
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

type SubLayerProps = Parameters<NonNullable<TileLayerProps<GeoidMesh>['renderSubLayers']>>[0];

const renderSubLayers = (props: SubLayerProps, opts: GeoidLayerOptions) => {
	// 地表面がないとき、または水面のときは、奥行きを判定する
	const depthTest = opts.solid || opts.style === 'water';
	return (
		props.data &&
		new SimpleMeshLayer({
			id: props.id,
			data: [0],
			mesh: props.data,
			// メッシュの頂点をそのまま経緯度として扱う
			_instanced: false,
			coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
			getPosition: () => [0, 0, 0],
			// 色は頂点ごとに決める
			getColor: [255, 255, 255],
			material: depthTest
				? { ambient: 0.45, diffuse: 0.7, shininess: 1, specularColor: [0, 0, 0] }
				: { ambient: 0.75, diffuse: 0.35, shininess: 1, specularColor: [0, 0, 0] },
			opacity: props.opacity,
			// 陸ではジオイド面は地表の下にあり、海上では地表面 (h = N) と同じ高さになる。
			// 色分けのときは、どちらでも見えるよう前後関係は無視して半透明で重ねる
			parameters: depthTest
				? {
						depthCompare: 'less-equal',
						depthWriteEnabled: true,
						// 海上の地表面 (h = N) と同じ高さになる水面は、手前に寄せてちらつきを防ぐ
						...(opts.style === 'water' ? { depthBias: -6, depthBiasSlopeScale: -1.5 } : {})
					}
				: { depthCompare: 'always', depthWriteEnabled: false }
		})
	);
};

export function createGeoidLayer(opts: GeoidLayerOptions): Layer {
	const lift = opts.style === 'water' ? opts.waterLevel : 0;
	return new TileLayer<GeoidMesh>({
		id: 'geoid',
		// 等ジオイド高線や地名より下に描く。MapLibreOverlay (interleaved) が読む属性で、型には無い
		...({ beforeId: 'geoid-contours' } as object),
		visible: opts.visible,
		opacity: opts.opacity,
		tileSize: 512,
		// ジオイドは滑らかなので、これより先は拡大して使う
		maxZoom: 12,
		// 強調した起伏でタイルが視野外と判定されないよう、高さの範囲を伝える
		zRange: [(-110 + lift) * opts.exaggeration, (90 + lift) * opts.exaggeration],
		getTileData: ({ index }) => buildGeoidMesh(index, opts),
		renderSubLayers: (props) => renderSubLayers(props, opts),
		updateTriggers: {
			getTileData: [
				opts.exaggeration,
				opts.style,
				opts.waterLevel,
				JSON.stringify(opts.colorStops)
			],
			renderSubLayers: [opts.solid, opts.style]
		}
	});
}

/** 地表面がないときの等ジオイド高線。立体のジオイド面の上に描く */
export function createContourLayer(
	contours: GeoJSON.FeatureCollection<GeoJSON.LineString>,
	exaggeration: number,
	visible: boolean
): Layer {
	return new PathLayer<GeoJSON.Feature<GeoJSON.LineString>>({
		id: 'geoid-contours',
		visible,
		data: contours.features,
		getPath: (f) =>
			f.geometry.coordinates.map(
				([lng, lat]) => [lng, lat, f.properties!.n * exaggeration] as [number, number, number]
			),
		getColor: [20, 30, 60, 220],
		getWidth: (f) => (f.properties!.major ? 2 : 1),
		widthUnits: 'pixels',
		updateTriggers: { getPath: exaggeration },
		// 面と同じ高さにあるので、手前に寄せてちらつきを防ぐ
		parameters: { depthCompare: 'less-equal', depthBias: -1, depthBiasSlopeScale: -2 }
	});
}
