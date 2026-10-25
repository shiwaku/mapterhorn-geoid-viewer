<script lang="ts">
	import { niceTicks } from './profile';
	import type { Profile } from './sources';

	let { profile, hoverIndex = $bindable() }: { profile: Profile; hoverIndex?: number | undefined } =
		$props();

	/** 縦軸の範囲。ジオイド付近にすると、地表の高い所ははみ出す */
	let focus: 'all' | 'geoid' = $state('all');
	let width = $state(0);
	let height = $state(0);
	const margin = { top: 12, right: 16, bottom: 22, left: 52 };

	const samples = $derived(profile.samples);
	const km = $derived(profile.length >= 10_000);

	// 楕円体面 (h = 0) が必ず入り、その下に楕円体の帯が見えるように縦の範囲を取る
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
			return [lo - span * 0.6, hi + span * 1.2] as const;
		}
		const pad = Math.max(hi - lo, 1);
		return [lo - pad * 0.2, hi + pad * 0.08] as const;
	});

	const plotW = $derived(Math.max(width - margin.left - margin.right, 1));
	const plotH = $derived(Math.max(height - margin.top - margin.bottom, 1));
	const x = (d: number) => margin.left + (d / Math.max(profile.length, 1)) * plotW;
	const y = (h: number) => margin.top + ((yRange[1] - h) / (yRange[1] - yRange[0])) * plotH;

	const line = (key: 'ellipsoidal' | 'geoid') =>
		samples.map((s, i) => `${i ? 'L' : 'M'}${x(s.distance)},${y(s[key])}`).join('');
	const groundLine = $derived(line('ellipsoidal'));
	const geoidLine = $derived(line('geoid'));
	const groundArea = $derived(`${groundLine}L${x(profile.length)},${y(0)}L${x(0)},${y(0)}Z`);

	const yTicks = $derived(niceTicks(yRange[0], yRange[1], Math.max(Math.floor(plotH / 40), 2)));
	const xTicks = $derived(
		niceTicks(0, km ? profile.length / 1000 : profile.length, Math.max(Math.floor(plotW / 90), 2))
	);

	const hovered = $derived(hoverIndex === undefined ? undefined : samples[hoverIndex]);

	function onPointerMove(e: PointerEvent) {
		const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
		const t = (e.clientX - rect.left - margin.left) / plotW;
		hoverIndex = t < 0 || t > 1 ? undefined : Math.round(t * (samples.length - 1));
	}

	const fmt = (v: number) => `${v.toFixed(1)} m`;
	const fmtY = (v: number) => `${v.toLocaleString()} m`;
	const fmtX = (v: number) => (km ? `${v.toLocaleString()} km` : `${v.toLocaleString()} m`);
	// 矢印の横の位置 (図と同じ並び: 楕円体高・ジオイド高・標高)
	const ARROW_GAP = 7;
</script>

