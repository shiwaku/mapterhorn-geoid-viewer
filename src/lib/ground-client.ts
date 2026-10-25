import type { GroundRequest, GroundResponse } from './ground.worker';
import type { TileIndex } from './tiles';

type Pending = { resolve: (b: ArrayBuffer) => void; reject: (e: Error) => void };

const workers: Worker[] = [];
const pending = new Map<number, Pending>();
let nextId = 0;

function post(worker: Worker, msg: GroundRequest) {
	worker.postMessage(msg);
}

export function initGroundWorkers(geoidUrl: string) {
	const count = Math.max(1, Math.min(4, (navigator.hardwareConcurrency ?? 2) - 1));
	for (let i = 0; i < count; i++) {
		const worker = new Worker(new URL('./ground.worker.ts', import.meta.url), { type: 'module' });
		worker.onmessage = (e: MessageEvent<GroundResponse>) => {
			const res = e.data;
			const p = pending.get(res.id);
			if (!p) return;
			pending.delete(res.id);
			if ('buffer' in res) p.resolve(res.buffer);
			else p.reject(new DOMException(res.error, res.aborted ? 'AbortError' : 'Error'));
		};
		post(worker, { type: 'init', geoidUrl });
		workers.push(worker);
	}
}

/** 楕円体高の Terrarium PNG を Worker で作る */
export function requestEllipsoidal(tile: TileIndex, signal?: AbortSignal): Promise<ArrayBuffer> {
	if (workers.length === 0) throw new Error('initGroundWorkers() が呼ばれていません');
	const id = nextId++;
	const worker = workers[id % workers.length];
	return new Promise((resolve, reject) => {
		pending.set(id, { resolve, reject });
		signal?.addEventListener('abort', () => post(worker, { type: 'cancel', id }), { once: true });
		post(worker, { type: 'tile', id, tile });
	});
}
