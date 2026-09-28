<script lang="ts">
	import StandingsTable from '$lib/components/StandingsTable.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const seasonConfirmed = $derived(
		data.roundTable.reduce((total, round) => total + round.confirmed, 0)
	);
	const seasonTotal = $derived(data.roundTable.reduce((total, round) => total + round.total, 0));
	const current = $derived(
		data.currentRoundNumber !== null
			? data.roundTable.find((round) => round.number === data.currentRoundNumber)
			: undefined
	);
	const roundLabel = $derived(data.currentRoundNumber ?? data.roundTable.length);
</script>

<svelte:head>
	<title>Seed debug · Minsnooks</title>
</svelte:head>

<section class="debug-head" aria-labelledby="debug-title">
	<p class="overline"><span class="overline-dash"></span> DEBUG · NOT PART OF THE APP <span class="overline-dash"></span></p>
	<h1 id="debug-title">Seeded league, read from SQLite</h1>
	<p class="debug-lede">
		Every number below is computed by the canonical standings engine from the seeded database —
		there are no provisional arrays on this page. Fictional data only.
	</p>
</section>

<section class="debug-facts" aria-label="Season configuration">
	<dl>
		<div><dt>Season</dt><dd>{data.season.label}</dd></div>
		<div><dt>Frames per match</dt><dd>{data.season.framesPerMatch}</dd></div>
		<div><dt>Points per frame</dt><dd>{data.season.pointsPerFrame}</dd></div>
		<div><dt>Match-win bonus</dt><dd>{data.season.matchWinBonus}</dd></div>
		<div><dt>Timezone</dt><dd>{data.season.timezone}</dd></div>
		<div><dt>Audit entries</dt><dd>{data.auditCount}</dd></div>
	</dl>
</section>

<div class="content-tabs" role="tablist" aria-label="Standings period">
	<span class="content-tab selected" role="tab" aria-selected="true" tabindex="-1">Round {roundLabel}</span>
	<span class="content-tab" role="tab" aria-selected="false" tabindex="-1">Season table</span>
	<span class="tab-spacer"></span>
	<span class="table-state">
		<span class="table-state-dot"></span>
		{current ? 'Round in play' : 'No open round'}
	</span>
</div>

<div class="debug-grid">
	<StandingsTable
		rows={data.roundRows}
		heading={`Round ${roundLabel} standings`}
		stateLabel="Round table from SQLite"
		caption="Points first, then frame difference, then match wins. Awards add table points only."
	/>
	<StandingsTable
		rows={data.seasonRows}
		heading="Season standings"
		stateLabel="Season table from SQLite"
		caption="All confirmed results in season {data.season.label}, plus administrative awards."
	/>
</div>

<section class="debug-panel" aria-labelledby="rounds-title">
	<h2 id="rounds-title">Rounds</h2>
	<div class="standings-scroll">
		<table>
			<caption class="visually-hidden">Seeded rounds and their fixture states</caption>
			<thead>
				<tr>
					<th scope="col">#</th>
					<th scope="col">Status</th>
					<th scope="col">Players</th>
					<th scope="col">Confirmed</th>
					<th scope="col">Awarded</th>
					<th scope="col">Open</th>
					<th scope="col">Closed unplayed</th>
					<th scope="col">Total</th>
					<th scope="col">Deadline</th>
					<th scope="col">Grace</th>
				</tr>
			</thead>
			<tbody>
				{#each data.roundTable as round (round.number)}
					<tr>
						<td class="rank">{String(round.number).padStart(2, '0')}</td>
						<td>
							{#if round.status === 'open'}
								<span class="pill pill-open">open</span>
							{:else}
								<span class="pill">closed</span>
							{/if}
						</td>
						<td>{round.players}</td>
						<td>{round.confirmed}</td>
						<td>{round.awarded}</td>
						<td>{round.unplayed}</td>
						<td>{round.closedUnplayed}</td>
						<td>{round.total}</td>
						<td class="mono">{round.deadlineAt ?? '—'}</td>
						<td>{round.graceDays}d</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p class="debug-note">
		<strong>{seasonConfirmed}</strong> of {seasonTotal} results confirmed across the season
		({data.expectedConfirmed} seeded). Rounds 1–5 are closed: their unplayed fixtures are neutral
		closures, never played 0–0 results. Round {roundLabel} is the round in play.
	</p>
</section>

<section class="debug-panel" aria-labelledby="awards-title">
	<h2 id="awards-title">Administrative awards</h2>
	{#if data.awards.length === 0}
		<p class="debug-note">No awards seeded.</p>
	{:else}
		<ul class="award-list">
			{#each data.awards as award (award.round + award.recipient)}
				<li>
					<div class="award-head">
						<span class="award-points">{award.tablePoints}</span>
						<span>
							<strong>{award.recipient}</strong> awarded against {award.opponent}
							<span class="award-round">Round {award.round}</span>
						</span>
					</div>
					<p class="award-source">source: {award.sourceType.replace(/_/g, ' ')}</p>
					{#if award.reason}<p class="award-reason">{award.reason}</p>{/if}
				</li>
			{/each}
		</ul>
		<p class="debug-note">
			Awards are table points only. They never add frames, frame difference or match wins, which is
			why Jules Rivera's frame difference stays at +11 while his points read 60.
		</p>
	{/if}
</section>

<footer class="footer-note">
	<span class="footer-ball" aria-hidden="true"></span>
	<span>Debug view · fictional seed · engine is the single canonical standings path.</span>
	<span class="footer-spark" aria-hidden="true">✦</span>
</footer>
