<script lang="ts">
	import { GEOID_LINE_COLOR, GROUND_LINE_COLOR } from './colors';
	import { niceTicks } from './profile';
	import type { Profile } from './sources';

	let { profile, hoverIndex = $bindable() }: { profile: Profile; hoverIndex?: number | undefined } =
		$props();

	// 1 ページに複数あっても SVG の id がぶつからないようにする
	const uid = $props.id();
	const css = ([r, g, b]: readonly number[]) => `rgb(${r} ${g} ${b})`;
	const GROUND_COLOR = css(GROUND_LINE_COLOR);
	const GEOID_COLOR = css(GEOID_LINE_COLOR);

	/** 縦軸の範囲。ジオイド付近にすると、地表の高い所ははみ出す */
	let focus: 'all' | 'geoid' = $state('all');
	let width = $state(0);
	let height = $state(0);
	const margin = { top: 10, right: 12, bottom: 22, left: 52 };

	const samples = $derived(profile.samples);
	const km = $derived(profile.length >= 10_000);

	const summary = $derived.by(() => {
		let top = samples[0];
		let geoidMin = Infinity;
		let geoidMax = -Infinity;
		for (const s of samples) {
			if (s.ellipsoidal > top.ellipsoidal) top = s;
			geoidMin = Math.min(geoidMin, s.geoid);
			geoidMax = Math.max(geoidMax, s.geoid);
		}
		return { top, geoidMin, geoidMax };
	});

	// 楕円体面 (h = 0) が必ず入り、その下に少し余白ができるように縦の範囲を取る
	const yRange = $derived.by(() => {
		let lo = 0;
		let hi = 0;
		for (const s of samples) {
			lo = Math.min(lo, s.geoid);
			hi = Math.max(hi, s.geoid);
			if (focus === 'all') {
				lo = Math.min(lo, s.ellipsoidal);
				hi = Math.max(hi, s.ellipsoidal);
			}
		}
		if (focus === 'geoid') {
			// ジオイドの上に地表が少し見えるだけの余白を取る
			const span = Math.max(hi - lo, 10);
			return [lo - span * 0.5, hi + span * 1.2] as const;
		}
		const pad = Math.max(hi - lo, 1);
		return [lo - pad * 0.12, hi + pad * 0.08] as const;
	});

	const plotW = $derived(Math.max(width - margin.left - margin.right, 1));
	const plotH = $derived(Math.max(height - margin.top - margin.bottom, 1));
	const x = (d: number) => margin.left + (d / Math.max(profile.length, 1)) * plotW;
	const y = (h: number) => margin.top + ((yRange[1] - h) / (yRange[1] - yRange[0])) * plotH;

	const points = (key: 'ellipsoidal' | 'geoid') =>
		samples.map((s) => `${x(s.distance)},${y(s[key])}`);
	const groundLine = $derived(`M${points('ellipsoidal').join('L')}`);
	const geoidLine = $derived(`M${points('geoid').join('L')}`);
	// 標高 H (ジオイドから地表まで) と、ジオイド高 N (楕円体面からジオイドまで) の面
	const orthometricArea = $derived(
		`M${points('ellipsoidal').join('L')}L${points('geoid').reverse().join('L')}Z`
	);
	const geoidArea = $derived(
		`M${points('geoid').join('L')}L${x(profile.length)},${y(0)}L${x(0)},${y(0)}Z`
	);

	const yTicks = $derived(niceTicks(yRange[0], yRange[1], Math.max(Math.floor(plotH / 36), 2)));
	const xTicks = $derived(
		niceTicks(0, km ? profile.length / 1000 : profile.length, Math.max(Math.floor(plotW / 90), 2))
	);

	const hovered = $derived(hoverIndex === undefined ? undefined : samples[hoverIndex]);

	function onPointerMove(e: PointerEvent) {
		const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
		const t = (e.clientX - rect.left - margin.left) / plotW;
		hoverIndex = t < 0 || t > 1 ? undefined : Math.round(t * (samples.length - 1));
	}

	const fmtM = (v: number) => `${v.toFixed(1)} m`;
	const fmtTick = (v: number) => `${v.toLocaleString()}`;
	const fmtDistance = (meters: number) =>
		km
			? `${(meters / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km`
			: `${Math.round(meters).toLocaleString()} m`;

	const FOCUS_OPTIONS = [
		['all', '全体'],
		['geoid', 'ジオイド付近']
	] as const;

	// ツールチップはカーソルの右に出し、右端に近いときは左に回す
	const tooltipLeft = $derived(hovered ? x(hovered.distance) : 0);
	const tooltipFlip = $derived(tooltipLeft > width - 190);
