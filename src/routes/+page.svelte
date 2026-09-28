<script lang="ts">
	import StandingsTable from '$lib/components/StandingsTable.svelte';
	import { roundRows, seasonRows, PROVISIONAL_NOTICE } from '$lib/preview-data';

	let scope = $state<'round' | 'season'>('round');

	const isSeason = $derived(scope === 'season');
	const rows = $derived(isSeason ? seasonRows : roundRows);
</script>

<svelte:head>
	<title>Minsnooks · Round 6</title>
</svelte:head>

<section class="hero" aria-labelledby="page-title">
	<div class="hero-copy">
		<p class="overline">
			<span class="overline-dash"></span> VISUAL PREVIEW · FICTIONAL DATA
			<span class="overline-dash"></span>
		</p>
		<h1 id="page-title">Minsnooks<span class="brand-spark">✦</span></h1>
		<div class="round-line">
			<span class="round-chip">ROUND 6</span>
			<span class="round-separator">·</span>
			<span>Season 2026</span>
		</div>
		<div class="progress-row">
			<span class="live-indicator"><i></i> {isSeason ? 'SEASON TOTAL' : 'IN PLAY'}</span>
			<span class="progress-copy">
				{#if isSeason}
					<strong>138</strong> of 168 results confirmed
				{:else}
					<strong>22</strong> of 28 results confirmed
				{/if}
			</span>
			<span class="progress-meter" aria-label="results confirmed">
				<i style="width: 78.57%"></i>
			</span>
		</div>
	</div>
	<div class="cue-art" aria-hidden="true">
		<div class="sun-glow"></div>
		<div class="table-shape">
			<span class="table-inner"></span>
			<span class="table-line"></span>
			<span class="table-circle"></span>
			<i class="pocket pocket-a"></i>
			<i class="pocket pocket-b"></i>
			<i class="pocket pocket-c"></i>
			<i class="pocket pocket-d"></i>
		</div>
		<span class="cue-stick"></span>
		<span class="decor-ball pink-ball"></span>
		<span class="decor-ball yellow-ball"></span>
		<span class="cue-spark">✧</span>
	</div>
</section>

<div class="content-tabs" role="tablist" aria-label="Standings period">
	<button
		class="content-tab"
		class:selected={!isSeason}
		role="tab"
		aria-selected={!isSeason}
		onclick={() => (scope = 'round')}
	>
		Round 6
	</button>
	<button
		class="content-tab"
		class:selected={isSeason}
		role="tab"
		aria-selected={isSeason}
		onclick={() => (scope = 'season')}
	>
		Season table
	</button>
	<span class="tab-spacer"></span>
	<span class="table-state">
		<span class="table-state-dot"></span>
		{isSeason ? 'Season to date' : 'Live table'}
	</span>
</div>

<StandingsTable
	{rows}
	heading={isSeason ? 'Season standings' : 'Round 6 standings'}
	stateLabel={isSeason ? 'Season to date' : 'Live table'}
/>

<section class="highlights" aria-labelledby="highlights-title">
	<div class="highlights-heading">
		<div>
			<p class="section-label">LITTLE MOMENTS, BIG BREAKS</p>
			<h2 id="highlights-title">Round highlights <span aria-hidden="true">✦</span></h2>
		</div>
	</div>
	<p class="highlight-context">Most Improved, highest break and best frame score arrive in Phase 9.</p>
	<div class="placeholder-card">
		<strong>{PROVISIONAL_NOTICE}.</strong>
		The table above is computed by the real ranking engine (points → frame difference → wins,
		shared positions for ties, positional ball colours) over fictional preview rows. The same engine
		now reads the seeded SQLite league at
		<a href="/debug/seed">/debug/seed</a> — the Phase 2 checkpoint, where Round 6 and the season table
		are computed from 168 fixtures, 138 confirmed results and 2 administrative awards. Phase 3 wires
		this page to the database and removes the provisional rows.
	</div>
</section>

<footer class="footer-note">
	<span class="footer-ball" aria-hidden="true"></span>
	<span>Good luck, enjoy the frames, and keep it friendly.</span>
	<span class="footer-spark" aria-hidden="true">✦</span>
</footer>
