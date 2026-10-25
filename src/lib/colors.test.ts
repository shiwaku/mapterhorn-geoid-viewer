import { describe, expect, it } from 'vitest';
import { GEOID_COLOR_STOPS, colorAt, geoidColor, stretchedStops } from './colors';

describe('geoidColor', () => {
	it('段彩の節点ではその色になる', () => {
		for (const [v, c] of GEOID_COLOR_STOPS) expect(geoidColor(v)).toEqual(c);
	});

	it('節点の間は線形に補間する', () => {
		expect(geoidColor(20)).toEqual([243, 192.5, 172.5]);
	});

	it('範囲外は端の色になる', () => {
		expect(geoidColor(-500)).toEqual(GEOID_COLOR_STOPS[0][1]);
		expect(geoidColor(500)).toEqual(GEOID_COLOR_STOPS[GEOID_COLOR_STOPS.length - 1][1]);
	});
});

describe('stretchedStops', () => {
	it('両端が min と max になる', () => {
		const stops = stretchedStops(25, 45);
		expect(stops[0][0]).toBe(25);
		expect(stops[stops.length - 1][0]).toBe(45);
		expect(colorAt(stops, 25)).toEqual(stops[0][1]);
		expect(colorAt(stops, 45)).toEqual(stops[stops.length - 1][1]);
	});
});
