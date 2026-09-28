<script lang="ts">
	import FixtureCard from '$lib/components/FixtureCard.svelte';
	import PlayerAvatar from '$lib/components/PlayerAvatar.svelte';
	import { formatCalendarDate, formatShortDate } from '$lib/format';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const outstanding = $derived(
		data.fixtures.filter((fixture) => fixture.state === 'unplayed' || fixture.state === 'awaiting_confirmation')
	);
	const resolved = $derived(
		data.fixtures.filter(
			(fixture) =>
				fixture.state === 'confirmed' || fixture.state === 'awarded' || fixture.state === 'closed_unplayed'
		)
	);
	const progress = $derived(data.currentRound?.progress ?? null);
	const progressPercent = $derived(
		progress && progress.total > 0 ? Math.round((progress.confirmed / progress.total) * 100) : 0
	);
	const resultsTabCount = $derived(
		data.tab === 'results' && data.archive
			? data.archive.results.length
			: (data.currentRound?.progress.confirmed ?? 0)
	);
	const windowNote = $derived.by(() => {
		const round = data.currentRound;
		if (!round || round.status !== 'open' || !round.deadlineAt || !data.season) return null;
		const windowEnd = data.fixtures[0]?.lastPlayableDate ?? null;
		const deadline = formatCalendarDate(round.deadlineAt.slice(0, 10), { year: true });
		return windowEnd
			? `Round ${round.number} deadline is ${deadline} plus ${round.graceDays} day${
					round.graceDays === 1 ? '' : 's'
				}’ grace, so fixtures can be played up to ${formatCalendarDate(windowEnd, { year: true })}. Unplayed fixtures then close neutrally.`
			: null;
	});
	const archiveNote = $derived.by(() => {
		const archive = data.archive;
		if (!archive) return null;
		const parts: string[] = [];
		if (archive.progress.awarded > 0) {
			parts.push(
				`${archive.progress.awarded} fixture${archive.progress.awarded === 1 ? '' : 's'} resolved by administrative award`
			);
		}
		if (archive.progress.closedUnplayed > 0) {
			parts.push(
				`${archive.progress.closedUnplayed} closed neutrally after grace`
			);
		}
		return parts.length > 0
			? `Also in Round ${archive.roundNumber}: ${parts.join(' and ')}. Those are table-points-only decisions or neutral closures, not played results — they are listed on the Fixtures tab.`
			: null;
	});
</script>

<svelte:head>
	<title>
		{data.season
			? `Minsnooks · Fixtures & results · Round ${data.currentRound?.number ?? '—'}`
			: 'Minsnooks · Fixtures'}
	</title>
</svelte:head>

