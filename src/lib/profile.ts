/** 断面図の計算 (地球は球で近似する。距離の目盛りに使うだけなので十分) */

export type LngLat = [number, number];

/** 平均半径 (m) */
export const EARTH_RADIUS = 6371008.8;
const EARTH_CIRCUMFERENCE = 2 * Math.PI * EARTH_RADIUS;
const RAD = Math.PI / 180;

function toVector([lng, lat]: LngLat): [number, number, number] {
	const cosLat = Math.cos(lat * RAD);
	return [cosLat * Math.cos(lng * RAD), cosLat * Math.sin(lng * RAD), Math.sin(lat * RAD)];
}

function centralAngle(a: LngLat, b: LngLat): number {
	const [ax, ay, az] = toVector(a);
	const [bx, by, bz] = toVector(b);
	// acos は 0 付近で精度が落ちるので atan2 で求める
	const cx = ay * bz - az * by;
	const cy = az * bx - ax * bz;
	const cz = ax * by - ay * bx;
	return Math.atan2(Math.hypot(cx, cy, cz), ax * bx + ay * by + az * bz);
}

/** 2 点間の大円距離 (m) */
export function greatCircleDistance(a: LngLat, b: LngLat): number {
	return centralAngle(a, b) * EARTH_RADIUS;
}

/**
 * 2 点を結ぶ大円上に count 個の点を等間隔に取る (両端を含む)。
 * 経度は連続させるので、日付変更線をまたぐと ±180° の外に出る。
 */
export function greatCirclePoints(a: LngLat, b: LngLat, count: number): LngLat[] {
	const d = centralAngle(a, b);
	const va = toVector(a);
	const vb = toVector(b);
	const points: LngLat[] = [];
	for (let i = 0; i < count; i++) {
		const f = count === 1 ? 0 : i / (count - 1);
		// 球面線形補間。2 点がほぼ同じなら普通の線形補間にする
		const [wa, wb] = d < 1e-12 ? [1 - f, f] : [Math.sin((1 - f) * d), Math.sin(f * d)];
		const x = wa * va[0] + wb * vb[0];
		const y = wa * va[1] + wb * vb[1];
		const z = wa * va[2] + wb * vb[2];
		let lng = Math.atan2(y, x) / RAD;
		const lat = Math.atan2(z, Math.hypot(x, y)) / RAD;
		const prev = points.length ? points[points.length - 1][0] : a[0];
		lng += 360 * Math.round((prev - lng) / 360);
		points.push([lng, lat]);
	}
	return points;
}

/** 経度を -180〜180 に戻す */
export function wrapLng(lng: number): number {
	return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** 1 ピクセルが spacing (m) 程度になるタイルのズーム (0〜maxZoom) */
export function zoomForSpacing(
	spacing: number,
	lat: number,
	tileSize: number,
	maxZoom: number
): number {
	const z = Math.floor(
		Math.log2((EARTH_CIRCUMFERENCE * Math.cos(lat * RAD)) / (tileSize * spacing))
	);
	return Math.min(Math.max(Number.isFinite(z) ? z : maxZoom, 0), maxZoom);
}

/** min〜max を count 個程度に区切る、きりのよい目盛り */
export function niceTicks(min: number, max: number, count: number): number[] {
	if (!(max > min)) return [min];
	const rough = (max - min) / count;
	const power = 10 ** Math.floor(Math.log10(rough));
	const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? 10 * power;
	const ticks: number[] = [];
	for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
		// 0.1 + 0.2 のような誤差を消す
		ticks.push(Number(v.toPrecision(12)));
	}
	return ticks;
}
