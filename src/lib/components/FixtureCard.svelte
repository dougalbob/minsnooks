<script lang="ts">
	import FixtureMatchup from './FixtureMatchup.svelte';
	import { formatPlannedDate, formatShortDate } from '$lib/format';
	import { fixtureStateLabel, fixtureStatusClass, type FixtureView } from '$lib/fixture-view';

	let { fixture, compact = false }: { fixture: FixtureView; compact?: boolean } = $props();

	const statusLabel = $derived(
		fixtureStateLabel(fixture.state, fixture.plannedDate, fixture.result)
	);
	const statusClass = $derived(
		fixtureStatusClass(fixture.state, fixture.plannedDate, fixture.result)
	);
	const canArrange = $derived(
		fixture.state === 'unplayed' && fixture.roundStatus === 'open' && fixture.canManage
	);
	// Every call-to-action comes from the server's permission matrix, so a button
	// is never offered for something the write path would refuse.
	const actions = $derived(fixture.resultActions);
	const hasPrimaryAction = $derived(actions.canReview || actions.canResubmit);
	const helper = $derived.by(() => {
		if (fixture.state === 'confirmed' && fixture.result) {
			const frames = `${fixture.result.winnerFrames}–${fixture.result.loserFrames}`;
			return `Played ${formatShortDate(fixture.result.actualPlayedDate)} · ${fixture.result.winner.name} won ${frames}`;
		}
		if (fixture.state === 'awaiting_confirmation' && fixture.result) {
			return `Result submitted by ${fixture.result.submittedByName ?? 'a player'} for ${formatShortDate(
				fixture.result.actualPlayedDate
			)} — awaiting confirmation, so it is not in the table yet.`;
		}
		if (fixture.result?.status === 'sent_back') {
			const by = fixture.result.sentBackByName ? ` by ${fixture.result.sentBackByName}` : '';
			const asked = fixture.result.sendBackReason ? ` “${fixture.result.sendBackReason}”` : '';
			return `Sent back for correction${by}${asked}. The fixture is outstanding again and nothing has changed in the table.`;
		}
		if (fixture.state === 'awarded' && fixture.award) {
			const points = fixture.award.tablePoints;
			return points === 0
				? `No match played. ${fixture.award.playerName} receives 0 table points, so nothing changes — no frames, frame difference or match win is added.`
				: `No match played. ${fixture.award.playerName} receives ${points} table point${points === 1 ? '' : 's'} only — no frames, frame difference or match win is added.`;
		}
		if (fixture.state === 'closed_unplayed') {
			return 'Closed after the deadline and grace period — no result, and no points for either player.';
		}
		if (fixture.plannedDate) {
			const planned = `Planned: ${formatPlannedDate(fixture.plannedDate.date, fixture.plannedDate.time)} (proposed by ${fixture.plannedDate.proposedByName})`;
			return fixture.plannedDate.afterWindow
				? `${planned}. That is after this round’s play window, so the fixture closes neutrally unless a result is recorded.`
				: planned;
		}
		return 'No date arranged yet. Booking is optional — you can record a result without one.';
	});
</script>

<article class="flow-fixture-card" class:own-fixture={fixture.isMine} class:compact-fixture={compact}>
	<div class="flow-fixture-top">
		{#if fixture.isMine}
			<span class="your-fixture-tag">YOUR FIXTURE</span>
		{:else}
			<span class="fixture-round-label">ROUND {fixture.roundNumber} FIXTURE</span>
		{/if}
		<span class="fixture-status {statusClass}">{statusLabel}</span>
	</div>
	<FixtureMatchup left={fixture.low} right={fixture.high} size={compact ? 'sm' : 'md'} />
	<p class="fixture-help">{helper}</p>
	<div class="fixture-actions">
		{#if canArrange}
			<a class="small-secondary" href="/fixtures/{fixture.fixtureId}/arrange">
				{fixture.plannedDate ? 'Change date' : 'Arrange a date'}
			</a>
		{/if}
		{#if actions.canReview}
			<a class="small-primary" href="/fixtures/{fixture.fixtureId}/review">
				{fixture.result?.status === 'submitted' ? 'Review result' : 'View review'}
			</a>
		{/if}
		{#if actions.canResubmit}
			<a class="small-primary" href="/fixtures/{fixture.fixtureId}/record">Correct and resubmit</a>
		{/if}
		{#if actions.canRecord}
			<a
				class={hasPrimaryAction ? 'small-secondary' : 'small-primary'}
				href="/fixtures/{fixture.fixtureId}/record">Record result</a
			>
		{/if}
		{#if actions.canRecordRetrospective}
			<a
				class={hasPrimaryAction ? 'small-secondary' : 'small-primary'}
				href="/fixtures/{fixture.fixtureId}/record">Record retrospectively</a
			>
		{/if}
		{#if actions.canCorrect}
			<a class="small-secondary" href="/fixtures/{fixture.fixtureId}/correct">Correct as admin</a>
		{/if}
		<a class="small-secondary" href="/fixtures/{fixture.fixtureId}">View fixture</a>
	</div>
</article>