<section class="flow-screen">
	<div class="flow-header">
		<a class="back-link" href="/"><span aria-hidden="true">←</span> {data.currentRound
				? `Round ${data.currentRound.number} table`
				: 'Home'}</a>
		<p class="flow-kicker">
			{#if data.season}
				{data.season.label} SEASON{#if data.currentRound} · ROUND {data.currentRound.number}{/if}
			{:else}
				NO SEASON SEEDED
			{/if}
		</p>
		<h1>Fixtures &amp; results</h1>
		<p class="flow-intro">Plan the next frame, or look back at confirmed results from this round.</p>
		{#if data.viewer}
			<p class="viewer-line">
				Signed in as <strong>{data.viewer.name}</strong> — your fixtures are highlighted.
			</p>
		{/if}
	</div>

	{#if !data.season || !data.currentRound}
		<div class="placeholder-card">
			<strong>No fixtures yet.</strong>
			Seed the fictional league (<code>npm run seed</code>) to open a round with a roster, fixtures and results.
		</div>
	{:else}
		<nav class="fixture-subtabs" aria-label="Fixtures and results">
			<a
				class="fixture-subtab"
				class:selected={data.tab === 'fixtures'}
				aria-current={data.tab === 'fixtures' ? 'page' : undefined}
				href="/fixtures?tab=fixtures"
			>
				Fixtures <span>{outstanding.length}</span>
			</a>
			<a
				class="fixture-subtab"
				class:selected={data.tab === 'results'}
				aria-current={data.tab === 'results' ? 'page' : undefined}
				href="/fixtures?tab=results"
			>
				Results <span>{resultsTabCount}</span>
			</a>
		</nav>

		{#if data.tab === 'fixtures'}
			<div class="fixtures-summary">
				<div>
					<strong>{outstanding.length}</strong>
					<span>still to play</span>
				</div>
				{#if progress}
					<div class="fixture-progress-copy">
						<span>{progress.confirmed} of {progress.total} results confirmed</span>
						<i aria-hidden="true"><b style={`width: ${progressPercent}%`}></b></i>
					</div>
				{/if}
			</div>

			{#if windowNote}
				<p class="round-window-note">{windowNote}</p>
			{/if}

			{#if outstanding.length > 0}
				<div class="fixture-stack">
					{#each outstanding as fixture (fixture.fixtureId)}
						<FixtureCard {fixture} />
					{/each}
				</div>
			{:else}
				<div class="placeholder-card empty-card">
					<strong>Every fixture in Round {data.currentRound.number} is resolved.</strong>
					Nothing is outstanding: results are confirmed, awards are recorded, or fixtures closed neutrally after grace.
				</div>
			{/if}

			{#if resolved.length > 0}
				<details class="resolved-details" open={outstanding.length === 0}>
					<summary>Resolved in this round ({resolved.length})</summary>
					<div class="fixture-stack resolved-stack">
						{#each resolved as fixture (fixture.fixtureId)}
							<FixtureCard {fixture} compact />
						{/each}
					</div>
				</details>
			{/if}

			<p class="flow-footnote">
				A planned date is a promise between two players, not proof a match was played. The actual date played is
				entered with the result and confirmed by the opponent.
			</p>
		{:else if data.archive}
			<div class="results-round-switcher">
				{#if data.archive.previousRoundNumber !== null}
					<a
						class="round-arrow"
						href={`/fixtures?tab=results&round=${data.archive.previousRoundNumber}`}
						aria-label={`View Round ${data.archive.previousRoundNumber} results`}>‹</a
					>
				{:else}
					<span class="round-arrow disabled" aria-hidden="true">‹</span>
				{/if}
				<div class="round-switch-copy">
					<span>RESULTS ARCHIVE</span>
					<strong>
						Round {data.archive.roundNumber}
						<i>{data.archive.isCurrentRound ? 'CURRENT' : 'CLOSED'}</i>
					</strong>
				</div>
				{#if data.archive.nextRoundNumber !== null}
					<a
						class="round-arrow"
						href={`/fixtures?tab=results&round=${data.archive.nextRoundNumber}`}
						aria-label={`View Round ${data.archive.nextRoundNumber} results`}>›</a
					>
				{:else}
					<span class="round-arrow disabled" aria-hidden="true">›</span>
				{/if}
			</div>

			<div class="results-list-heading">
				<div>
					<strong>Round {data.archive.roundNumber} results</strong>
					<span>
						{data.archive.results.length} confirmed result{data.archive.results.length === 1 ? '' : 's'} · newest
						first
					</span>
				</div>
				<span class="results-live-pill" class:closed={!data.archive.isCurrentRound}>
					{data.archive.isCurrentRound ? 'IN PLAY' : 'CLOSED'}
				</span>
			</div>

			{#if data.archive.results.length === 0}
				<div class="placeholder-card empty-card">
					<strong>No confirmed results in Round {data.archive.roundNumber} yet.</strong>
					Results appear here once the opponent confirms them.
				</div>
			{:else}
				<ol class="round-results-list">
					{#each data.archive.results as result (result.resultId)}
						<li
							class="round-result"
							aria-label={`${formatShortDate(result.actualPlayedDate)}: ${result.winner.name} ${result.winnerFrames} to ${result.loserFrames} ${result.loser.name}`}
						>
							<time class="result-date" datetime={result.actualPlayedDate}>
								{formatShortDate(result.actualPlayedDate)}
							</time>
							<span class="result-line">
								<span class="result-player">
									<PlayerAvatar player={result.winner} size="sm" />
								</span>
								<span class="result-score" aria-hidden="true">
									{result.winnerFrames}–{result.loserFrames}
								</span>
								<span class="result-player right">
									<PlayerAvatar player={result.loser} size="sm" />
								</span>
							</span>
						</li>
					{/each}
				</ol>
			{/if}

			<p class="results-footnote">
				Dates shown are actual dates played. Only confirmed league results appear here.
			</p>
			{#if data.archive.awaitingConfirmation > 0}
				<p class="results-footnote">
					{data.archive.awaitingConfirmation} submitted result{data.archive.awaitingConfirmation === 1
						? ''
						: 's'} still awaiting confirmation — not in the table, and not shown above yet.
				</p>
			{/if}
			{#if archiveNote}
				<p class="results-footnote">{archiveNote}</p>
			{/if}
		{/if}
	{/if}
</section>
