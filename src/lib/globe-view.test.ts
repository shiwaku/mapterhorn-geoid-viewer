import { _GlobeViewport as GlobeViewport, WebMercatorViewport } from '@deck.gl/core';
import { describe, expect, it } from 'vitest';
import { ElevationFreeGlobeViewport, TerrainGlobeView } from './globe-view';

const viewState = { longitude: 138.73, latitude: 35.33, zoom: 9, pitch: 60, bearing: 0 };
const size = { width: 800, height: 600 };

describe('ElevationFreeGlobeViewport', () => {
	it('画面中心の地形の高さがあっても、高さ 0 のときと同じ位置に描く', () => {
		const plain = new GlobeViewport({ ...viewState, ...size });
		const withElevation = new ElevationFreeGlobeViewport({
			...viewState,
			...size,
			position: [0, 0, 20000]
		} as ConstructorParameters<typeof ElevationFreeGlobeViewport>[0]);
		const point = [138.8, 35.4, 3000];
		const [ax, ay] = plain.project(point);
		const [bx, by] = withElevation.project(point);
		expect(bx).toBeCloseTo(ax, 6);
		expect(by).toBeCloseTo(ay, 6);
	});
});

describe('TerrainGlobeView', () => {
	it('globe ではずれない視点を、ズーム 12 より先は Web メルカトルを使う', () => {
		const view = new TerrainGlobeView({ id: 'maplibre' });
		expect(view.getViewportType({ ...viewState, zoom: 9 })).toBe(ElevationFreeGlobeViewport);
		expect(view.getViewportType({ ...viewState, zoom: 13 })).toBe(WebMercatorViewport);
	});
});
