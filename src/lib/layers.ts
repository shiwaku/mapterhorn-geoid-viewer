import { COORDINATE_SYSTEM, type Layer } from '@deck.gl/core';
import { TileLayer, type TileLayerProps } from '@deck.gl/geo-layers';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import { SimpleMeshLayer } from '@deck.gl/mesh-layers';
import { colorAt, GEOID_LINE_COLOR, GROUND_LINE_COLOR, type ColorStops, type RGB } from './colors';
import type { Profile } from './sources';
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

type WallMesh = GeoidMesh;

/** 色を白に寄せる (amount = 0 で元の色、1 で白) */
const tint = (color: RGB, amount: number): RGB => color.map((c) => c + (255 - c) * amount) as RGB;

/**
 * 断面の壁。楕円体面〜ジオイド (ジオイド高 N) を青、ジオイド〜地表 (標高 H) をオレンジの帯にする。
 * 線の色を白に寄せた淡い色にして、すりガラスのように半透明で重ねる。
 * 色そのものを薄く重ねると、下の地図やジオイド面の色と混ざって濁るため
 */
function buildWallMesh(profile: Profile, exaggeration: number): WallMesh {
	const { samples } = profile;
	const bands: [(i: number) => number, (i: number) => number, RGB][] = [
		[() => 0, (i) => samples[i].geoid, tint(GEOID_LINE_COLOR, 0.78)],
		[(i) => samples[i].geoid, (i) => samples[i].ellipsoidal, tint(GROUND_LINE_COLOR, 0.8)]
	];
	const count = samples.length;
	const positions = new Float32Array(bands.length * count * 2 * 3);
	const colors = new Float32Array(bands.length * count * 2 * 3);
	const idx: number[] = [];
	bands.forEach(([lower, upper, color], b) => {
		const c = color.map((v) => v / 255);
		for (let i = 0; i < count; i++) {
			const [lng, lat] = samples[i].lngLat;
			const k = (b * count + i) * 2;
			positions.set([lng, lat, lower(i) * exaggeration, lng, lat, upper(i) * exaggeration], k * 3);
			colors.set([...c, ...c], k * 3);
			if (i > 0) idx.push(k - 2, k, k - 1, k - 1, k, k + 1);
		}
	});
	return {
		attributes: {
			POSITION: { value: positions, size: 3 },
			COLOR_0: { value: colors, size: 3 }
		},
		indices: { value: new Uint32Array(idx), size: 1 }
	};
}

type WallLine = { path: [number, number, number][]; color: RGB; width: number };

/** 断面の線・端点・カーソルの色 (slate-800)。データの色 (地表・ジオイド) と区別する */
export const CURSOR_COLOR: RGB = [30, 41, 59];

/**
 * 断面の線に沿って地図に立てる壁と、地表・ジオイドの線。
 * 楕円体面は壁の下端でわかるので線は引かない (ジオイドの線とほぼ重なり、交互に見えて点線のようになる)
 */
export function createProfileWallLayers(
	profile: Profile,
	exaggeration: number,
	hoverIndex?: number
): Layer[] {
	const path = (height: (s: Profile['samples'][number]) => number) =>
		profile.samples.map(
			(s) => [s.lngLat[0], s.lngLat[1], height(s) * exaggeration] as [number, number, number]
		);
	const lines: WallLine[] = [
		{ path: path((s) => s.geoid), color: GEOID_LINE_COLOR, width: 2.5 },
		{ path: path((s) => s.ellipsoidal), color: GROUND_LINE_COLOR, width: 2.5 }
	];
	// 壁は地面の下にも伸びるので、前後関係を無視して手前に描く
	const parameters = {
		depthCompare: 'always',
		depthWriteEnabled: false,
		cullMode: 'none'
	} as const;
	const lineProps = {
		data: lines,
		getPath: (d: WallLine) => d.path,
		widthUnits: 'pixels',
		// 線の幅を画面に向ける。地面に寝かせた帯にすると、globe では帯がねじれて途切れて見える
		billboard: true,
		jointRounded: true,
		capRounded: true,
		parameters
	} as const;
	return [
		new SimpleMeshLayer({
			id: 'profile-wall',
			data: [0],
			mesh: wallMesh(profile, exaggeration),
			_instanced: false,
			coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
			getPosition: () => [0, 0, 0],
			getColor: [255, 255, 255],
			// 陰影を付けず、淡い色の面にする。壁はほぼ地面の下にあるのに手前に描くので、
			// 透かすと手前の地形が壁の上を滑るように見える。不透明に近くして地形を透かさない
			material: { ambient: 1, diffuse: 0, shininess: 1, specularColor: [0, 0, 0] },
			opacity: 0.9,
			parameters
		}),
		new PathLayer<WallLine>({
			...lineProps,
			id: 'profile-wall-lines',
			getColor: (d) => d.color,
			getWidth: (d) => d.width
		}),
		...(hoverIndex === undefined
			? []
			: profileCursorLayers(profile.samples[hoverIndex], exaggeration, parameters))
	];
}

/** カーソルを動かすたびに作り直さないよう、壁のメッシュは同じ断面・強調なら使い回す */
let cachedWall: { profile: Profile; exaggeration: number; mesh: WallMesh } | undefined;

function wallMesh(profile: Profile, exaggeration: number): WallMesh {
	if (cachedWall?.profile !== profile || cachedWall.exaggeration !== exaggeration) {
		cachedWall = { profile, exaggeration, mesh: buildWallMesh(profile, exaggeration) };
	}
	return cachedWall.mesh;
}

/** 断面図のカーソル位置を壁の上に示す縦線と、ジオイド (N)・地表 (h) の点 */
function profileCursorLayers(
	sample: Profile['samples'][number],
	exaggeration: number,
	parameters: object
): Layer[] {
	const [lng, lat] = sample.lngLat;
	const at = (h: number): [number, number, number] => [lng, lat, h * exaggeration];
	const points = [
		{ position: at(sample.geoid), color: GEOID_LINE_COLOR },
		{ position: at(sample.ellipsoidal), color: GROUND_LINE_COLOR }
	];
	return [
		new PathLayer({
			id: 'profile-wall-cursor',
			data: [{ path: [at(0), at(Math.max(sample.ellipsoidal, sample.geoid))] }],
			getPath: (d) => d.path,
			getColor: CURSOR_COLOR,
			getWidth: 1.5,
			widthUnits: 'pixels',
			billboard: true,
			parameters
		}),
		new ScatterplotLayer<(typeof points)[number]>({
			id: 'profile-wall-cursor-points',
			data: points,
			getPosition: (d) => d.position,
			getFillColor: (d) => d.color,
			getLineColor: [255, 255, 255],
			getRadius: 4,
			radiusUnits: 'pixels',
			stroked: true,
			getLineWidth: 2,
			lineWidthUnits: 'pixels',
			billboard: true,
			parameters
		})
	];
}
