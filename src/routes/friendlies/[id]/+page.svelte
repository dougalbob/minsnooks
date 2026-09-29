<script lang="ts">
	import FixtureMatchup from '$lib/components/FixtureMatchup.svelte';
	import { untrack } from 'svelte';
	import { formatCalendarDate, formatPlannedDate } from '$lib/format';
	import type { PageData } from './$types';

	let { data, form }: { data: PageData; form: { message?: string } | null } = $props();

	const detail = $derived(data.detail);
	const permissions = $derived(data.permissions);
	const isAdmin = $derived(data.viewer?.role === 'admin' || data.viewer?.role === 'super_admin');

	const initial = untrack(() => ({
		date: detail.scheduledDate ?? data.minDate,
		time: detail.scheduledTime ?? '',
		note: detail.note ?? ''
	}));
	let date = $state(initial.date);
	let time = $state(initial.time);
	let note = $state(initial.note);

	const statusMessage = $derived(
		data.status === 'scheduled'
			? 'Friendly plan saved. If you play, either of you can record the result here.'
			: data.status === 'rescheduled'
				? 'New date saved. The five-day expiry window follows the newest scheduled date.'
				: data.status === 'recorded'
					? 'Friendly result saved. It stays out of every league table, stat and highlight.'
					: data.status === 'corrected'
						? 'Correction saved and recorded in the history below.'
						: null
	);

	const historyLabel = $derived.by(() => {
		const entries: Record<string, string> = {
			scheduled: 'Plan arranged',
			rescheduled: 'Plan moved',
			cancelled: 'Plan withdrawn',
			expired: 'Plan expired',
			result_recorded: 'Result saved',
			result_corrected: 'Result corrected'
		};
		return (action: string) => entries[action] ?? action.replace(/_/g, ' ');
	});
</script>

<svelte:head>
	<title>Minsnooks · {detail.low.name} v {detail.high.name} friendly</title>
</svelte:head>