<div class="relative h-full w-full" bind:clientWidth={width} bind:clientHeight={height}>
	<svg
		class="absolute inset-0 h-full w-full touch-none select-none"
		role="img"
		aria-label="断面図"
		onpointerdown={onPointerMove}
		onpointermove={onPointerMove}
		onpointerleave={(e) => {
			// タッチでは指を離しても値を残す
			if (e.pointerType === 'mouse') hoverIndex = undefined;
		}}
	>
		<defs>
			<marker
				id="arrow"
				viewBox="0 0 6 6"
				refX="3"
				refY="3"
				markerWidth="6"
				markerHeight="6"
				orient="auto-start-reverse"
			>
				<path d="M0,0L6,3L0,6Z" fill="context-stroke" />
			</marker>
			<clipPath id="plot">
				<rect x={margin.left} y={margin.top} width={plotW} height={plotH} />
			</clipPath>
		</defs>

		<g clip-path="url(#plot)">
			<!-- 地球楕円体 -->
			<rect
				x={margin.left}
				y={y(0)}
				width={plotW}
				height={Math.max(margin.top + plotH - y(0), 0)}
				fill="#f87171"
			/>
			<!-- 地表 (楕円体面から楕円体高 h まで) -->
			<path d={groundArea} fill="#fdba74" />
			<path d={groundLine} fill="none" stroke="#c2410c" stroke-width="1.5" />
			<!-- ジオイド -->
			<path d={geoidLine} fill="none" stroke="#1d4ed8" stroke-width="2" />
		</g>

		<!-- 縦軸 (楕円体高) -->
		{#each yTicks as t (t)}
			<line
				x1={margin.left}
				x2={margin.left + plotW}
				y1={y(t)}
				y2={y(t)}
				stroke="#0f172a"
				stroke-opacity="0.08"
			/>
			<text
				x={margin.left - 6}
				y={y(t)}
				dy="0.32em"
				text-anchor="end"
				class="fill-slate-600 text-[10px] tabular-nums"
			>
				{fmtY(t)}
			</text>
		{/each}
		<!-- 横軸 (距離) -->
		{#each xTicks as t (t)}
			<text
				x={x(km ? t * 1000 : t)}
				y={margin.top + plotH + 15}
				text-anchor="middle"
				class="fill-slate-600 text-[10px] tabular-nums"
			>
				{fmtX(t)}
			</text>
		{/each}

		<text
			x={margin.left + 6}
			y={Math.min(y(0) + 14, margin.top + plotH - 4)}
			class="fill-red-900 text-[11px] font-bold"
		>
			地球楕円体
		</text>

		{#if hovered}
			{@const hx = x(hovered.distance)}
			<line
				x1={hx}
				x2={hx}
				y1={margin.top}
				y2={margin.top + plotH}
				stroke="#0f172a"
				stroke-opacity="0.4"
				stroke-dasharray="3 3"
			/>
			<!-- 楕円体高 h: 楕円体面から地表まで -->
			<line
				x1={hx - ARROW_GAP}
				x2={hx - ARROW_GAP}
				y1={y(0)}
				y2={y(hovered.ellipsoidal)}
				stroke="#dc2626"
				stroke-width="2"
				marker-end="url(#arrow)"
			/>
			<!-- ジオイド高 N: 楕円体面からジオイドまで -->
			<line
				x1={hx}
				x2={hx}
				y1={y(0)}
				y2={y(hovered.geoid)}
				stroke="#1d4ed8"
				stroke-width="2"
				marker-end="url(#arrow)"
			/>
			<!-- 標高 H: ジオイドから地表まで -->
			<line
				x1={hx + ARROW_GAP}
				x2={hx + ARROW_GAP}
				y1={y(hovered.geoid)}
				y2={y(hovered.ellipsoidal)}
				stroke="#15803d"
				stroke-width="2"
				marker-end="url(#arrow)"
			/>
			<circle cx={hx} cy={y(hovered.ellipsoidal)} r="3" fill="#c2410c" />
			<circle cx={hx} cy={y(hovered.geoid)} r="3" fill="#1d4ed8" />
		{/if}
	</svg>

	<div class="absolute top-1 left-14 flex overflow-hidden rounded border bg-white text-[11px]">
		{#each [['all', '全体'], ['geoid', 'ジオイド付近']] as const as [value, label] (value)}
			<button
				type="button"
				class={focus === value ? 'bg-slate-700 px-2 text-white' : 'px-2 hover:bg-slate-100'}
				onclick={() => (focus = value)}
			>
				{label}
			</button>
		{/each}
	</div>

	<!-- 凡例と、カーソル位置の値 -->
	<div
		class="pointer-events-none absolute top-1 right-2 rounded bg-white/85 px-2 py-1 text-[11px] tabular-nums shadow-sm"
	>
		<!-- 狭い画面では凡例を省き、値だけを出す -->
		<div class="hidden gap-3 sm:flex">
			<span><span class="inline-block h-2 w-3 bg-orange-300 align-middle"></span> 地表</span>
			<span><span class="inline-block h-0.5 w-3 bg-blue-700 align-middle"></span> ジオイド</span>
			<span><span class="inline-block h-2 w-3 bg-red-400 align-middle"></span> 地球楕円体</span>
		</div>
		{#if hovered}
			<div class="mt-0.5 grid grid-cols-[auto_auto] gap-x-2">
				<span class="text-slate-600">距離</span>
				<span class="text-right">{fmtX(km ? hovered.distance / 1000 : hovered.distance)}</span>
				<span class="text-green-700">標高 H</span><span class="text-right"
					>{fmt(hovered.orthometric)}</span
				>
				<span class="text-blue-700">ジオイド高 N</span><span class="text-right"
					>{fmt(hovered.geoid)}</span
				>
				<span class="text-red-700">楕円体高 h</span><span class="text-right"
					>{fmt(hovered.ellipsoidal)}</span
				>
			</div>
		{/if}
	</div>
</div>
