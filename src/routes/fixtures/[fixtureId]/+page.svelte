<script lang="ts">
	import FixtureMatchup from '$lib/components/FixtureMatchup.svelte';
	import ResultSummaryCard from '$lib/components/ResultSummaryCard.svelte';
	import { formatCalendarDate, formatInstantInZone, formatPlannedDate } from '$lib/format';
	import { auditActionLabel } from '$lib/result-view';
	import { fixtureStateLabel, fixtureStatusClass } from '$lib/fixture-view';
	import type { PageData } from './$types';

	let { data, form }: { data: PageData; form: { message?: string } | null } = $props();

	const fixture = $derived(data.fixture);
	const record = $derived(data.record);
	const permissions = $derived(data.permissions);
	const statusLabel = $derived(fixtureStateLabel(fixture.state, fixture.plannedDate, fixture.result));
	const statusClass = $derived(fixtureStatusClass(fixture.state, fixture.plannedDate, fixture.result));
	const canArrange = $derived(
		fixture.state === 'unplayed' && fixture.roundStatus === 'open' && fixture.canManage
	);
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
		{#if data.flashSuccess}
			<div class="flow-success-card compact-success">
				<span class="success-mark" aria-hidden="true">✓</span>
				<p class="section-label">ROUND {fixture.roundNumber} · RESULT STATUS</p>
				<p class="success-copy">{data.flash}</p>
				{#if data.awardReview}
					<p class="flow-disclaimer">
						An administrative award takes its table points from this result, so it has been flagged
						for review rather than silently rewritten.
					</p>
				{/if}
			</div>
		{:else}
			<p class="lifecycle-flash" role="status">
				{data.flash}
				{#if data.afterWindow}
					That plan falls after this round’s play window, so the fixture closes neutrally unless a
					result is recorded first.
				{/if}
			</p>
		{/if}
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
					This plan is after the round’s deadline and grace window, so the fixture closes neutrally
					unless a result is recorded first. A plan never becomes a played date.
				</p>
			{/if}
		{:else}
			<p class="plan-meta">
				Planning is optional. The two players can arrange a date, or simply play the frames and record
				the result.
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
				Playable until <strong>{formatCalendarDate(fixture.lastPlayableDate, { year: true })}</strong>
				(round deadline plus grace). Unplayed fixtures close neutrally after that — never as a 0–0.
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
					{#if record}
						{record.winner.name} won {record.winnerFrames}–{record.loserFrames}
					{:else}
						Not played yet
					{/if}
				</h2>
			</div>
			<span class="plan-chip">
				{record
					? record.status === 'confirmed'
						? 'CONFIRMED'
						: record.status === 'submitted'
							? 'AWAITING'
							: 'SENT BACK'
					: 'OPEN'}
			</span>
		</div>

		{#if record}
			<ResultSummaryCard {record} timeZone={data.timeZone} showStatus={false} />

			{#if record.status === 'submitted'}
				<p class="plan-meta">
					Not in the league table yet: only confirmed results count.
					<strong>{permissions.opponentName ?? 'The other player'}</strong>
					{#if record.submittedByPlayerId === data.viewer?.playerId}
						is the one who has to confirm it — you submitted it, so you cannot.
					{:else}
						can confirm the scoreline and the actual date together, or send it back.
					{/if}
				</p>
			{:else if record.status === 'sent_back'}
				<p class="plan-meta">
					Sent back for correction{#if record.sentBackByName} by <strong>{record.sentBackByName}</strong>{/if}
					{#if record.sendBackReason}— “{record.sendBackReason}”{/if}. The fixture is outstanding
					again and nothing has changed in the table.
				</p>
			{:else}
				<p class="plan-meta">
					Confirmed{#if record.confirmedByName} by <strong>{record.confirmedByName}</strong>{/if}, so
					this match counts in the round and season tables.
					{#if record.correctedByName}
						Changed after approval by <strong>{record.correctedByName}</strong>
						{#if record.correctionReason}— “{record.correctionReason}”{/if}.
					{/if}
				</p>
			{/if}

			<div class="plan-actions">
				{#if permissions.canReview}
					<a class="small-primary" href="/fixtures/{fixture.fixtureId}/review">
						{record.status === 'submitted' ? 'Review the result' : 'View the review'}
					</a>
				{/if}
				{#if permissions.canResubmit}
					<a class="small-primary" href="/fixtures/{fixture.fixtureId}/record">
						Correct and resubmit
					</a>
				{/if}
				{#if permissions.canCorrect}
					<a
						class={permissions.canReview || permissions.canResubmit ? 'small-secondary' : 'small-primary'}
						href="/fixtures/{fixture.fixtureId}/correct">Correct as admin</a
					>
				{/if}
				{#if !permissions.canReview && !permissions.canResubmit && !permissions.canCorrect}
					<p class="plan-permission">
						{permissions.reviewReason ?? permissions.submitReason ?? ''}
					</p>
				{/if}
			</div>

			{#if data.audit.length > 0}
				<details class="plan-history result-history">
					<summary>Result history ({data.audit.length})</summary>
					<ol class="result-audit">
						{#each data.audit as entry (entry.id)}
							<li>
								<span class="history-state">{auditActionLabel(entry.action)}</span>
								<span class="history-meta">
									{entry.actorName ?? 'the system'} ·
									{formatInstantInZone(entry.createdAt, data.timeZone)}
									{#if entry.reason}· “{entry.reason}”{/if}
								</span>
							</li>
						{/each}
					</ol>
				</details>
			{/if}
		{:else if fixture.state === 'awarded' && fixture.award}
			<p class="plan-meta">
				Resolved by an administrative award instead of a played match:
				<strong>{fixture.award.playerName}</strong>
				receives {fixture.award.tablePoints} table point{fixture.award.tablePoints === 1 ? '' : 's'},
				and no frames, frame difference or match win is added. {fixture.award.reason ?? ''}
			</p>
		{:else if fixture.state === 'closed_unplayed'}
			<p class="plan-meta">
				This fixture closed neutrally after the round’s deadline and grace period. Neither player was
				blamed or awarded points, and no 0–0 was recorded.
			</p>
			{#if permissions.canRecordRetrospective}
				<div class="plan-actions">
					<a class="small-primary" href="/fixtures/{fixture.fixtureId}/record">
						Record a retrospective result
					</a>
				</div>
				<p class="plan-meta">
					Admins only, and only for a match genuinely played inside the deadline and grace window.
				</p>
			{:else}
				<p class="plan-permission">
					{permissions.retrospectiveReason ??
						'Only an admin can record a retrospective result for a closed fixture.'}
				</p>
			{/if}
		{:else}
			<p class="plan-meta">
				Played already? You can record the result without a booking — the {data.framesPerMatch} frame
				winners and the day you actually played.
			</p>
			<div class="plan-actions">
				{#if permissions.canSubmit || permissions.canEnterDirectly}
					<a class="small-primary" href="/fixtures/{fixture.fixtureId}/record">Record result</a>
				{:else}
					<p class="plan-permission">{permissions.submitReason ?? ''}</p>
				{/if}
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
			{#if data.lastPlayableDate}
				Last playable day: {formatCalendarDate(data.lastPlayableDate, { year: true })}.
			{/if}
		</p>
	</div>
</section>
