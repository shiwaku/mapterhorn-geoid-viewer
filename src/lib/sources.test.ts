import { describe, expect, it } from 'vitest';
import { tilesCovering } from './sources';

describe('tilesCovering', () => {
	it('範囲を覆うタイルを返す', () => {
		const tiles = tilesCovering({ west: 138, south: 34, east: 141, north: 37 }, 6, 64);
		expect(tiles.every((t) => t.z === 6)).toBe(true);
		expect(new Set(tiles.map((t) => t.x))).toEqual(new Set([56, 57]));
	});

	it('多すぎるときはズームを下げる', () => {
		const tiles = tilesCovering({ west: -180, south: -85, east: 180, north: 85 }, 6, 64);
		expect(tiles.length).toBeLessThanOrEqual(64);
		expect(tiles[0].z).toBe(3);
	});

	it('日付変更線をまたぐ範囲は両側のタイルを含む', () => {
		const tiles = tilesCovering({ west: 170, south: -10, east: 190, north: 10 }, 3, 64);
		expect(new Set(tiles.map((t) => t.x))).toEqual(new Set([7, 0]));
	});
});
