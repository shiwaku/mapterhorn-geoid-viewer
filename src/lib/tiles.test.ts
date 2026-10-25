import { describe, expect, it } from 'vitest';
import {
	ancestorTile,
	fillTemplate,
	lngLatToTile,
	resampleFromAncestor,
	sampleCornersFromAncestor,
	tileToLngLat
} from './tiles';

/** 値が x 方向に 1 ずつ増えるグリッド */
function rampGrid(size: number) {
	const data = new Float32Array(size * size);
	for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) data[j * size + i] = i;
	return { size, data };
}

describe('ancestorTile', () => {
	it('maxZoom 以下ならそのまま', () => {
		expect(ancestorTile({ z: 3, x: 5, y: 2 }, 4)).toEqual({ z: 3, x: 5, y: 2 });
	});

	it('maxZoom を超えたら祖先を返す', () => {
		expect(ancestorTile({ z: 7, x: 115, y: 50 }, 4)).toEqual({ z: 4, x: 14, y: 6 });
	});
});

describe('resampleFromAncestor', () => {
	it('同じタイル・同じサイズなら元の値になる', () => {
		const src = rampGrid(8);
		const tile = { z: 4, x: 1, y: 1 };
		expect(Array.from(resampleFromAncestor(src, tile, tile, 8).data)).toEqual(Array.from(src.data));
	});

	it('子タイルは祖先の該当範囲を線形に補間する', () => {
		const src = rampGrid(8);
		// z+1 の右上の子 (x = 1) は祖先の x = 4..8 の範囲
		const out = resampleFromAncestor(src, { z: 0, x: 0, y: 0 }, { z: 1, x: 1, y: 0 }, 4);
		// 子のピクセル中心 i + 0.5 は祖先の 4 + (i + 0.5) - 0.5 = 4 + i
		expect(Array.from(out.data.slice(0, 4))).toEqual([4, 5, 6, 7]);
	});

	it('端は外挿せず端の値で止める', () => {
		const src = rampGrid(4);
		const out = resampleFromAncestor(src, { z: 0, x: 0, y: 0 }, { z: 2, x: 3, y: 0 }, 4);
		expect(Math.max(...out.data)).toBeLessThanOrEqual(3);
	});
});

describe('lngLatToTile', () => {
	it('原点はズーム 1 で (1, 1) の左上', () => {
		const { tile, u, v } = lngLatToTile(0, 0, 1);
		expect(tile).toEqual({ z: 1, x: 1, y: 1 });
		expect(u).toBeCloseTo(0);
		expect(v).toBeCloseTo(0);
	});

	it('富士山頂はズーム 10 で 906/404', () => {
		expect(lngLatToTile(138.7274, 35.3606, 10).tile).toEqual({ z: 10, x: 906, y: 404 });
	});

	it('東端の 180 度はタイル範囲内に収める', () => {
		expect(lngLatToTile(180, 0, 2).tile.x).toBe(3);
	});
});

describe('fillTemplate', () => {
	it('z/x/y を置換する', () => {
		expect(fillTemplate('https://a/{z}/{x}/{y}.webp', { z: 1, x: 2, y: 3 })).toBe(
			'https://a/1/2/3.webp'
		);
	});
});

describe('sampleCornersFromAncestor', () => {
	it('隣り合う子タイルの境界の格子点は同じ値になる', () => {
		const src = rampGrid(8);
		const ancestor = { z: 4, x: 1, y: 1 };
		const left = sampleCornersFromAncestor(src, ancestor, { z: 5, x: 2, y: 2 }, 4);
		const right = sampleCornersFromAncestor(src, ancestor, { z: 5, x: 3, y: 2 }, 4);
		expect(left.size).toBe(5);
		expect(left.data[4]).toBeCloseTo(right.data[0]);
		expect(left.data[4]).toBeCloseTo(3.5);
	});
});

describe('tileToLngLat', () => {
	it('lngLatToTile の逆になる', () => {
		const { tile, u, v } = lngLatToTile(138.7274, 35.3606, 10);
		const [lng, lat] = tileToLngLat(10, tile.x + u, tile.y + v);
		expect(lng).toBeCloseTo(138.7274, 6);
		expect(lat).toBeCloseTo(35.3606, 6);
	});
});
