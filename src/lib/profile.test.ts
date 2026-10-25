import { describe, expect, it } from 'vitest';
import {
	EARTH_RADIUS,
	greatCircleDistance,
	greatCirclePoints,
	niceTicks,
	wrapLng,
	zoomForSpacing
} from './profile';

describe('greatCircleDistance', () => {
	it('赤道上の経度 1° は円周の 1/360', () => {
		expect(greatCircleDistance([0, 0], [1, 0])).toBeCloseTo((2 * Math.PI * EARTH_RADIUS) / 360, 3);
	});

	it('同じ点は 0', () => {
		expect(greatCircleDistance([138.7, 35.4], [138.7, 35.4])).toBe(0);
	});
});

describe('greatCirclePoints', () => {
	it('両端を含み、等間隔に並ぶ', () => {
		const a: [number, number] = [138.73, 35.36];
		const b: [number, number] = [139.77, 35.68];
		const points = greatCirclePoints(a, b, 5);
		expect(points[0][0]).toBeCloseTo(a[0]);
		expect(points[0][1]).toBeCloseTo(a[1]);
		expect(points[4][0]).toBeCloseTo(b[0]);
		expect(points[4][1]).toBeCloseTo(b[1]);
		const step = greatCircleDistance(a, b) / 4;
		for (let i = 1; i < 5; i++) {
			expect(greatCircleDistance(points[i - 1], points[i])).toBeCloseTo(step, 3);
		}
	});

	it('日付変更線をまたいでも経度が飛ばない', () => {
		const points = greatCirclePoints([179, 0], [-179, 0], 3);
		expect(points.map(([lng]) => lng)).toEqual([179, 180, 181].map((v) => expect.closeTo(v)));
	});
});

describe('wrapLng', () => {
	it('-180〜180 に戻す', () => {
		expect(wrapLng(181)).toBeCloseTo(-179);
		expect(wrapLng(-181)).toBeCloseTo(179);
		expect(wrapLng(139)).toBeCloseTo(139);
	});
});

describe('zoomForSpacing', () => {
	it('赤道で 512 px タイルの 1 px が約 300 m になるのはズーム 8', () => {
		expect(zoomForSpacing(300, 0, 512, 17)).toBe(8);
	});

	it('細かすぎる間隔は maxZoom で止める', () => {
		expect(zoomForSpacing(0.01, 35, 512, 17)).toBe(17);
	});

	it('長すぎる間隔は 0 で止める', () => {
		expect(zoomForSpacing(1e9, 0, 512, 17)).toBe(0);
	});
});

describe('niceTicks', () => {
	it('1・2・5 の倍数で区切る', () => {
		expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100]);
		expect(niceTicks(-37, 3776, 4)).toEqual([0, 1000, 2000, 3000]);
		expect(niceTicks(0.1, 0.5, 4)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
	});
});
