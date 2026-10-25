import { describe, expect, it } from 'vitest';
import { contourInterval, contourLevels, isolines } from './contours';

function grid(size: number, f: (i: number, j: number) => number) {
	const data = new Float32Array(size * size);
	for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) data[j * size + i] = f(i, j);
	return { size, data };
}

describe('isolines', () => {
	it('x 方向に増える面では、縦にまっすぐな 1 本の線になる', () => {
		const lines = isolines(
			grid(5, (i) => i),
			1.5
		);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toHaveLength(5);
		for (const [x] of lines[0]) expect(x).toBeCloseTo(1.5);
		expect(lines[0].map(([, y]) => y).sort()).toEqual([0, 1, 2, 3, 4]);
	});

	it('山の等値線は閉じる', () => {
		const lines = isolines(
			grid(7, (i, j) => 10 - Math.hypot(i - 3, j - 3)),
			8.5
		);
		expect(lines).toHaveLength(1);
		const line = lines[0];
		expect(line[0]).toEqual(line[line.length - 1]);
		for (const [x, y] of line.slice(0, -1)) {
			expect(Math.hypot(x - 3, y - 3)).toBeGreaterThan(1);
			expect(Math.hypot(x - 3, y - 3)).toBeLessThan(2);
		}
	});

	it('範囲外の値では線がない', () => {
		expect(
			isolines(
				grid(4, (i) => i),
				10
			)
		).toEqual([]);
	});
});

describe('contourInterval', () => {
	it('本数が多くなりすぎない間隔を選ぶ', () => {
		expect(contourInterval(25, 45)).toBe(1);
		expect(contourInterval(-106, 85)).toBe(10);
		expect(contourInterval(36, 38)).toBe(0.5);
	});
});

describe('contourLevels', () => {
	it('間隔の倍数を返す', () => {
		expect(contourLevels(-12, 21, 10)).toEqual([-10, 0, 10, 20]);
		expect(contourLevels(36.2, 37.6, 0.5)).toEqual([36.5, 37, 37.5]);
	});
});
