// アプリ本体 (HTML・JS・CSS・アイコン) をキャッシュして、ホーム画面から素早く起動できるようにする。
// 地図・地形・ジオイドのタイルはネットワークから読む (ジオイドタイルは約 24 MB あり、範囲リクエストで部分的に読むため)

import { version } from '$app/env';
import { assets, immutable, prerendered } from '$app/manifest';
import { self as sw } from '$app/service-worker';

const CACHE = `app-${version}`;

/** base path からの相対パスを、サービスワーカーのスコープ基準の URL にする */
const toUrl = (path: string) => new URL(path.replace(/^\//, ''), sw.registration.scope).href;

const PRECACHE = [
	...immutable.map((f) => f.path),
	...assets.map((f) => f.path).filter((p) => !p.endsWith('.pmtiles')),
	...prerendered.map((f) => f.path)
].map(toUrl);

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET' || request.headers.has('range')) return;
	const url = new URL(request.url);
	if (url.origin !== sw.location.origin) return;

	// ページはネットワークを優先し、つながらないときはキャッシュを返す
	if (request.mode === 'navigate') {
		event.respondWith(
			fetch(request).catch(async () => {
				const cached = await caches.match(request, { ignoreSearch: true });
				return cached ?? (await caches.match(sw.registration.scope)) ?? Response.error();
			})
		);
		return;
	}

	// アプリ本体はビルドごとにファイル名が変わるので、キャッシュを優先する
	if (PRECACHE.includes(url.href)) {
		event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
	}
});
