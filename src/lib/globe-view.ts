import { _GlobeView as GlobeView, _GlobeViewport as GlobeViewport } from '@deck.gl/core';

type GlobeViewportOptions = ConstructorParameters<typeof GlobeViewport>[0] & {
	position?: number[];
};

/**
 * 画面中心の地形の高さ (position) を無視する GlobeViewport。
 *
 * MapLibre の地形があるとき、MapLibreOverlay は画面中心の地形の高さを position: [0, 0, 高さ] で渡し、
 * deck.gl は視点の中心をその高さに持ち上げる。ところが MapLibre の globe 表示は視点の中心を
 * 楕円体面 (高さ 0) のまま描くため、deck.gl のレイヤだけが中心の地形の高さぶんずれる。
 * 地図を動かすと中心の地形の高さが変わるので、レイヤが地形の上を滑って見える。
 * (ズーム 12 より先の Web メルカトルの視点では、MapLibre も中心の高さを使うので元のままでよい)
 */
export class ElevationFreeGlobeViewport extends GlobeViewport {
	constructor(opts: GlobeViewportOptions = {}) {
		super({ ...opts, position: undefined });
	}
}

/** 地形があっても MapLibre の globe 表示とずれない GlobeView */
export class TerrainGlobeView extends GlobeView {
	getViewportType(viewState: Parameters<GlobeView['getViewportType']>[0]) {
		const type = super.getViewportType(viewState);
		return type === GlobeViewport ? ElevationFreeGlobeViewport : type;
	}
}
