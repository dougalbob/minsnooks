<script lang="ts">
	import { onMount } from 'svelte';
	import type { TrendPoint } from '$lib/stats';

	interface Props {
		title: string;
		kicker: string;
		description: string;
		points: TrendPoint[];
		minValue?: number;
		maxValue?: number;
		invert?: boolean;
		valueSuffix?: string;
		referenceValue?: number;
		referenceLabel?: string;
		decimals?: number;
		emptyMessage?: string;
	}

	let {
		title,
		kicker,
		description,
		points,
		minValue = 0,
		maxValue = 3,
		invert = false,
		valueSuffix = '',
		referenceValue,
		referenceLabel = 'Reference average',
		decimals = 1,
		emptyMessage = 'There is not enough confirmed match data to draw this trend yet.'
	}: Props = $props();

	let viewport = $state<HTMLDivElement | null>(null);
	let viewportWidth = $state(0);
	let canScrollEarlier = $state(false);
	let canScrollLater = $state(false);

	function slug(value: string): string {
		return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
	}
	const headingId = $derived(`stats-chart-${slug(title)}-heading`);
	const svgTitleId = $derived(`stats-chart-${slug(title)}-svg-title`);
	const svgDescId = $derived(`stats-chart-${slug(title)}-svg-description`);

	function pointTime(point: TrendPoint): number {
		if (!point.timestamp) return new Date(`${point.date}T00:00:00Z`).getTime();
		const normalized = point.timestamp.includes('T') ? point.timestamp : `${point.timestamp.replace(' ', 'T')}Z`;
		return new Date(normalized).getTime();
	}

	const chart = $derived.by(() => {
		const width = viewportWidth > 0 ? viewportWidth : 560;
		const height = 238;
		const left = 42;
		const right = 20;
		const top = 17;
		const bottom = 38;
		const plotHeight = height - top - bottom;
		const usableRange = Math.max(0.001, maxValue - minValue);
		const ordered = [...points];
		if (ordered.length === 0) {
			return { width, height, left, right, top, bottom, plotHeight, months: [], dots: [], line: '', referenceY: null };
		}

		const times = ordered.map(pointTime);
		const first = new Date(times[0]);
		const last = new Date(times[times.length - 1]);
		const start = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));
		const end = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 1));
		const monthCount = Math.max(
			1,
			(end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth()
		);
		const chartWidth = Math.max(width, (width / 4) * monthCount);
		const plotWidth = chartWidth - left - right;
		const referenceRatio = referenceValue === undefined || !Number.isFinite(referenceValue)
			? null
			: Math.min(1, Math.max(0, (referenceValue - minValue) / usableRange));
		const referenceY = referenceRatio === null
			? null
			: top + (invert ? referenceRatio : 1 - referenceRatio) * plotHeight;
		const timeSpan = Math.max(1, end.getTime() - start.getTime());
		const timestampCounts = new Map<number, number>();
		for (const time of times) timestampCounts.set(time, (timestampCounts.get(time) ?? 0) + 1);
		const timestampOffsets = new Map<number, number>();
		const dots = ordered.map((point, index) => {
			const time = times[index];
			const ratio = Math.min(1, Math.max(0, (time - start.getTime()) / timeSpan));
			const count = timestampCounts.get(time) ?? 1;
			const offsetIndex = timestampOffsets.get(time) ?? 0;
			timestampOffsets.set(time, offsetIndex + 1);
			const spread = Math.min(36, (count - 1) * 4);
			const jitter = count > 1 ? ((offsetIndex / (count - 1)) - 0.5) * spread : 0;
			const x = left + ratio * plotWidth + jitter;
			const valueRatio = Math.min(1, Math.max(0, (point.value - minValue) / usableRange));
			const yRatio = invert ? valueRatio : 1 - valueRatio;
			const y = top + yRatio * plotHeight;
			return { ...point, x, y, formatted: `${point.value.toFixed(decimals)}${valueSuffix ? ` ${valueSuffix}` : ''}` };
		});

		const months: Array<{ key: string; x: number; label: string }> = [];
		for (let cursor = new Date(start); cursor < end; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
			const monthStart = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
			const ratio = (monthStart.getTime() - start.getTime()) / timeSpan;
			months.push({
				key: `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`,
				x: left + ratio * plotWidth,
				label: new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(cursor)
			});
		}
		const line = dots.map((dot) => `${dot.x.toFixed(1)},${dot.y.toFixed(1)}`).join(' ');
		return { width: chartWidth, height, left, right, top, bottom, plotHeight, months, dots, line, referenceY };
	});

	const yTicks = $derived.by(() => {
		const desired = 4;
		const values = new Set<number>([minValue, maxValue]);
		if (
			decimals === 0 &&
			Number.isInteger(minValue) &&
			Number.isInteger(maxValue) &&
			maxValue - minValue <= 12
		) {
			for (let value = minValue + 1; value < maxValue; value++) values.add(value);
		} else {
			for (let index = 1; index < desired - 1; index++) {
				values.add(minValue + ((maxValue - minValue) * index) / (desired - 1));
			}
		}
		return [...values].sort((a, b) => a - b).map((value) => {
			const range = Math.max(0.001, maxValue - minValue);
			const ratio = (value - minValue) / range;
			const yRatio = invert ? ratio : 1 - ratio;
			return {
				value,
				y: chart.top + yRatio * chart.plotHeight,
				label: `${Number(value.toFixed(decimals))}${valueSuffix ? ` ${valueSuffix}` : ''}`
			};
		});
	});

	function updateScrollState() {
		if (!viewport) return;
		canScrollEarlier = viewport.scrollLeft > 4;
		canScrollLater = viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 4;
	}

	function scrollWindow(direction: -1 | 1) {
		if (!viewport) return;
		viewport.scrollBy({ left: direction * viewport.clientWidth });
	}

	onMount(() => {
		const element = viewport;
		if (!element) return;
		const observer = new ResizeObserver((entries) => {
			viewportWidth = Math.round(entries[0]?.contentRect.width ?? element.clientWidth);
			updateScrollState();
		});
		observer.observe(element);
		requestAnimationFrame(() => {
			element.scrollLeft = element.scrollWidth;
			updateScrollState();
		});
		return () => observer.disconnect();
	});