</script>

<!-- 系列の色は dataviz の検証済みパレットの 1・2 番 -->
<div
	class="flex h-full w-full flex-col gap-1 text-slate-700"
	style:--ground={GROUND_COLOR}
	style:--geoid={GEOID_COLOR}
>
	<!-- 見出し: 要約・凡例・縦軸の範囲 -->
	<header class="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs">
		<div class="flex items-baseline gap-2">
			<span class="font-semibold text-slate-900">断面</span>
			<span class="text-slate-500 tabular-nums">
				全長 {fmtDistance(profile.length)} · 最高 h {Math.round(
					summary.top.ellipsoidal
				).toLocaleString()} m · N {summary.geoidMin.toFixed(1)}〜{summary.geoidMax.toFixed(1)} m
			</span>
		</div>
		<div class="ml-auto flex items-center gap-3">
			<ul class="hidden items-center gap-3 text-slate-600 sm:flex">
				<li class="flex items-center gap-1.5">
					<span class="h-0.5 w-3.5 rounded-full bg-(--ground)"></span>地表 h
				</li>
				<li class="flex items-center gap-1.5">
					<span class="h-0.5 w-3.5 rounded-full bg-(--geoid)"></span>ジオイド N
				</li>
				<li class="flex items-center gap-1.5">
					<span class="h-px w-3.5 bg-slate-400"></span>楕円体面
				</li>
			</ul>
			<div class="flex rounded-full bg-slate-100 p-0.5" role="group" aria-label="縦軸の範囲">
				{#each FOCUS_OPTIONS as [value, label] (value)}
					<button
						type="button"
						aria-pressed={focus === value}
						class={[
							'rounded-full px-2.5 py-0.5 transition-colors',
							focus === value
								? 'bg-white text-slate-900 shadow-sm'
								: 'text-slate-500 hover:text-slate-800'
						]}
						onclick={() => (focus = value)}
					>
						{label}
					</button>
				{/each}
			</div>
		</div>
	</header>

	<div class="relative min-h-0 flex-1" bind:clientWidth={width} bind:clientHeight={height}>
		<svg
			class="absolute inset-0 h-full w-full touch-none select-none"
			role="img"
			aria-label="地表・ジオイド・楕円体面の断面図"
			onpointerdown={onPointerMove}
			onpointermove={onPointerMove}
			onpointerleave={(e) => {
				// タッチでは指を離しても値を残す
				if (e.pointerType === 'mouse') hoverIndex = undefined;
			}}
		>
			<defs>
				<linearGradient id="{uid}-ground" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stop-color="var(--ground)" stop-opacity="0.32" />
					<stop offset="1" stop-color="var(--ground)" stop-opacity="0.06" />
				</linearGradient>
				<linearGradient id="{uid}-geoid" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stop-color="var(--geoid)" stop-opacity="0.22" />
					<stop offset="1" stop-color="var(--geoid)" stop-opacity="0.08" />
				</linearGradient>
				<!-- 楕円体面より下 (地球の内側) は斜線で控えめに示す -->
				<pattern
					id="{uid}-inside"
					width="6"
					height="6"
					patternUnits="userSpaceOnUse"
					patternTransform="rotate(45)"
				>
					<line x1="0" y1="0" x2="0" y2="6" stroke="#94a3b8" stroke-opacity="0.35" />
				</pattern>
				<marker
					id="{uid}-arrow"
					viewBox="0 0 6 6"
					refX="3"
					refY="3"
					markerWidth="5"
					markerHeight="5"
					orient="auto-start-reverse"
				>
					<path d="M0,0L6,3L0,6Z" fill="context-stroke" />
				</marker>
				<clipPath id="{uid}-plot">
					<rect x={margin.left} y={margin.top} width={plotW} height={plotH} />
				</clipPath>
			</defs>

			<!-- 横のグリッドと縦軸の目盛り (楕円体高 m) -->
			{#each yTicks as t, i (t)}
				<line
					x1={margin.left}
					x2={margin.left + plotW}
					y1={y(t)}
					y2={y(t)}
					stroke="#e2e8f0"
					shape-rendering="crispEdges"
				/>
				<!-- 単位はいちばん上の目盛りにだけ付ける -->
				<text
					x={margin.left - 8}
					y={y(t)}
					dy="0.32em"
					text-anchor="end"
					class="fill-slate-400 text-[10px] tabular-nums"
				>
					{fmtTick(t)}{i === yTicks.length - 1 ? ' m' : ''}
				</text>
			{/each}

			<g clip-path="url(#{uid}-plot)">
				<rect
					x={margin.left}
					y={y(0)}
					width={plotW}
					height={Math.max(margin.top + plotH - y(0), 0)}
					fill="url(#{uid}-inside)"
				/>
				<path d={geoidArea} fill="url(#{uid}-geoid)" />
				<path d={orthometricArea} fill="url(#{uid}-ground)" />
				<line
					x1={margin.left}
					x2={margin.left + plotW}
					y1={y(0)}
					y2={y(0)}
					stroke="#94a3b8"
					stroke-width="1"
					shape-rendering="crispEdges"
				/>
				<path
					d={geoidLine}
					fill="none"
					stroke="var(--geoid)"
					stroke-width="2"
					stroke-linejoin="round"
					stroke-linecap="round"
				/>
				<path
					d={groundLine}
					fill="none"
					stroke="var(--ground)"
					stroke-width="2"
					stroke-linejoin="round"
					stroke-linecap="round"
				/>
			</g>

			<text
				x={margin.left + 6}
				y={Math.min(y(0) + 13, margin.top + plotH - 4)}
				class="fill-slate-500 text-[10px]"
			>
				楕円体面 h = 0
			</text>

			<!-- 横軸 (距離) -->
			{#each xTicks as t (t)}
				<text
					x={x(km ? t * 1000 : t)}
					y={margin.top + plotH + 15}
					text-anchor="middle"
					class="fill-slate-400 text-[10px] tabular-nums"
				>
					{t.toLocaleString()}{km ? ' km' : ' m'}
				</text>
			{/each}

			{#if hovered}
				{@const hx = x(hovered.distance)}
				<line
					x1={hx}
					x2={hx}
					y1={margin.top}
					y2={margin.top + plotH}
					stroke="#334155"
					stroke-opacity="0.35"
				/>
				<!-- 元の図と同じ 3 本の矢印: 楕円体高 h・ジオイド高 N・標高 H -->
				<g stroke-width="1.5" marker-end="url(#{uid}-arrow)">
					<line x1={hx - 9} x2={hx - 9} y1={y(0)} y2={y(hovered.ellipsoidal)} stroke="#334155" />
					<line x1={hx + 9} x2={hx + 9} y1={y(0)} y2={y(hovered.geoid)} stroke="var(--geoid)" />
					<line
						x1={hx + 9}
						x2={hx + 9}
						y1={y(hovered.geoid)}
						y2={y(hovered.ellipsoidal)}
						stroke="var(--ground)"
					/>
				</g>
				<circle
					cx={hx}
					cy={y(hovered.geoid)}
					r="4"
					fill="var(--geoid)"
					stroke="white"
					stroke-width="2"
				/>
				<circle
					cx={hx}
					cy={y(hovered.ellipsoidal)}
					r="4"
					fill="var(--ground)"
					stroke="white"
					stroke-width="2"
				/>
			{/if}
		</svg>

		{#if hovered}
			<div
				class="pointer-events-none absolute top-1 w-44 rounded-lg border border-slate-200/80 bg-white/95 px-2.5 py-2 text-[11px] shadow-lg backdrop-blur"
				style:left="{tooltipFlip ? tooltipLeft - 184 : tooltipLeft + 12}px"
			>
				<div class="mb-1 font-medium text-slate-900 tabular-nums">
					{fmtDistance(hovered.distance)} 地点
				</div>
				<dl class="grid grid-cols-[auto_1fr_auto] items-center gap-x-1.5 gap-y-0.5 tabular-nums">
					<span class="h-2 w-2 rounded-full bg-(--ground)"></span>
					<dt class="text-slate-600">標高 H</dt>
					<dd class="text-right text-slate-900">{fmtM(hovered.orthometric)}</dd>
					<span class="h-2 w-2 rounded-full bg-(--geoid)"></span>
					<dt class="text-slate-600">ジオイド高 N</dt>
					<dd class="text-right text-slate-900">{fmtM(hovered.geoid)}</dd>
					<span class="h-2 w-2 rounded-full bg-slate-700"></span>
					<dt class="text-slate-600">楕円体高 h</dt>
					<dd class="text-right text-slate-900">{fmtM(hovered.ellipsoidal)}</dd>
				</dl>
			</div>
		{/if}
	</div>
</div>
