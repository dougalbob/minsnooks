<script lang="ts">
	import FixtureMatchup from '$lib/components/FixtureMatchup.svelte';
	import { formatCalendarDate, formatPlannedDate, formatShortDate } from '$lib/format';
	import { fixtureStateLabel, fixtureStatusClass } from '$lib/fixture-view';
	import type { PageData } from './$types';

	let { data, form }: { data: PageData; form: { message?: string } | null } = $props();

	const fixture = $derived(data.fixture);
	const statusLabel = $derived(fixtureStateLabel(fixture.state, fixture.plannedDate));
	const statusClass = $derived(fixtureStatusClass(fixture.state, fixture.plannedDate));
	const canArrange = $derived(
		fixture.state === 'unplayed' && fixture.roundStatus === 'open' && fixture.canManage
	);
	const canRecord = $derived(fixture.state === 'unplayed' || fixture.state === 'awaiting_confirmation');
	const result = $derived(fixture.result);
</script>

<svelte:head>
	<title>Minsnooks · {fixture.low.name} vs {fixture.high.name}</title>
</svelte:head>

<section class="flow-screen">
	<div class="flow-header">
		<a class="back-link" href="/fixtures"><span aria-hidden="true">←</span> Fixtures</a>
		<p class="flow-kicker">ROUND {fixture.roundNumber} · {data.season.label} SEASON</p>
		<h1>{fixture.low.name} vs {fixture.high.name}</h1>
		<div class="detail-status-row">
			<span class="fixture-status {statusClass}">{statusLabel}</span>
			{#if fixture.isMine}
				<span class="your-fixture-tag">YOUR FIXTURE</span>
			{/if}
			{#if fixture.adminOverride}
				<span class="admin-override-pill">ADMIN CHANGE</span>
			{/if}
		</div>
	</div>

	{#if data.flash}
		<p class="lifecycle-flash" role="status">
			{data.flash}
			{#if data.afterWindow}
				That plan falls after this round’s play window, so the fixture closes neutrally unless a result is recorded
				first.
			{/if}
		</p>
	{/if}
	{#if form?.message}
		<p class="form-error" role="alert">{form.message}</p>
	{/if}

	<div class="plan-card">
		<div class="plan-card-heading">
			<div>
				<p class="section-label">PLANNED DATE</p>
				<h2>
					{#if fixture.plannedDate}
						{formatPlannedDate(fixture.plannedDate.date, fixture.plannedDate.time)}
					{:else}
						No date arranged
					{/if}
				</h2>
			</div>
			<span class="plan-chip">{fixture.plannedDate ? 'PLAN' : 'OPEN'}</span>
		</div>

		{#if fixture.plannedDate}
			<p class="plan-meta">
				Proposed by <strong>{fixture.plannedDate.proposedByName}</strong>
				{#if fixture.plannedDate.note}· “{fixture.plannedDate.note}”{/if}
			</p>
			{#if fixture.plannedDate.afterWindow}
				<p class="field-warning" role="status">
					This plan is after the round’s deadline and grace window, so the fixture closes neutrally unless a result
					is recorded first.
				</p>
			{/if}
		{:else}
			<p class="plan-meta">
				Planning is optional. The two players can arrange a date, or simply play the frames and record the result.
			</p>
		{/if}

		{#if canArrange}
			<div class="plan-actions">
				<a class="small-secondary" href="/fixtures/{fixture.fixtureId}/arrange">
					{fixture.plannedDate ? 'Change planned date' : 'Arrange a date'}
				</a>
				{#if fixture.plannedDate}
					<form method="POST" action="?/cancelProposal">
						<button
							class="small-secondary danger"
							type="submit"
							onclick={() => confirm('Cancel this planned date? The fixture keeps its history.')}
						>
							Cancel planned date
						</button>
					</form>
				{/if}
			</div>
		{:else}
			<p class="plan-permission">
				{fixture.manageReason ??
					'Only the two players in this fixture (or an admin) can arrange its planned date.'}
			</p>
		{/if}

		<p class="plan-window">
			{#if fixture.lastPlayableDate}
				Playable until <strong>{formatCalendarDate(fixture.lastPlayableDate, { year: true })}</strong> (round deadline
				plus grace). Unplayed fixtures close neutrally after that — never as a 0–0.
			{:else}
				This round has no deadline snapshot, so no neutral closure date is set.
			{/if}
		</p>
	</div>

	{#if data.history.length > 0}
		<details class="plan-history">
			<summary>Planned-date history ({data.history.length})</summary>
			<ol>
				{#each data.history as entry (entry.bookingId)}
					<li>
						<span class="history-state" class:cancelled={entry.status === 'cancelled'}>
							{entry.status === 'proposed' ? 'Active plan' : 'Cancelled'}
						</span>
						<span class="history-date">
							{formatPlannedDate(entry.proposedDate, entry.proposedTime)}
						</span>
						<span class="history-meta">
							proposed by {entry.proposedByName}{#if entry.cancelledByName}, cancelled by {entry.cancelledByName}{/if}
							{#if entry.cancelReason}· {entry.cancelReason}{/if}
						</span>
					</li>
				{/each}
			</ol>
		</details>
	{/if}

	<div class="result-panel">
		<div class="plan-card-heading">
			<div>
				<p class="section-label">ACTUAL RESULT</p>
				<h2>
					{#if result}
						{result.winner.name} won {result.winnerFrames}–{result.loserFrames}
					{:else}
						Not played yet
					{/if}
				</h2>
			</div>
			<span class="plan-chip">{result ? (result.status === 'confirmed' ? 'CONFIRMED' : 'AWAITING') : 'OPEN'}</span>
		</div>

		{#if result}
			<p class="plan-meta">
				Actual date played: <strong>{formatShortDate(result.actualPlayedDate)}</strong>
				· submitted by {result.submittedByName ?? 'a player'}
				{#if result.status === 'confirmed' && result.confirmedByName}
					· confirmed by {result.confirmedByName}
				{/if}
			</p>
			<p class="plan-meta">
				{result.frameDetailCount > 0
					? `Frame-by-frame scores were recorded for ${result.frameDetailCount} frame${result.frameDetailCount === 1 ? '' : 's'}.`
					: 'No optional frame-by-frame scores were recorded.'}
			</p>
			{#if data.frames.length > 0}
				<ul class="frame-list">
					{#each data.frames as frame (frame.frameNumber)}
						<li>
							<span>Frame {frame.frameNumber}</span>
							<strong>{frame.lowPoints}–{frame.highPoints}</strong>
						</li>
					{/each}
				</ul>
			{/if}
			{#if data.breaks.length > 0}
				<p class="plan-meta">
					Highest breaks:
					{#each data.breaks as entry, index (entry.playerId)}
						{#if index > 0}, {/if}<strong>{entry.playerName}</strong>
						{entry.breakPoints}
					{/each}
				</p>
			{/if}
			{#if result.status !== 'confirmed'}
				<p class="plan-meta">
					This result is not in the league table yet: only confirmed results count towards standings.
				</p>
			{/if}
		{:else if fixture.state === 'awarded' && fixture.award}
			<p class="plan-meta">
				Resolved by an administrative award instead of a played match: <strong>{fixture.award.playerName}</strong>
				receives {fixture.award.tablePoints} table point{fixture.award.tablePoints === 1 ? '' : 's'}, and no frames,
				frame difference or match win is added. {fixture.award.reason ?? ''}
			</p>
		{:else if fixture.state === 'closed_unplayed'}
			<p class="plan-meta">
				This fixture closed neutrally after the round’s deadline and grace period. Neither player was blamed or
				awarded points, and no 0–0 was recorded.
			</p>
		{:else}
			<p class="plan-meta">
				Played already? You can record the result without a booking — the three frame winners and the day you actually
				played.
			</p>
		{/if}

		{#if canRecord}
			<div class="plan-actions">
				<a class="small-primary" href="/fixtures/{fixture.fixtureId}/record">
					{result ? 'Review the submitted result' : 'Record result'}
				</a>
			</div>
		{/if}
	</div>

	<div class="matchup-recap">
		<p class="section-label">THE TWO PLAYERS</p>
		<FixtureMatchup left={fixture.low} right={fixture.high} size="lg" />
		<p class="plan-meta">
			{#if fixture.roundStatus === 'open'}
				Round {fixture.roundNumber} is open for scheduling.
			{:else}
				Round {fixture.roundNumber} is closed; the round table is final.
			{/if}
			{#if data.roundWindowEnd}
				Last playable day: {formatCalendarDate(data.roundWindowEnd, { year: true })}.
			{/if}
		</p>
	</div>

</section>