</script>

<section class="trend-card" aria-labelledby={headingId}>
	<div class="trend-heading">
		<div>
			<p class="trend-kicker">{kicker}</p>
			<h3 id={headingId}>{title}</h3>
		</div>
		<span class="trend-mark" aria-hidden="true"><span></span><span></span><span></span></span>
	</div>
	<p class="trend-description">{description}</p>

	{#if chart.dots.length > 0}
		<div class="trend-scroll-controls">
			<span>About four months in view</span>
			<div>
				<button type="button" onclick={() => scrollWindow(-1)} disabled={!canScrollEarlier} aria-label={`Scroll to earlier ${title.toLowerCase()}`}>
					<span aria-hidden="true">←</span> Earlier
				</button>
				<button type="button" onclick={() => scrollWindow(1)} disabled={!canScrollLater} aria-label={`Scroll to later ${title.toLowerCase()}`}>
					Later <span aria-hidden="true">→</span>
				</button>
			</div>
		</div>
		<!-- svelte-ignore a11y_no_noninteractive_tabindex: the named region is a keyboard-scrollable horizontal chart -->
		<div
			class="trend-scroll"
			bind:this={viewport}
			onscroll={updateScrollState}
			tabindex="0"
			role="region"
			aria-label={`${title} chart. Scroll horizontally for other months; a data table follows.`}
		>
			<svg
				class="trend-svg"
				width={chart.width}
				height={chart.height}
				viewBox={`0 0 ${chart.width} ${chart.height}`}
				role="img"
				aria-labelledby={`${svgTitleId} ${svgDescId}`}
			>
				<title id={svgTitleId}>{title} for {points.length} league updates</title>
				<desc id={svgDescId}>{description} Values are shown in the data table below the chart.{chart.referenceY !== null && referenceValue !== undefined ? ` Dashed line: ${referenceLabel}, ${referenceValue.toFixed(decimals)}${valueSuffix ? ` ${valueSuffix}` : ''}.` : ''}</desc>
				{#each yTicks as tick (tick.value)}
					<line class="trend-gridline" x1={chart.left} x2={chart.width - chart.right} y1={tick.y} y2={tick.y} />
					<text class="trend-y-label" x={chart.left - 8} y={tick.y + 3} text-anchor="end">{tick.label}</text>
				{/each}
				{#each chart.months as month (month.key)}
					<line class="trend-month-line" x1={month.x} x2={month.x} y1={chart.top} y2={chart.height - chart.bottom} />
					<text class="trend-month-label" x={month.x + 4} y={chart.height - 13}>{month.label}</text>
				{/each}
				{#if chart.referenceY !== null && referenceValue !== undefined}
					<line class="trend-reference" x1={chart.left} x2={chart.width - chart.right} y1={chart.referenceY} y2={chart.referenceY} />
					<text class="trend-reference-label" x={chart.width - chart.right - 4} y={chart.referenceY - 5} text-anchor="end">{referenceLabel} {referenceValue.toFixed(decimals)}</text>
				{/if}
				{#if chart.dots.length > 1}
					<polyline class="trend-line" points={chart.line} />
				{/if}
				{#each chart.dots as dot (dot.id)}
					<circle class="trend-dot" cx={dot.x} cy={dot.y} r="4.2">
						<title>{dot.detail} · {dot.formatted}</title>
					</circle>
				{/each}
			</svg>
		</div>
		<details class="trend-data-details">
			<summary>Read the chart data</summary>
			<div class="trend-table-scroll">
				<table>
					<caption class="visually-hidden">{title} values</caption>
					<thead><tr><th scope="col">Date</th><th scope="col">League point</th><th scope="col">Value</th></tr></thead>
					<tbody>
						{#each chart.dots as dot (dot.id)}
							<tr><td>{dot.date}</td><td>{dot.detail}</td><td>{dot.formatted}</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
		</details>
	{:else}
		<div class="trend-empty">{emptyMessage}</div>
	{/if}
</section>

<style>
	.trend-card {
		min-width: 0;
		padding: 17px 16px 14px;
		border: 1px solid rgba(190, 228, 171, 0.25);
		border-radius: 14px;
		background: linear-gradient(155deg, rgba(8, 77, 51, 0.92), rgba(4, 46, 35, 0.98));
		box-shadow: inset 0 1px rgba(255, 255, 255, 0.04), 0 12px 25px rgba(0, 20, 13, 0.11);
	}

	.trend-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 10px;
	}

	.trend-kicker {
		margin: 0 0 4px;
		color: #b8d6a6;
		font-size: 8px;
		font-weight: 800;
		letter-spacing: 0.15em;
	}

	h3 {
		margin: 0;
		color: #f2f8e8;
		font: 700 16px 'Manrope', sans-serif;
		letter-spacing: -0.25px;
	}

	.trend-mark {
		display: flex;
		align-items: end;
		gap: 3px;
		padding: 5px 7px;
		border: 1px solid rgba(217, 237, 193, 0.18);
		border-radius: 10px;
		background: rgba(223, 242, 194, 0.06);
	}

	.trend-mark span {
		width: 4px;
		border-radius: 5px;
		background: #c5e78d;
	}
	.trend-mark span:nth-child(1) { height: 7px; opacity: 0.55; }
	.trend-mark span:nth-child(2) { height: 11px; opacity: 0.77; }
	.trend-mark span:nth-child(3) { height: 15px; }

	.trend-description {
		margin: 9px 0 10px;
		color: #afc9ad;
		font-size: 10px;
		line-height: 1.5;
	}

	.trend-scroll-controls {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin: 0 0 5px;
		color: #a7c5a8;
		font-size: 9px;
	}

	.trend-scroll-controls > div { display: flex; gap: 5px; }

	.trend-scroll-controls button {
		min-height: 34px;
		padding: 5px 9px;
		border: 1px solid rgba(212, 236, 195, 0.2);
		border-radius: 8px;
		background: rgba(235, 249, 223, 0.055);
		color: #e0efce;
		font: 600 10px 'DM Sans', sans-serif;
		cursor: pointer;
	}

	.trend-scroll-controls button:hover:not(:disabled) { background: rgba(235, 249, 223, 0.12); }
	.trend-scroll-controls button:disabled { opacity: 0.42; cursor: not-allowed; }

	.trend-scroll {
		width: 100%;
		overflow-x: auto;
		overflow-y: hidden;
		border-radius: 9px;
		background: linear-gradient(180deg, rgba(1, 30, 22, 0.28), rgba(1, 30, 22, 0.08));
		scrollbar-color: rgba(196, 225, 152, 0.55) rgba(2, 34, 25, 0.65);
		scrollbar-width: thin;
		overscroll-behavior-inline: contain;
		-webkit-overflow-scrolling: touch;
	}

	.trend-svg { display: block; overflow: visible; }
	.trend-gridline { stroke: rgba(211, 234, 196, 0.13); stroke-width: 1; }
	.trend-month-line { stroke: rgba(211, 234, 196, 0.08); stroke-width: 1; }
	.trend-y-label, .trend-month-label { fill: #9ab69e; font: 9px 'DM Sans', sans-serif; }
	.trend-line { fill: none; stroke: #d0e985; stroke-width: 2.3; stroke-linecap: round; stroke-linejoin: round; filter: drop-shadow(0 1px 4px rgba(201, 232, 131, 0.28)); }
	.trend-reference { stroke: #edce78; stroke-width: 1.5; stroke-dasharray: 5 5; opacity: 0.75; }
	.trend-reference-label { fill: #eed58d; font: 8px 'DM Sans', sans-serif; }
	.trend-dot { fill: #f3d477; stroke: #073d2c; stroke-width: 2; }

	.trend-data-details { margin-top: 9px; color: #bdd2b1; font-size: 10px; }
	.trend-data-details summary { width: fit-content; min-height: 30px; display: flex; align-items: center; cursor: pointer; color: #c6dda9; }
	.trend-table-scroll { max-height: 230px; overflow: auto; margin-top: 4px; }
	.trend-table-scroll table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
	.trend-table-scroll th, .trend-table-scroll td { padding: 6px 7px; border-bottom: 1px solid rgba(211, 234, 196, 0.1); text-align: left; }
	.trend-table-scroll th { color: #e3edce; font-size: 9px; }
	.trend-table-scroll td { color: #b4cdb0; }
	.trend-empty { min-height: 100px; display: grid; place-items: center; padding: 14px; border: 1px dashed rgba(197, 227, 168, 0.22); border-radius: 10px; color: #b1c8a9; font-size: 11px; text-align: center; }

	@media (max-width: 460px) {
		.trend-card { padding: 14px 11px 12px; }
	}
</style>
