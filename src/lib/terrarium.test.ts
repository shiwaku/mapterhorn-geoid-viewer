import { describe, expect, it } from 'vitest';
import { heightToTerrarium, terrariumDecoder, terrariumToHeight } from './terrarium';

describe('Terrarium', () => {
	it.each([0, 1, -1, 3776.24, -10994.5, 36.71875])('%d m を往復しても 1/256 m 以内', (h) => {
		const [r, g, b] = heightToTerrarium(h);
		expect(Math.abs(terrariumToHeight(r, g, b) - h)).toBeLessThanOrEqual(1 / 512);
	});

	it('0 m は (128, 0, 0)', () => {
		expect(heightToTerrarium(0)).toEqual([128, 0, 0]);
	});

	it('デコーダは強調倍率を掛けた高さを返す', () => {
		const d = terrariumDecoder(10);
		const [r, g, b] = heightToTerrarium(36.5);
		expect(r * d.rScaler + g * d.gScaler + b * d.bScaler + d.offset).toBeCloseTo(365, 6);
	});
});
