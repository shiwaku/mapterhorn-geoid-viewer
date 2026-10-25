/** ジオイド高 (m) の段彩。負は青、正は赤 */
export const GEOID_COLOR_STOPS: [number, [number, number, number]][] = [
	[-100, [33, 102, 172]],
	[-40, [103, 169, 207]],
	[0, [247, 247, 247]],
	[40, [239, 138, 98]],
	[80, [178, 24, 43]]
];

export function geoidColor(n: number): [number, number, number] {
	const stops = GEOID_COLOR_STOPS;
	if (n <= stops[0][0]) return stops[0][1];
	for (let i = 1; i < stops.length; i++) {
		const [v1, c1] = stops[i];
		if (n <= v1) {
			const [v0, c0] = stops[i - 1];
			const t = (n - v0) / (v1 - v0);
			return [0, 1, 2].map((k) => c0[k] + (c1[k] - c0[k]) * t) as [number, number, number];
		}
	}
	return stops[stops.length - 1][1];
}
