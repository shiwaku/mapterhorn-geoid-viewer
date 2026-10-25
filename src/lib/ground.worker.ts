/// <reference lib="webworker" />
// 地表面タイル (H + N) の合成をメインスレッドから外すための Worker
import { fetchEllipsoidalBlob, setGeoidUrl } from './sources';
import type { TileIndex } from './tiles';

export type GroundRequest =
	| { type: 'init'; geoidUrl: string }
	| { type: 'tile'; id: number; tile: TileIndex }
	| { type: 'cancel'; id: number };

export type GroundResponse =
	{ id: number; buffer: ArrayBuffer } | { id: number; error: string; aborted?: boolean };

const controllers = new Map<number, AbortController>();

self.onmessage = async (e: MessageEvent<GroundRequest>) => {
	const msg = e.data;
	if (msg.type === 'init') {
		setGeoidUrl(msg.geoidUrl);
		return;
	}
	if (msg.type === 'cancel') {
		controllers.get(msg.id)?.abort();
		return;
	}
	const controller = new AbortController();
	controllers.set(msg.id, controller);
	try {
		const blob = await fetchEllipsoidalBlob(msg.tile, controller.signal);
		const buffer = await blob.arrayBuffer();
		self.postMessage({ id: msg.id, buffer } satisfies GroundResponse, [buffer]);
	} catch (err) {
		const aborted = controller.signal.aborted;
		self.postMessage({ id: msg.id, error: String(err), aborted } satisfies GroundResponse);
	} finally {
		controllers.delete(msg.id);
	}
};
