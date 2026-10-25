<script lang="ts">
	import 'maplibre-gl/dist/maplibre-gl.css';
	import {
		Map as MaplibreMap,
		NavigationControl,
		addProtocol,
		setWorkerUrl,
		type MapMouseEvent,
		type RasterDEMSourceSpecification
	} from 'maplibre-gl';
	// Vite の事前バンドルでは MapLibre が自分の Worker を見つけられないので明示する
	import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
	import { MapLibreOverlay } from '@deck.gl/maplibre';
	import { asset } from '$app/paths';
	import { initGroundWorkers, requestEllipsoidal } from '#lib/ground-client.js';
	import { GEOID_COLOR_STOPS } from '#lib/colors.js';
	import { createGeoidLayer } from '#lib/layers.js';
	import { MAPTERHORN_MAX_ZOOM, queryPoint, setGeoidUrl, type PointHeights } from '#lib/sources.js';

	/** OpenMapTiles スキーマのベクトルタイル (OpenFreeMap、API キー不要) */
	const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

	const geoidUrl = new URL(asset('data/egm2008.pmtiles'), location.href).href;
	setGeoidUrl(geoidUrl);
	initGroundWorkers(geoidUrl);
	setWorkerUrl(maplibreWorkerUrl);

	// 地表面の地形には楕円体高 h = H + N を Worker で合成して渡す
	addProtocol('ellipsoid', async ({ url }, controller) => {
		const [z, x, y] = url.replace('ellipsoid://', '').split('/').map(Number);
		return { data: await requestEllipsoidal({ z, x, y }, controller.signal) };
	});

	let options = $state({
		exaggeration: 1,
		// ジオイドだけを見るときの強調は 10 の何乗か (1〜10,000 倍)
		geoidExaggerationLog: 3,
		showGround: true,
		showGeoid: true,
		geoidOpacity: 0.4
	});

	let picked: { lng: number; lat: number; heights?: PointHeights; error?: string } | undefined =
		$state();

	let map: MaplibreMap | undefined = $state();
	let overlay: MapLibreOverlay | undefined;

	function onStyleLoad(m: MaplibreMap) {
		m.setProjection({ type: 'globe' });
		m.setSky({
			'sky-color': '#7fb6e8',
			'horizon-color': '#e6f0fa',
			'sky-horizon-blend': 0.6,
			'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 7, 0]
		});
		const dem: RasterDEMSourceSpecification = {
			type: 'raster-dem',
			tiles: ['ellipsoid://{z}/{x}/{y}'],
			encoding: 'terrarium',
			tileSize: 512,
			maxzoom: MAPTERHORN_MAX_ZOOM
		};
		// 地形と陰影は別のソースにする (MapLibre の推奨)
		m.addSource('ground', dem);
		m.addSource('hillshade', dem);
		const firstSymbol = m.getStyle().layers.find((l) => l.type === 'symbol')?.id;
		m.addLayer(
			{
				id: 'hillshade',
				type: 'hillshade',
				source: 'hillshade',
				paint: { 'hillshade-exaggeration': 0.4, 'hillshade-shadow-color': '#3d4a5c' }
			},
			firstSymbol
		);
		// 地名は日本語を優先する
		for (const layer of m.getStyle().layers) {
			if (layer.type === 'symbol' && layer.layout?.['text-field']) {
				m.setLayoutProperty(layer.id, 'text-field', [
					'coalesce',
					['get', 'name:ja'],
					['get', 'name']
				]);
			}
		}
		map = m;
	}

	function mountMap(container: HTMLDivElement) {
		const m = new MaplibreMap({
			container,
			style: BASEMAP_STYLE,
			// 駿河湾から富士山を望む位置
			center: [138.62, 35.05],
			zoom: 9,
			pitch: 65,
			bearing: 10,
			maxPitch: 85,
			attributionControl: {
				customAttribution: [
					'<a href="https://mapterhorn.com/attribution" target="_blank">© Mapterhorn</a>',
					'EGM2008: <a href="https://earth-info.nga.mil/" target="_blank">NGA</a>'
				]
			}
		});
		m.addControl(new NavigationControl({ visualizePitch: true }));
		m.once('style.load', () => onStyleLoad(m));

		// 地表面の地形と前後関係を正しく描くため、MapLibre の描画に組み込む
		overlay = new MapLibreOverlay({ interleaved: true, layers: [] });
		m.addControl(overlay);
		// 開発時のデバッグ用
		if (import.meta.env.DEV) Object.assign(window, { __map: m, __overlay: overlay });

		m.on('click', async (e: MapMouseEvent) => {
			const { lng, lat } = e.lngLat;
			picked = { lng, lat };
			try {
				const heights = await queryPoint(lng, lat, Math.max(m.getZoom() + 1, 12));
				picked = { lng, lat, heights };
			} catch (err) {
				picked = { lng, lat, error: String(err) };
			}
		});

		return () => {
			overlay = undefined;
			map = undefined;
			m.remove();
		};
	}

	$effect(() => {
		const { showGround, exaggeration } = options;
		map?.setTerrain(showGround ? { source: 'ground', exaggeration } : null);
	});

	// 地表面がないときは、ジオイドの起伏を地球全体でも見えるよう大きく強調できる
	const geoidExaggeration = $derived(
		options.showGround ? options.exaggeration : Math.round(10 ** options.geoidExaggerationLog)
	);

	$effect(() => {
		const layer = createGeoidLayer({
			exaggeration: geoidExaggeration,
			visible: options.showGeoid,
			opacity: options.geoidOpacity,
			solid: !options.showGround
		});
		overlay?.setProps({ layers: [layer] });
	});

	const fmt = (v: number) => `${v.toFixed(2)} m`;
	const legendMin = GEOID_COLOR_STOPS[0][0];
	const legendMax = GEOID_COLOR_STOPS[GEOID_COLOR_STOPS.length - 1][0];
	const legendGradient = `linear-gradient(to right, ${GEOID_COLOR_STOPS.map(
		([v, [r, g, b]]) => `rgb(${r} ${g} ${b}) ${((v - legendMin) / (legendMax - legendMin)) * 100}%`
	).join(', ')})`;
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
			を描いています。地球全体を見るときは、高さを強調しないとジオイドの起伏 (±100 m 程度)
			は見えません。
		</p>

		<!-- 地表面がないときは、ジオイド面の欄の強調を使う -->
		<label class="block" class:opacity-40={!options.showGround}>
			<span class="flex justify-between">
				<span>高さの強調</span><span class="tabular-nums">× {options.exaggeration}</span>
			</span>
			<input
				class="w-full"
				type="range"
				min="1"
				max="50"
				step="1"
				disabled={!options.showGround}
				bind:value={options.exaggeration}
			/>
		</label>

		<fieldset class="space-y-1">
			<label class="flex items-center gap-2">
				<input type="checkbox" bind:checked={options.showGround} />地表面 (地形)
			</label>
			<p class="ml-5 text-xs text-slate-600">
				オフにすると、背景地図は楕円体面 (高さ 0) に貼られます。
			</p>
		</fieldset>

		<fieldset class="space-y-1">
			<label class="flex items-center gap-2">
				<input type="checkbox" bind:checked={options.showGeoid} />
				ジオイド面 (EGM2008)
			</label>
			<div class="ml-5 text-xs">
				<div class="h-2 rounded-sm" style:background={legendGradient}></div>
				<div class="flex justify-between text-slate-600 tabular-nums">
					<span>{legendMin} m</span><span>0</span><span>+{legendMax} m</span>
				</div>
			</div>
			{#if !options.showGround}
				<label class="ml-5 block text-xs">
					<span class="flex justify-between">
						<span>起伏の強調</span>
						<span class="tabular-nums">× {geoidExaggeration.toLocaleString()}</span>
					</span>
					<input
						class="w-full"
						type="range"
						min="0"
						max="4"
						step="0.1"
						bind:value={options.geoidExaggerationLog}
					/>
					<span class="text-slate-600">
						N がプラスの所は楕円体面 (背景地図) より上に、マイナスの所は下に出ます。
					</span>
				</label>
			{/if}
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
