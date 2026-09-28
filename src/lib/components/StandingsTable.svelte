<script lang="ts">
	import { rankRows, formatDiff, type StandingRow } from '$lib/standings';

	let {
		rows,
		heading,
		caption = 'Points first, then frame difference, then match wins.',
		stateLabel = 'Live table'
	}: {
		rows: StandingRow[];
		heading: string;
		caption?: string;
		stateLabel?: string;
	} = $props();

	const ranked = $derived(rankRows(rows));
	const hasAwards = $derived(rows.some((row) => row.award));
</script>

<section class="standings-card" aria-labelledby="standings-heading">
	<div class="standings-heading">
		<div>
			<p class="section-label">THE LEAGUE</p>
			<h2 id="standings-heading">{heading}</h2>
		</div>
		<button
			class="sort-hint"
			aria-label="Standings are ordered by points, frame difference, then wins"
		>
			<span class="sort-icon" aria-hidden="true">↕</span>
			<span>Ranking</span>
		</button>
	</div>
	<p class="table-caption" id="table-caption">{caption}</p>
	<div class="standings-scroll">
		<table aria-describedby="table-caption award-explanation">
			<thead>
				<tr>
					<th scope="col" class="rank-head">#</th>
					<th scope="col" class="name-head">PLAYER</th>
					<th scope="col" class="played-head" title="Matches played">P</th>
					<th scope="col" class="pts-head">PTS</th>
					<th scope="col" class="diff-head">FD</th>
					<th scope="col" class="wins-head" title="Match wins">W</th>
				</tr>
			</thead>
			<tbody>
				{#each ranked as row (row.name)}
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
				{/each}
			</tbody>
		</table>
	</div>
	<div class="award-explanation" id="award-explanation">
		<span class="asterisk" aria-hidden="true">*</span>
		<p>
			<strong>Administrative award</strong>
			<span>Table points only — no frames or match win added.</span>
		</p>
	</div>
	<div class="table-legend">
		<span><b>P</b> played</span>
		<span><b>PTS</b> table points</span>
		<span><b>FD</b> frame difference</span>
		<span><b>W</b> match wins</span>
		{#if hasAwards}
			<span><b>*</b> includes an administrative award</span>
		{/if}
	</div>
	<p class="visually-hidden">{stateLabel}</p>
</section>
