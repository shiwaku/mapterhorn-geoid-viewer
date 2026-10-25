<script lang="ts">
	import 'maplibre-gl/dist/maplibre-gl.css';
	import {
		Map as MaplibreMap,
		Marker,
		NavigationControl,
		addProtocol,
		setWorkerUrl,
		type GeoJSONSource,
		type MapMouseEvent,
		type RasterDEMSourceSpecification
	} from 'maplibre-gl';
	// Vite の事前バンドルでは MapLibre が自分の Worker を見つけられないので明示する
	import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
	import { MapLibreOverlay, type MapLibreOverlayProps } from '@deck.gl/maplibre';
	import { TerrainGlobeView } from '#lib/globe-view.js';
	import { asset } from '$app/paths';
	import { initGroundWorkers, requestEllipsoidal } from '#lib/ground-client.js';
	import { GEOID_COLOR_STOPS, cssGradient, stretchedStops } from '#lib/colors.js';
	import {
		createContourLayer,
		createGeoidLayer,
		createProfileWallLayers,
		CURSOR_COLOR,
		WATER_COLOR
	} from '#lib/layers.js';
	import {
		MAPTERHORN_MAX_ZOOM,
		geoidView,
		queryPoint,
		queryProfile,
		setGeoidUrl,
		type GeoidView,
		type PointHeights,
		type Profile
	} from '#lib/sources.js';
	import { greatCirclePoints, type LngLat } from '#lib/profile.js';
	import ProfileChart from '#lib/ProfileChart.svelte';

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

	// スマホなど狭い画面では、地図を広く見せるため閉じて始める
	let panelOpen = $state(matchMedia('(min-width: 768px)').matches);

	let options = $state({
		exaggeration: 1,
		// ジオイドだけを見るときの強調は 10 の何乗か (1〜10,000 倍)
		geoidExaggerationLog: 3,
		showGround: true,
		showGeoid: true,
		geoidOpacity: 0.4,
		/** color: ジオイド高で色分け、water: 水面として描く */
		geoidStyle: 'color' as 'color' | 'water',
		/** 色分けの範囲を、いま見えている範囲のジオイド高に合わせる */
		autoColorRange: true,
		/** 水面をジオイドから何 m 上げるか */
		waterLevel: 0,
		showContours: true,
		/** 断面の線に沿って地図に壁を立てる */
		showWall: true
	});

	/** いま見えている範囲のジオイド高の範囲と等ジオイド高線 */
	let view: GeoidView | undefined = $state.raw();
	let viewRequest = 0;

	/** 画面上に格子状に取った、地表に当たる地点 (空の部分は除く) */
	function visiblePoints(m: MaplibreMap): LngLat[] {
		const { width, height } = m.getCanvas().getBoundingClientRect();
		const points: LngLat[] = [];
		for (let j = 0; j <= 10; j++) {
			for (let i = 0; i <= 10; i++) {
				const x = (width * i) / 10;
				const y = (height * j) / 10;
				const lngLat = m.unproject([x, y]);
				// 空の部分は地平線の点が返るので、画面に戻して位置がずれる点を除く
				const back = m.project(lngLat);
				if (Math.hypot(back.x - x, back.y - y) < 2) points.push([lngLat.lng, lngLat.lat]);
			}
		}
		return points;
	}

	async function updateView(m: MaplibreMap) {
		const request = ++viewRequest;
		const b = m.getBounds();
		const result = await geoidView(
			{ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
			m.getZoom(),
			visiblePoints(m)
		);
		// 先に始めた計算が後から終わっても上書きしない
		if (request === viewRequest) view = result;
	}

	let picked: { lng: number; lat: number; heights?: PointHeights; error?: string } | undefined =
		$state();

	let map: MaplibreMap | undefined = $state();
	let overlay: MapLibreOverlay | undefined;

	// 断面: 地図で 2 点をクリックして選ぶ
	let profileMode = $state(false);
	let profileEnds: LngLat[] = $state([]);
	let profile: Profile | undefined = $state();
	let profileError: string | undefined = $state();
	let profileHover: number | undefined = $state();

	function startProfile() {
		profileMode = true;
		profileEnds = [];
	}

	function clearProfile() {
		profileMode = false;
		profileEnds = [];
	}

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
		// 等ジオイド高線 (地表面があるときは地形に沿わせる)
		// 背景地図のスタイルにあるフォントを使う
		const textFont = m
			.getStyle()
			.layers.flatMap((l) =>
				l.type === 'symbol' && l.layout?.['text-font'] ? [l.layout] : []
			)[0]?.['text-font'];
		m.addSource('geoid-contours', { type: 'geojson', data: emptyCollection });
		// 重ね順: 背景地図 → ジオイド面 (deck.gl) → 等値線 → 地名 → 等値線のラベル
		m.addLayer(
			{
				id: 'geoid-contours',
				type: 'line',
				source: 'geoid-contours',
				paint: {
					'line-color': '#172554',
					'line-opacity': 0.9,
					'line-width': ['case', ['get', 'major'], 2.4, 1.2]
				}
			},
			firstSymbol
		);
		m.addLayer({
			id: 'geoid-contour-labels',
			type: 'symbol',
			source: 'geoid-contours',
			layout: {
				'symbol-placement': 'line',
				'symbol-spacing': 350,
				'text-field': ['concat', ['to-string', ['get', 'n']], ' m'],
				'text-size': ['case', ['get', 'major'], 13, 11],
				...(textFont ? { 'text-font': textFont } : {})
			},
			paint: {
				'text-color': '#172554',
				'text-halo-color': '#ffffff',
				'text-halo-width': 1.5
			}
		});
		// 断面の線と、断面図のカーソル位置
		m.addSource('profile-line', { type: 'geojson', data: emptyCollection });
		m.addSource('profile-cursor', { type: 'geojson', data: emptyCollection });
		m.addLayer({
			id: 'profile-line-casing',
			type: 'line',
			source: 'profile-line',
			layout: { 'line-cap': 'round', 'line-join': 'round' },
			paint: { 'line-color': '#ffffff', 'line-width': 6 }
		});
		m.addLayer({
			id: 'profile-line',
			type: 'line',
			source: 'profile-line',
			layout: { 'line-cap': 'round', 'line-join': 'round' },
			paint: { 'line-color': PROFILE_COLOR, 'line-width': 2.5 }
		});
		m.addLayer({
			id: 'profile-cursor',
			type: 'circle',
			source: 'profile-cursor',
			paint: {
				'circle-radius': 6,
				'circle-color': PROFILE_COLOR,
				'circle-stroke-color': '#ffffff',
				'circle-stroke-width': 2
			}
		});
		map = m;
		void updateView(m);
	}

	const emptyCollection: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
	/** 断面の線・端点・カーソルの色。データの色 (地表のオレンジ・ジオイドの青) と分ける */
	const PROFILE_COLOR = `rgb(${CURSOR_COLOR.join(' ')})`;

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
		m.on('moveend', () => {
			if (map) void updateView(m);
		});

		// 地表面の地形と前後関係を正しく描くため、MapLibre の描画に組み込む
		overlay = new MapLibreOverlay({
			interleaved: true,
			layers: [],
			// 地形があるときに deck.gl のレイヤが地図を動かすとずれないよう、地形の高さを真上向きに扱う
			// MapLibreOverlayProps の views は型が null に固定されているが、実行時は id が maplibre のビューを使う
			views: new TerrainGlobeView({ id: 'maplibre' }) as unknown as MapLibreOverlayProps['views']
		});
		m.addControl(overlay);
		// 開発時のデバッグ用
		if (import.meta.env.DEV) {
			Object.assign(window, {
				__map: m,
				__overlay: overlay,
				__options: options,
				__setProfile: (a: LngLat, b: LngLat) => (profileEnds = [a, b])
			});
		}

		m.on('click', async (e: MapMouseEvent) => {
			const { lng, lat } = e.lngLat;
			if (profileMode) {
				profileEnds = [...profileEnds, [lng, lat]];
				if (profileEnds.length === 2) profileMode = false;
				return;
			}
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
		if (map) map.getCanvas().style.cursor = profileMode ? 'crosshair' : '';
	});

	// 端点はドラッグで動かせる
	$effect(() => {
		if (!map) return;
		const m = map;
		const markers = profileEnds.map((p, i) => {
			const marker = new Marker({ color: PROFILE_COLOR, draggable: true, scale: 0.7 })
				.setLngLat([p[0], p[1]])
				.addTo(m);
			marker.on('dragend', () => {
				const { lng, lat } = marker.getLngLat();
				profileEnds[i] = [lng, lat];
			});
			return marker;
		});
		return () => markers.forEach((marker) => marker.remove());
	});

	$effect(() => {
		const source = map?.getSource<GeoJSONSource>('profile-line');
		if (!source) return;
		const [a, b] = profileEnds;
		source.setData(
			a && b
				? {
						type: 'Feature',
						properties: {},
						geometry: { type: 'LineString', coordinates: greatCirclePoints(a, b, 128) }
					}
				: emptyCollection
		);
	});

	$effect(() => {
		const [a, b] = profileEnds;
		profileHover = undefined;
		profileError = undefined;
		if (!a || !b) {
			profile = undefined;
			return;
		}
		const controller = new AbortController();
		const ends: [LngLat, LngLat] = [
			[a[0], a[1]],
			[b[0], b[1]]
		];
		queryProfile(...ends, 512, controller.signal).then(
			(p) => (profile = p),
			(err) => {
				if (!controller.signal.aborted) profileError = String(err);
			}
		);
		return () => controller.abort();
	});

	$effect(() => {
		const source = map?.getSource<GeoJSONSource>('profile-cursor');
		if (!source) return;
		// 壁を立てているときは、カーソルは壁の上に出すので地面の点は出さない
		const wallShown = options.showWall && options.showGround;
		const s = profileHover === undefined || wallShown ? undefined : profile?.samples[profileHover];
		source.setData(s ? { type: 'Point', coordinates: s.lngLat } : emptyCollection);
	});

	$effect(() => {
		const { showGround, exaggeration } = options;
		map?.setTerrain(showGround ? { source: 'ground', exaggeration } : null);
	});

	// 地表面がないときは、ジオイドの起伏を地球全体でも見えるよう大きく強調できる
	const geoidExaggeration = $derived(
		options.showGround ? options.exaggeration : Math.round(10 ** options.geoidExaggerationLog)
	);

	// 色分けの範囲。等値線の間隔で丸めて、少し動かしただけでは変わらないようにする
	const colorStops = $derived.by(() => {
		if (!options.autoColorRange || !view) return GEOID_COLOR_STOPS;
		const { min, max, interval } = view;
		const lo = Math.floor(min / interval) * interval;
		const hi = Math.ceil(max / interval) * interval;
		return stretchedStops(lo, hi > lo ? hi : lo + interval);
	});

	$effect(() => {
		const layers = [
			createGeoidLayer({
				exaggeration: geoidExaggeration,
				visible: options.showGeoid,
				opacity: options.geoidOpacity,
				solid: !options.showGround,
				style: options.geoidStyle,
				colorStops,
				waterLevel: options.waterLevel
			}),
			// 地表面がないときは、立体のジオイド面の上に等値線を描く
			...(view
				? [
						createContourLayer(
							view.contours,
							geoidExaggeration,
							options.showContours && !options.showGround
						)
					]
				: []),
			// 壁は地形と同じ強調で、地形の上に立てる
			...(profile && options.showWall && options.showGround
				? createProfileWallLayers(profile, options.exaggeration, profileHover)
				: [])
		];
		overlay?.setProps({ layers });
	});

	$effect(() => {
		if (!map) return;
		const visibility = options.showContours && options.showGround ? 'visible' : 'none';
		for (const id of ['geoid-contours', 'geoid-contour-labels']) {
			map.setLayoutProperty(id, 'visibility', visibility);
		}
		map.getSource<GeoJSONSource>('geoid-contours')?.setData(view?.contours ?? emptyCollection);
	});

	const fmt = (v: number) => `${v.toFixed(2)} m`;
	const fmtLegend = (v: number) => `${v > 0 ? '+' : ''}${Number(v.toPrecision(6))} m`;
	const legendGradient = $derived(cssGradient(colorStops));
	const waterCss = `rgb(${WATER_COLOR.join(' ')})`;
	const GEOID_STYLES = [
		['color', 'ジオイド高で色分け'],
		['water', '水面']
	] as const;
