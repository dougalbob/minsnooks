<script lang="ts">
	import { formatDiff, type RankedRow } from '$lib/standings';

	let {
		rows,
		heading,
		caption = 'Points first, then frame difference, then match wins.',
		stateLabel = 'Live table'
	}: {
		rows: RankedRow[];
		heading: string;
		caption?: string;
		stateLabel?: string;
	} = $props();

	const hasAwards = $derived(rows.some((row) => row.award));
	const tableId = $derived(`standings-${heading.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
</script>

<section class="standings-card" aria-labelledby="{tableId}-heading">
	<div class="standings-heading">
		<div>
			<p class="section-label">THE LEAGUE</p>
			<h2 id="{tableId}-heading">{heading}</h2>
		</div>
		<span class="sort-hint" aria-label="Standings are ordered by points, frame difference, then wins">
			<span class="sort-icon" aria-hidden="true">↕</span>
			<span>Ranking</span>
		</span>
	</div>
	<p class="table-caption" id="{tableId}-caption">{caption}</p>
	<div class="standings-scroll">
		<table aria-describedby="{tableId}-caption {tableId}-award-explanation">
			<caption class="visually-hidden">
				{heading}. Ranked by table points, frame difference, and match wins. Tied players share a position.
			</caption>
			<thead>
				<tr>
					<th scope="col" class="rank-head">Rank</th>
					<th scope="col" class="name-head">Player</th>
					<th scope="col" class="played-head" abbr="Played" title="Matches played">P</th>
					<th scope="col" class="pts-head">PTS</th>
					<th scope="col" class="diff-head" abbr="Frame difference" title="Frame difference">FD</th>
					<th scope="col" class="wins-head" abbr="Wins" title="Match wins">W</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.name)}
					<tr>
						<td class="rank">{String(row.position).padStart(2, '0')}</td>
						<td>
							<div class="player-cell">
								<span class="avatar avatar-{row.tone}" aria-hidden="true">
									<span>{row.initials}</span>
								</span>
								<span class="player-name">{row.name}</span>
							</div>
						</td>
						<td class="played">{row.played}</td>
						<td class="pts-cell">
							<span
								class="points-ball ball-{row.ball}"
								role="img"
								aria-label="{row.points} table points{row.award
									? ', includes an administrative award'
									: ''}"
							>
								<span>{row.points}{#if row.award}<span class="award-star" aria-hidden="true">*</span>{/if}</span>
							</span>
						</td>
						<td class="diff-cell {row.frameDiff > 0 ? 'positive' : row.frameDiff < 0 ? 'negative' : ''}">
							{formatDiff(row.frameDiff)}
						</td>
						<td class="wins-cell">{row.wins}</td>
					</tr>
				{:else}
					<tr><td class="empty-row" colspan="6">No standings are available for this period yet.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
	<div class="award-explanation" id="{tableId}-award-explanation">
		<span class="asterisk" aria-hidden="true">*</span>
		<p>
			<strong>Administrative award</strong>
			<span>Table points only — no frames or match win added.</span>
		</p>
	</div>
	<div class="table-legend" aria-label="Standings abbreviations">
		<span><b>P</b> played</span>
		<span><b>PTS</b> table points</span>
		<span><b>FD</b> frame difference</span>
		<span><b>W</b> match wins</span>
		{#if hasAwards}
			<span><b>*</b> includes an administrative award</span>
		{/if}
	</div>
	<p class="visually-hidden" aria-live="polite">{stateLabel}</p>
</section>