<section class="flow-screen">
	<div class="flow-header">
		<a class="back-link" href="/friendlies"><span aria-hidden="true">←</span> Friendlies</a>
		<p class="flow-kicker">FRIENDLY · {detail.hasResult ? 'PLAYED' : 'SCHEDULED'}</p>
		<h1>{detail.low.name} v {detail.high.name}</h1>
		<p class="flow-intro">
			{#if detail.hasResult}
				An informal game, saved as played. Friendlies never enter league tables, stats, highlights or knockout.
			{:else}
				A planned friendly with no result yet. If nothing is saved, the plan is removed five days after
				the scheduled date.
			{/if}
		</p>
		{#if permissions.adminOverride}
			<span class="phase-pill">ADMIN — acting for the players</span>
		{/if}
	</div>

	{#if statusMessage}
		<p class="plan-current" role="status">{statusMessage}</p>
	{/if}
	{#if form?.message}
		<p class="form-error" role="alert">{form.message}</p>
	{/if}

	<div class="flow-form-card">
		<div class="selected-match">
			<FixtureMatchup left={detail.low} right={detail.high} size="md" />
		</div>

		{#if !detail.hasResult}
			<div class="friendly-plan">
				<p class="section-label">THE PLAN</p>
				{#if detail.scheduledDate}
					<p class="plan-line">
						Planned <strong>{formatPlannedDate(detail.scheduledDate, detail.scheduledTime)}</strong>
						{#if detail.expiryDate}
							<span class="expiry-note">
								— removed {formatCalendarDate(detail.expiryDate, { year: true })} if no result is saved
							</span>
						{/if}
					</p>
				{:else}
					<p class="plan-line">No date arranged.</p>
				{/if}
				{#if detail.note}
					<p class="plan-line">“{detail.note}”</p>
				{/if}
				<p class="plan-meta">Arranged by {detail.createdByName ?? 'a player'}.</p>
			</div>

			<div class="form-actions friendly-actions">
				{#if permissions.canRecord}
					<a class="small-primary" href="/friendlies/record?friendly={detail.friendlyId}">Record the result</a>
				{:else if permissions.recordReason}
					<p class="field-hint">{permissions.recordReason}</p>
				{/if}
			</div>

			{#if permissions.canReschedule}
				<details class="reschedule-details">
					<summary>Move to another date</summary>
					<form method="POST" action="?/reschedule">
						<label class="field-label" for="reschedule-date">Scheduled date</label>
						<input
							class="flow-input"
							id="reschedule-date"
							name="date"
							type="date"
							bind:value={date}
							min={data.minDate}
							required
						/>
						<label class="field-label" for="reschedule-time">Scheduled time (optional)</label>
						<input
							class="flow-input"
							id="reschedule-time"
							name="time"
							type="time"
							bind:value={time}
						/>
						<label class="field-label" for="reschedule-note">Note (optional)</label>
						<input
							class="flow-input"
							id="reschedule-note"
							name="note"
							type="text"
							maxlength="200"
							bind:value={note}
						/>
						<div class="form-actions">
							<button class="small-primary" type="submit">Save new date</button>
						</div>
					</form>
				</details>
			{:else if permissions.rescheduleReason}
				<p class="field-hint">{permissions.rescheduleReason}</p>
			{/if}

			{#if permissions.canCancel}
				<form method="POST" action="?/cancel" class="cancel-form">
					<button class="small-secondary" type="submit">Withdraw this plan</button>
				</form>
			{/if}
		{:else}
			<div class="friendly-result">
				<p class="section-label">THE RESULT</p>
				<p class="result-score-line">
					<strong>{detail.low.name} {detail.lowFrames}–{detail.highFrames} {detail.high.name}</strong>
					{#if detail.isDraw}
						<span class="draw-pill">Draw</span>
					{/if}
				</p>
				{#if detail.actualPlayedDate}
					<p class="plan-line">
						Played <time datetime={detail.actualPlayedDate}>
							{formatCalendarDate(detail.actualPlayedDate, { year: true })}
						</time> — saved by {detail.submittedByName ?? 'a player'}.
					</p>
				{/if}
				{#if detail.scheduledDate}
					<p class="plan-meta">
						Planned date on file was {formatPlannedDate(detail.scheduledDate, detail.scheduledTime)} —
						the actual date above stands on its own.
					</p>
				{/if}
				{#if detail.revision !== null && detail.revision > 1}
					<p class="plan-meta">
						Revision {detail.revision} — corrected by {detail.correctedByName ?? 'a player'}.
						{#if detail.correctionReason}“{detail.correctionReason}”{/if}
					</p>
				{/if}
				{#if detail.frames.length > 0}
					<table class="frame-table">
						<caption>Frame-by-frame point scores</caption>
						<thead>
							<tr>
								<th scope="col">Frame</th>
								<th scope="col">{detail.low.name}</th>
								<th scope="col">{detail.high.name}</th>
							</tr>
						</thead>
						<tbody>
							{#each detail.frames as frame (frame.frameNumber)}
								<tr>
									<th scope="row">{frame.frameNumber}</th>
									<td>{frame.lowPoints}</td>
									<td>{frame.highPoints}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
				{#if detail.breaks.length > 0}
					<ul class="break-list">
						{#each detail.breaks as entry (`${entry.playerId}-${entry.breakPoints}`)}
							<li>
								Highest break: <strong>{entry.breakPoints}</strong> ({entry.playerName})
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			<div class="form-actions friendly-actions">
				{#if permissions.canCorrect}
					<a class="small-primary" href="/friendlies/{detail.friendlyId}/correct">
						{isAdmin && !permissions.isParticipant ? 'Correct as admin' : 'Correct this result'}
					</a>
				{:else if permissions.correctReason}
					<p class="field-hint">{permissions.correctReason}</p>
				{/if}
			</div>
		{/if}
	</div>

	{#if detail.history.length > 0}
		<h2 class="section-heading">History</h2>
		<ol class="history-list">
			{#each detail.history as entry (entry.id)}
				<li>
					<strong>{historyLabel(entry.action)}</strong>
					{#if entry.actorName} by {entry.actorName}{/if}
					{#if entry.reason} — “{entry.reason}”{/if}
				</li>
			{/each}
		</ol>
	{/if}

	<p class="flow-footnote">
		Friendlies stay separate from the league: no table points, no stats, no highlights, no knockout
		effect — whatever the score.
	</p>
</section>

<style>
	.section-heading {
		margin: 20px 0 10px;
		font-size: 1.05rem;
	}
	.section-label {
		margin: 12px 0 4px;
		font-size: 0.75rem;
		letter-spacing: 0.08em;
		color: #a9c4a7;
		font-weight: 700;
	}
	.plan-line {
		margin: 4px 0;
	}
	.plan-meta {
		margin: 4px 0 0;
		color: #cfe3cd;
		font-size: 0.9rem;
	}
	.expiry-note {
		color: #cfe3cd;
		font-size: 0.9rem;
	}
	.friendly-actions {
		margin-top: 12px;
	}
	.reschedule-details {
		margin-top: 16px;
		border-top: 1px solid rgba(169, 196, 167, 0.28);
		padding-top: 12px;
	}
	.reschedule-details summary {
		cursor: pointer;
		font-weight: 600;
	}
	.cancel-form {
		margin-top: 12px;
	}
	.result-score-line {
		font-size: 1.2rem;
		margin: 4px 0;
	}
	.draw-pill {
		display: inline-block;
		margin-left: 8px;
		padding: 1px 10px;
		border-radius: 999px;
		border: 1px solid rgba(169, 196, 167, 0.5);
		font-size: 0.8rem;
		vertical-align: middle;
	}
	.frame-table {
		margin-top: 12px;
		border-collapse: collapse;
		width: 100%;
		max-width: 420px;
	}
	.frame-table caption {
		text-align: left;
		padding-bottom: 6px;
		color: #cfe3cd;
		font-size: 0.9rem;
	}
	.frame-table th,
	.frame-table td {
		border: 1px solid rgba(169, 196, 167, 0.28);
		padding: 6px 10px;
		text-align: left;
	}
	.break-list {
		margin: 10px 0 0;
		padding-left: 20px;
	}
	.history-list {
		margin: 0;
		padding-left: 20px;
		display: grid;
		gap: 6px;
	}
</style>
