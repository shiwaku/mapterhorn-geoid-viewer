export type RGB = [number, number, number];
/** 段彩の節点 (値、色) */
export type ColorStops = [number, RGB][];

/** 断面図と地図上の壁で使う、地表 (楕円体高 h) とジオイド (N) の線の色 */
export const GROUND_LINE_COLOR: RGB = [235, 104, 52];
export const GEOID_LINE_COLOR: RGB = [42, 120, 214];

/** 全球のジオイド高 (m) の段彩。負は青、正は赤 */
export const GEOID_COLOR_STOPS: ColorStops = [
	[-100, [33, 102, 172]],
	[-40, [103, 169, 207]],
	[0, [247, 247, 247]],
	[40, [239, 138, 98]],
	[80, [178, 24, 43]]
];

/** 表示範囲に合わせて伸ばす段彩 (viridis)。値は 0〜1 */
const RELATIVE_STOPS: ColorStops = [
	[0, [68, 1, 84]],
	[0.25, [59, 82, 139]],
	[0.5, [33, 145, 140]],
	[0.75, [94, 201, 98]],
	[1, [253, 231, 37]]
];

/** min〜max に合わせた段彩 */
export function stretchedStops(min: number, max: number): ColorStops {
	return RELATIVE_STOPS.map(([t, c]) => [min + (max - min) * t, c]);
}

export function colorAt(stops: ColorStops, n: number): RGB {
	if (n <= stops[0][0]) return stops[0][1];
	for (let i = 1; i < stops.length; i++) {
		const [v1, c1] = stops[i];
		if (n <= v1) {
			const [v0, c0] = stops[i - 1];
			const t = (n - v0) / (v1 - v0);
			return [0, 1, 2].map((k) => c0[k] + (c1[k] - c0[k]) * t) as RGB;
		}
	}
	return stops[stops.length - 1][1];
}

export function geoidColor(n: number): RGB {
	return colorAt(GEOID_COLOR_STOPS, n);
}

/** 凡例用の CSS グラデーション */
export function cssGradient(stops: ColorStops): string {
	const min = stops[0][0];
	const max = stops[stops.length - 1][0];
	return `linear-gradient(to right, ${stops
		.map(([v, [r, g, b]]) => `rgb(${r} ${g} ${b}) ${((v - min) / (max - min || 1)) * 100}%`)
		.join(', ')})`;
}
