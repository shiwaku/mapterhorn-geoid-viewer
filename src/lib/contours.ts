/** 格子から等値線を作る (マーチングスクエア法) */

import type { HeightGrid } from './terrarium';

/** 格子座標 [x, y] の折れ線 */
export type Polyline = [number, number][];

// 辺の番号: 横の辺 (i,j)-(i+1,j) は j*size+i、縦の辺 (i,j)-(i,j+1) は size*size + j*size+i
type Side = 'top' | 'right' | 'bottom' | 'left';

/**
 * 格子の 4 隅の高低 (左上 8・右上 4・右下 2・左下 1) ごとに、等値線が横切る辺の組。
 * 鞍点 (5 と 10) はセルの中心の値で分け方を決める
 */
const CASES: Record<number, [Side, Side][]> = {
	1: [['left', 'bottom']],
	2: [['bottom', 'right']],
	3: [['left', 'right']],
	4: [['top', 'right']],
	6: [['top', 'bottom']],
	7: [['top', 'left']],
	8: [['top', 'left']],
	9: [['top', 'bottom']],
	11: [['top', 'right']],
	12: [['left', 'right']],
	13: [['bottom', 'right']],
	14: [['left', 'bottom']]
};

/** 値が level の等値線。格子の端で切れた線と、閉じた線 (始点と終点が同じ) を返す */
export function isolines({ size, data }: HeightGrid, level: number): Polyline[] {
	const at = (i: number, j: number) => data[j * size + i];
	const edgeId = (i: number, j: number, side: Side) => {
		switch (side) {
			case 'top':
				return j * size + i;
			case 'bottom':
				return (j + 1) * size + i;
			case 'left':
				return size * size + j * size + i;
			case 'right':
				return size * size + j * size + i + 1;
		}
	};
	const points = new Map<number, [number, number]>();
	const pointOn = (i: number, j: number, side: Side): number => {
		const id = edgeId(i, j, side);
		if (!points.has(id)) {
			const horizontal = side === 'top' || side === 'bottom';
			const [i0, j0] = side === 'bottom' ? [i, j + 1] : side === 'right' ? [i + 1, j] : [i, j];
			const [i1, j1] = horizontal ? [i0 + 1, j0] : [i0, j0 + 1];
			const v0 = at(i0, j0);
			const v1 = at(i1, j1);
			const t = v1 === v0 ? 0.5 : (level - v0) / (v1 - v0);
			points.set(id, horizontal ? [i0 + t, j0] : [i0, j0 + t]);
		}
		return id;
	};

	// 辺の点どうしのつながり。1 つの点には隣り合う 2 つのセルから最大 2 本の線分がつながる
	const links = new Map<number, number[]>();
	const link = (a: number, b: number) => {
		links.set(a, [...(links.get(a) ?? []), b]);
		links.set(b, [...(links.get(b) ?? []), a]);
	};

	for (let j = 0; j < size - 1; j++) {
		for (let i = 0; i < size - 1; i++) {
			const tl = at(i, j);
			const tr = at(i + 1, j);
			const br = at(i + 1, j + 1);
			const bl = at(i, j + 1);
			const c =
				(tl >= level ? 8 : 0) |
				(tr >= level ? 4 : 0) |
				(br >= level ? 2 : 0) |
				(bl >= level ? 1 : 0);
			let pairs = CASES[c];
			if (c === 5 || c === 10) {
				const centerHigh = (tl + tr + br + bl) / 4 >= level;
				// 中心が高ければ高い隅どうしがつながり、低い隅が切り離される (低ければその逆)
				const cutTopLeftAndBottomRight = (c === 5) === centerHigh;
				pairs = cutTopLeftAndBottomRight
					? [
							['top', 'left'],
							['bottom', 'right']
						]
					: [
							['top', 'right'],
							['left', 'bottom']
						];
			}
			for (const [a, b] of pairs ?? []) link(pointOn(i, j, a), pointOn(i, j, b));
		}
	}

	const lines: Polyline[] = [];
	const visited = new Set<number>();
	const walk = (start: number) => {
		const ids = [start];
		visited.add(start);
		let prev = -1;
		let current = start;
		for (;;) {
			const next = (links.get(current) ?? []).find((n) => n !== prev && !visited.has(n));
			if (next === undefined) {
				// 閉じた線は始点に戻して閉じる
				if (ids.length > 2 && links.get(current)?.includes(start)) ids.push(start);
				break;
			}
			visited.add(next);
			ids.push(next);
			prev = current;
			current = next;
		}
		if (ids.length > 1) lines.push(ids.map((id) => points.get(id)!));
	};
	// 先に端で切れた線 (つながりが 1 本の点から始まる) をたどり、残りは閉じた線
	for (const [id, to] of links) if (to.length === 1 && !visited.has(id)) walk(id);
	for (const id of links.keys()) if (!visited.has(id)) walk(id);
	return lines;
}

/** min〜max の値を等値線にするときの間隔。本数が maxLines 本以下になるきりのよい値 */
export function contourInterval(min: number, max: number, maxLines = 20): number {
	const steps = [0.5, 1, 2, 5, 10, 20, 50, 100];
	return steps.find((s) => (max - min) / s <= maxLines) ?? steps[steps.length - 1];
}

/** min〜max にある、interval の倍数の値 */
export function contourLevels(min: number, max: number, interval: number): number[] {
	const levels: number[] = [];
	for (let v = Math.ceil(min / interval) * interval; v <= max; v += interval) {
		levels.push(Number(v.toPrecision(12)));
	}
	return levels;
}