</script>

<svelte:head>
	<title>Mapterhorn ジオイドビューア</title>
</svelte:head>

<div class="relative h-dvh w-full">
	<!-- maplibregl-map クラスが position: relative を付けるので inset ではなく大きさで広げる -->
	<div class="h-full w-full" {@attach mountMap}></div>

	<aside
		class={[
			'absolute top-[max(0.75rem,env(safe-area-inset-top))] left-[max(0.75rem,env(safe-area-inset-left))] max-w-[calc(100%-1.5rem)] rounded-lg bg-white/90 text-sm shadow-lg backdrop-blur',
			panelOpen ? 'max-h-[calc(100%-1.5rem)] w-72 overflow-y-auto p-4' : 'px-3 py-2'
		]}
	>
		<div class="flex items-center justify-between gap-3">
			<h1 class="text-base font-bold">地表面とジオイド面</h1>
			<button
				type="button"
				class="rounded px-1.5 text-slate-600 hover:bg-slate-200"
				aria-expanded={panelOpen}
				aria-label={panelOpen ? 'パネルを閉じる' : 'パネルを開く'}
				title={panelOpen ? 'パネルを閉じる' : 'パネルを開く'}
				onclick={() => (panelOpen = !panelOpen)}
			>
				{panelOpen ? '−' : '+'}
			</button>
		</div>
		{#if panelOpen}
			<div class="mt-3 space-y-3">
				<p class="text-xs text-slate-600">
					地球楕円体 (WGS 84) を高さ 0 として、地表面 (楕円体高 h = H + N) とジオイド面 (ジオイド高
					N) を描いています。地球全体を見るときは、高さを強調しないとジオイドの起伏 (±100 m 程度)
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
					<div class="ml-5 flex overflow-hidden rounded border text-xs">
						{#each GEOID_STYLES as [value, label] (value)}
							<button
								type="button"
								class={[
									'flex-1 py-0.5',
									options.geoidStyle === value ? 'bg-slate-700 text-white' : 'hover:bg-slate-100'
								]}
								onclick={() => (options.geoidStyle = value)}
							>
								{label}
							</button>
						{/each}
					</div>
					{#if options.geoidStyle === 'color'}
						<div class="ml-5 text-xs">
							<div class="h-2 rounded-sm" style:background={legendGradient}></div>
							<div class="flex justify-between text-slate-600 tabular-nums">
								<span>{fmtLegend(colorStops[0][0])}</span>
								<span>{fmtLegend(colorStops[colorStops.length - 1][0])}</span>
							</div>
							<label class="mt-1 flex items-center gap-2">
								<input type="checkbox" bind:checked={options.autoColorRange} />
								色の範囲を表示範囲に合わせる
							</label>
						</div>
					{:else}
						<label class="ml-5 block text-xs">
							<span class="flex justify-between">
								<span class="flex items-center gap-1">
									<span class="inline-block h-2 w-3 rounded-sm" style:background={waterCss}></span>
									水面の高さ
								</span>
								<span class="tabular-nums">ジオイド + {options.waterLevel} m</span>
							</span>
							<input
								class="w-full"
								type="range"
								min="0"
								max="200"
								step="1"
								bind:value={options.waterLevel}
							/>
							<span class="text-slate-600">
								海面はジオイドに沿います。水面を上げると、低い土地から沈みます。
							</span>
						</label>
					{/if}
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

				<fieldset class="space-y-1">
					<label class="flex items-center gap-2">
						<input type="checkbox" bind:checked={options.showContours} />
						等ジオイド高線
						{#if view}
							<span class="text-xs text-slate-600 tabular-nums">({view.interval} m 間隔)</span>
						{/if}
					</label>
					<p class="ml-5 text-xs text-slate-600">
						太線は {view ? view.interval * 5 : '-'} m ごと。間隔は表示範囲に合わせて変わります。
					</p>
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

				<div class="space-y-1 border-t pt-2">
					<div class="flex items-center justify-between">
						<span class="font-bold">断面</span>
						<span class="flex gap-1">
							<button
								type="button"
								class="rounded bg-slate-800 px-2 py-0.5 text-xs text-white hover:bg-slate-700"
								onclick={startProfile}
							>
								{profileEnds.length ? '引き直す' : '線を引く'}
							</button>
							{#if profileMode || profileEnds.length}
								<button
									type="button"
									class="rounded border px-2 py-0.5 text-xs hover:bg-slate-100"
									onclick={clearProfile}
								>
									{profileMode && !profileEnds.length ? 'やめる' : '消す'}
								</button>
							{/if}
						</span>
					</div>
					<p class="text-xs text-slate-600">
						{#if profileMode}
							地図で{profileEnds.length ? '終点' : '始点'}をクリックしてください。
						{:else if profileEnds.length === 2}
							端点はドラッグで動かせます。
						{:else}
							2 点を結ぶ線に沿って、地表・ジオイド・地球楕円体の断面を描きます。
						{/if}
					</p>
					{#if profileEnds.length === 2}
						<label class="flex items-center gap-2 text-xs" class:opacity-40={!options.showGround}>
							<input
								type="checkbox"
								disabled={!options.showGround}
								bind:checked={options.showWall}
							/>
							地図に断面の壁を立てる (地表面があるとき)
						</label>
					{/if}
				</div>

				<details class="text-xs text-slate-600">
					<summary class="cursor-pointer">注意</summary>
					<p class="mt-1">
						Mapterhorn の標高は日本では東京湾平均海面 (国土地理院 DEM)、その他の多くの地域では
						EGM2008 (Copernicus GLO-30) を基準とします。ジオイド高はすべて EGM2008
						なので、日本の楕円体高には数十 cm 程度の誤差があり得ます。
					</p>
				</details>
			</div>
		{/if}
	</aside>

	{#if profileEnds.length === 2}
		<section
			class={[
				'absolute right-[max(0.75rem,env(safe-area-inset-right))] bottom-[calc(2rem+env(safe-area-inset-bottom))] left-[max(0.75rem,env(safe-area-inset-left))] h-52 rounded-xl border border-white/60 bg-white/90 px-3 pt-2 pb-1 shadow-xl ring-1 ring-slate-900/5 backdrop-blur md:h-64',
				panelOpen && 'md:left-80'
			]}
		>
			{#if profile}
				<ProfileChart {profile} bind:hoverIndex={profileHover} />
			{:else if profileError}
				<p class="p-2 text-xs text-red-700">{profileError}</p>
			{:else}
				<p class="p-2 text-xs">読み込み中…</p>
			{/if}
		</section>
	{/if}
</div>
