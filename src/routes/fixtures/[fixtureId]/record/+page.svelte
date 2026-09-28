<script lang="ts">
	import FixtureMatchup from '$lib/components/FixtureMatchup.svelte';
	import { formatPlannedDate, formatShortDate } from '$lib/format';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const fixture = $derived(data.fixture);
	const result = $derived(fixture.result);
	const alreadyResolved = $derived(
		fixture.state === 'confirmed' || fixture.state === 'awaiting_confirmation' || fixture.state === 'awarded'
	);
</script>

<svelte:head>
	<title>Minsnooks · Record a result</title>
</svelte:head>

<section class="flow-screen">
	<div class="flow-header">
		<a class="back-link" href="/fixtures/{fixture.fixtureId}">
			<span aria-hidden="true">←</span> Fixture
		</a>
		<p class="flow-kicker">ROUND {fixture.roundNumber} · LEAGUE RESULT</p>
		<h1>Record the match</h1>
		<p class="flow-intro">Enter the three frame winners and the day you actually played.</p>
		<span class="phase-pill">ARRIVING IN PHASE 6</span>
	</div>

	<div class="flow-form-card">
		<div class="selected-match">
			<FixtureMatchup left={fixture.low} right={fixture.high} size="md" />
		</div>

		{#if alreadyResolved && result}
			<p class="plan-meta">
				This fixture already has a {result.status === 'confirmed' ? 'confirmed' : 'submitted'} result:
				<strong>{result.winner.name} {result.winnerFrames}–{result.loserFrames}</strong>, played
				{formatShortDate(result.actualPlayedDate)}.
			</p>
			<p class="plan-meta">
				Opponent review, corrections and post-approval admin changes arrive in Phase 6. Until then a submitted result
				stays out of the league table.
			</p>
		{:else if fixture.state === 'awarded' && fixture.award}
			<p class="plan-meta">
				This fixture was resolved by an administrative award for {fixture.award.playerName}
				({fixture.award.tablePoints} table point{fixture.award.tablePoints === 1 ? '' : 's'} only), so no result can
				be recorded against it.
			</p>
		{:else if fixture.state === 'closed_unplayed'}
			<p class="plan-meta">
				This fixture closed neutrally after the deadline and grace period. An admin can still record a genuine
				retrospective result for a match played inside that window.
			</p>
		{:else}
			<p class="plan-meta">
				Result entry, the opponent’s confirm / send-back review, and correction history are built in Phase 6. This
				screen is where they will live.
			</p>
			{#if fixture.plannedDate}
				<p class="plan-meta plan-reminder">
					Planned date on file: <strong>{formatPlannedDate(fixture.plannedDate.date, fixture.plannedDate.time)}</strong>
					— remember to enter the day you actually played, not the planned date.
				</p>
			{/if}
		{/if}

		<div class="placeholder-card">
			<strong>On the way.</strong>
			Phase 6 adds the result form (exactly three frames, optional frame-by-frame points and highest breaks), the
			“is this correct?” soft checks, opponent confirmation, send-back for correction, and a full audit trail. Nothing
			is submitted from this screen yet.
		</div>

		<div class="form-actions">
			<a class="small-secondary" href="/fixtures/{fixture.fixtureId}">Back to the fixture</a>
			<a class="small-primary" href="/fixtures">All fixtures</a>
		</div>
	</div>
</section>
