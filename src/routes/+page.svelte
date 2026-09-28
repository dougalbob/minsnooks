<script lang="ts">
	import StandingsTable from '$lib/components/StandingsTable.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let scope = $state<'round' | 'season'>('round');

	const isSeason = $derived(scope === 'season');
	const roundLabel = $derived(data.currentRound ? `Round ${data.currentRound.number}` : 'Round table');
	const rows = $derived(isSeason ? data.seasonRows : data.roundRows);
	const progress = $derived(isSeason ? data.seasonProgress : data.roundProgress);
	const progressPercent = $derived(
		progress && progress.total > 0 ? Math.round((progress.confirmed / progress.total) * 100) : 0
	);
	const stateLabel = $derived(
		isSeason
			? 'Season to date'
			: data.currentRound?.status === 'open'
				? 'Round in play'
				: 'Round closed'
	);
	const leaders = $derived(rows.filter((row) => row.position <= 3));
</script>

<svelte:head>
	<title>
		{data.season
			? `Minsnooks · ${isSeason ? `Season ${data.season.label}` : roundLabel}`
			: 'Minsnooks · League table'}
	</title>
</svelte:head>

<section class="hero" aria-labelledby="page-title">
	<div class="hero-copy">
		<p class="overline">
			<span class="overline-dash"></span> FICTIONAL PREVIEW DATA · DATABASE-BACKED
			<span class="overline-dash"></span>
		</p>
		<h1 id="page-title">Minsnooks<span class="brand-spark" aria-hidden="true">✦</span></h1>
		<div class="round-line">
			{#if data.currentRound}
				<span class="round-chip">ROUND {data.currentRound.number}</span>
				<span class="round-separator" aria-hidden="true">·</span>
			{/if}
			<span>Season {data.season?.label ?? 'not seeded'}</span>
		</div>
		<div class="progress-row">
			<span class="live-indicator">
				<i aria-hidden="true"></i>
				{isSeason ? 'SEASON TO DATE' : data.currentRound?.status === 'open' ? 'ROUND IN PLAY' : 'ROUND CLOSED'}
			</span>
			{#if progress}
				<span class="progress-copy">
					<strong>{progress.confirmed}</strong> of {progress.total} results confirmed
				</span>
				<div
					class="progress-meter"
					role="progressbar"
					aria-label={`${stateLabel}: confirmed results`}
					aria-valuemin="0"
					aria-valuemax="100"
					aria-valuenow={progressPercent}
					aria-valuetext={`${progress.confirmed} of ${progress.total} results confirmed`}
				>
					<i style={`width: ${progressPercent}%`} aria-hidden="true"></i>
				</div>
			{:else}
				<span class="progress-copy">Seed the fictional league to view standings.</span>
			{/if}
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

<div class="content-tabs" role="group" aria-label="Standings period">
	<button
		type="button"
		class="content-tab"
		class:selected={!isSeason}
		aria-pressed={!isSeason}
		disabled={!data.currentRound}
		onclick={() => (scope = 'round')}
	>
		{roundLabel}
	</button>
	<button
		type="button"
		class="content-tab"
		class:selected={isSeason}
		aria-pressed={isSeason}
		disabled={!data.season}
		onclick={() => (scope = 'season')}
	>
		Season table
	</button>
	<span class="tab-spacer"></span>
	<span class="table-state">
		<span class="table-state-dot" aria-hidden="true"></span>
		{stateLabel}
	</span>
</div>

<StandingsTable
	{rows}
	heading={isSeason ? 'Season standings' : `${roundLabel} standings`}
	caption="Confirmed match results determine played, points, frame difference and wins. Administrative awards add table points only."
	{stateLabel}
/>

<section class="highlights" aria-labelledby="highlights-title">
	<div class="highlights-heading">
		<div>
			<p class="section-label">AVATAR-LED TABLE SNAPSHOT</p>
			<h2 id="highlights-title">Top of the table <span aria-hidden="true">✦</span></h2>
		</div>
		<span class="frozen-badge"><span aria-hidden="true">✦</span> {isSeason ? 'SEASON TO DATE' : `ROUND ${data.currentRound?.number ?? '—'}`}</span>
	</div>
	<p class="highlight-context">
		{isSeason ? 'Season leaders' : 'Round leaders'} from the same standings shown above. Tied players share a position.
	</p>
	{#if leaders.length > 0}
		<ol class="leader-list" aria-label={`${isSeason ? 'Season' : 'Round'} standings leaders`}>
			{#each leaders as leader (leader.playerId)}
				<li class="leader-card">
					<span class="leader-position">
						<span class="visually-hidden">Position </span>{String(leader.position).padStart(2, '0')}
					</span>
					<span class="avatar avatar-{leader.tone}" aria-hidden="true">
						<span>{leader.initials}</span>
					</span>
					<span class="leader-copy">
						<strong>{leader.name}</strong>
						<span>{leader.points} table points · {leader.wins} match wins</span>
					</span>
				</li>
			{/each}
		</ol>
	{:else}
		<div class="leader-empty">Standings leaders will appear when a season and round are seeded.</div>
	{/if}
	<p class="highlight-context highlight-note">
		Most Improved, highest break and best frame score are planned for the stats phase; no highlight results are invented here.
	</p>
</section>

<footer class="footer-note">
	<span class="footer-ball" aria-hidden="true"></span>
	<span>Good luck, enjoy the frames, and keep it friendly.</span>
	<span class="footer-spark" aria-hidden="true">✦</span>
</footer>
