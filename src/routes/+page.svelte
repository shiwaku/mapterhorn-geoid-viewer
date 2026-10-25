<script lang="ts">
	import 'maplibre-gl/dist/maplibre-gl.css';
	import {
		Map as MaplibreMap,
		NavigationControl,
		setWorkerUrl,
		type MapMouseEvent
	} from 'maplibre-gl';
	// Vite の事前バンドルでは MapLibre が自分の Worker を見つけられないので明示する
	import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
	import { initGroundWorkers } from '#lib/ground-client.js';
	import { MapboxOverlay } from '@deck.gl/mapbox';
	import { asset } from '$app/paths';
	import { createLayers, type LayerOptions } from '#lib/layers.js';
	import { queryPoint, setGeoidUrl, type PointHeights } from '#lib/sources.js';

	const geoidUrl = new URL(asset('data/egm2008.pmtiles'), location.href).href;
	setGeoidUrl(geoidUrl);
	initGroundWorkers(geoidUrl);
	setWorkerUrl(maplibreWorkerUrl);

	let options: LayerOptions = $state({
		exaggeration: 1,
		showGround: true,
		showGeoid: true,
		groundOpacity: 1,
		geoidOpacity: 0.8,
		groundTexture: true
	});

	let picked: { lng: number; lat: number; heights?: PointHeights; error?: string } | undefined =
		$state();

	let overlay: MapboxOverlay | undefined;

	function mountMap(container: HTMLDivElement) {
		const map = new MaplibreMap({
			container,
			style: {
				version: 8,
				sources: {},
				layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dfe7ef' } }]
			},
			// 駿河湾から富士山を望む位置
			center: [138.62, 35.05],
			zoom: 9,
			pitch: 65,
			bearing: 10,
			maxPitch: 85,
			attributionControl: {
				customAttribution: [
					'<a href="https://mapterhorn.com/attribution" target="_blank">© Mapterhorn</a>',
					'EGM2008: <a href="https://earth-info.nga.mil/" target="_blank">NGA</a>',
					'<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>'
				]
			}
		});
		map.addControl(new NavigationControl({ visualizePitch: true }));

		overlay = new MapboxOverlay({ interleaved: false, layers: createLayers(options) });
		map.addControl(overlay);
		// 開発時のデバッグ用
		if (import.meta.env.DEV) Object.assign(window, { __map: map, __overlay: overlay });

		map.on('click', async (e: MapMouseEvent) => {
			const { lng, lat } = e.lngLat;
			picked = { lng, lat };
			try {
				const heights = await queryPoint(lng, lat, Math.max(map.getZoom() + 1, 12));
				picked = { lng, lat, heights };
			} catch (err) {
				picked = { lng, lat, error: String(err) };
			}
		});

		return () => {
			overlay = undefined;
			map.remove();
		};
	}

	$effect(() => {
		const layers = createLayers({ ...options });
		overlay?.setProps({ layers });
	});

	const fmt = (v: number) => `${v.toFixed(2)} m`;
</script>

<svelte:head>
	<title>Mapterhorn ジオイドビューア</title>
</svelte:head>

<div class="relative h-dvh w-full">
	<!-- maplibregl-map クラスが position: relative を付けるので inset ではなく大きさで広げる -->
	<div class="h-full w-full" {@attach mountMap}></div>

	<aside
		class="absolute top-3 left-3 w-72 max-w-[calc(100%-1.5rem)] space-y-3 rounded-lg bg-white/90 p-4 text-sm shadow-lg backdrop-blur"
	>
		<h1 class="text-base font-bold">地表面とジオイド面</h1>
		<p class="text-xs text-slate-600">
			地球楕円体 (WGS 84) を高さ 0 として、地表面 (楕円体高 h = H + N) とジオイド面 (ジオイド高 N)
			を描いています。
		</p>

		<label class="block">
			<span class="flex justify-between">
				<span>高さの強調</span><span class="tabular-nums">× {options.exaggeration}</span>
			</span>
			<input
				class="w-full"
				type="range"
				min="1"
				max="50"
				step="1"
				bind:value={options.exaggeration}
			/>
		</label>

		<fieldset class="space-y-1">
			<label class="flex items-center gap-2">
				<input type="checkbox" bind:checked={options.showGround} />
				<span class="inline-block size-3 rounded-sm bg-[#d6c4a0]"></span>地表面
			</label>
			<label class="ml-5 flex items-center gap-2 text-xs">
				<input type="checkbox" bind:checked={options.groundTexture} />地図を貼る (OSM)
			</label>
			<label class="ml-5 block text-xs">
				不透明度
				<input
					class="w-full"
					type="range"
					min="0.1"
					max="1"
					step="0.05"
					bind:value={options.groundOpacity}
				/>
			</label>
		</fieldset>

		<fieldset class="space-y-1">
			<label class="flex items-center gap-2">
				<input type="checkbox" bind:checked={options.showGeoid} />
				<span class="inline-block size-3 rounded-sm bg-[#286ee6]"></span>ジオイド面 (EGM2008)
			</label>
			<label class="ml-5 block text-xs">
				不透明度
				<input
					class="w-full"
					type="range"
					min="0.1"
					max="1"
					step="0.05"
					bind:value={options.geoidOpacity}
				/>
			</label>
		</fieldset>

		<div class="border-t pt-2">
			{#if picked}
				<div class="text-xs text-slate-600 tabular-nums">
					{picked.lat.toFixed(5)}, {picked.lng.toFixed(5)}
				</div>
				{#if picked.heights}
					<dl class="grid grid-cols-[auto_1fr] gap-x-3 tabular-nums">
						<dt class="text-green-700">標高 H</dt>
						<dd class="text-right">{fmt(picked.heights.orthometric)}</dd>
						<dt class="text-blue-700">ジオイド高 N</dt>
						<dd class="text-right">{fmt(picked.heights.geoid)}</dd>
						<dt class="text-red-700">楕円体高 h</dt>
						<dd class="text-right">{fmt(picked.heights.ellipsoidal)}</dd>
					</dl>
				{:else if picked.error}
					<p class="text-xs text-red-700">{picked.error}</p>
				{:else}
					<p class="text-xs">読み込み中…</p>
				{/if}
			{:else}
				<p class="text-xs text-slate-600">地図をクリックすると H・N・h を表示します。</p>
			{/if}
		</div>

		<details class="text-xs text-slate-600">
			<summary class="cursor-pointer">注意</summary>
			<p class="mt-1">
				Mapterhorn の標高は日本では東京湾平均海面 (国土地理院 DEM)、その他の多くの地域では EGM2008
				(Copernicus GLO-30) を基準とします。ジオイド高はすべて EGM2008
				なので、日本の楕円体高には数十 cm 程度の誤差があり得ます。
			</p>
		</details>
	</aside>
</div>
