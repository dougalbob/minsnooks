<script lang="ts">
	import ResultSummaryCard from '$lib/components/ResultSummaryCard.svelte';
	import { auditActionLabel } from '$lib/result-view';
	import { formatInstantInZone, formatShortDate } from '$lib/format';
	import type { PageData } from './$types';

	let { data, form }: { data: PageData; form: { message?: string; reason?: string } | null } = $props();

	const fixture = $derived(data.fixture);
	const record = $derived(data.record);
	const permissions = $derived(data.permissions);
	const sendBackReason = $derived(form?.reason ?? '');

	const reviewerCopy = $derived.by(() => {
		if (!record) return '';
		return `${record.submittedByName} submitted this result. Confirm the scoreline and the actual date played together, or send it back for correction.`;
	});
</script>

<svelte:head>
	<title>Minsnooks · Review result · {fixture.low.name} v {fixture.high.name}</title>
</svelte:head>

<section class="flow-screen">
	<div class="flow-header">
		<a class="back-link" href="/fixtures/{fixture.fixtureId}">
			<span aria-hidden="true">←</span> Fixture
		</a>
		<p class="flow-kicker">
			ROUND {fixture.roundNumber} · {data.season.label} SEASON · RESULT REVIEW
		</p>
		<h1>
			{#if record?.status === 'confirmed'}
				Nicely done.
			{:else if record?.status === 'sent_back'}
				Sent back for correction
			{:else}
				Check the result
			{/if}
		</h1>
		<p class="flow-intro">
			{#if record?.status === 'submitted'}
				{reviewerCopy}
			{:else if record?.status === 'confirmed'}
				The result and the actual date played have been confirmed, so this match now counts in the
				league table.
			{:else if record?.status === 'sent_back'}
				This result was sent back and is out of the table until a corrected version is confirmed.
			{:else}
				There is nothing to review yet: a result has to be submitted before the other player can
				confirm it.
			{/if}
		</p>
	</div>

	{#if data.flash}
		<p class="lifecycle-flash" role="status">{data.flash}</p>
	{/if}
	{#if form?.message}
		<p class="form-error" role="alert">{form.message}</p>
	{/if}

	{#if record}
		{#if record.status === 'confirmed'}
			<div class="flow-success-card">
				<span class="success-mark" aria-hidden="true">✓</span>
				<p class="section-label">CONFIRMED RESULT</p>
				<h2>
					{record.winner.name} {record.winnerFrames} — {record.loserFrames} {record.loser.name}
				</h2>
				<p>Played {formatShortDate(record.actualPlayedDate)}</p>
				<p class="flow-disclaimer">
					Confirmed by {record.confirmedByName ?? 'an admin'}
					{formatInstantInZone(record.confirmedAt, data.timeZone) ?? ''}. Only confirmed results
					count towards the round and season tables.
				</p>
				<div class="form-actions review-actions">
					<a class="small-secondary" href="/fixtures/{fixture.fixtureId}">Fixture</a>
					<a class="small-primary" href="/">Back to the round table</a>
				</div>
			</div>
		{/if}

		<ResultSummaryCard {record} timeZone={data.timeZone} showStatus={record.status !== 'confirmed'} />

		{#if record.status === 'submitted'}
			{#if permissions.canReview}
				<p class="confirm-hint">
					Confirm only if the frame result <strong>and</strong> the actual date played are both correct.
					Confirming puts the result in the league table; a submission on its own never does.
					{#if permissions.adminOverride}
						You are doing this as an admin, not as the opponent — the audit trail records that.
					{/if}
				</p>
				<div class="review-action-stack">
					<form method="POST" action="?/confirm">
						<button class="small-primary" type="submit">Confirm result &amp; date</button>
					</form>

					<details class="send-back-details">
						<summary>Send back for correction</summary>
						<form method="POST" action="?/sendBack">
							<label class="field-label" for="send-back-reason">
								What should {record.submittedByName} check? (optional)
							</label>
							<input
								class="flow-input"
								id="send-back-reason"
								name="reason"
								type="text"
								maxlength="300"
								value={sendBackReason}
								placeholder="e.g. I had frame 2 as 65–47, and we played on the Friday"
							/>
							<p class="field-hint">
								Sending it back changes nothing in the table. The submitter corrects it and
								resubmits, and you see the new version here.
							</p>
							<div class="form-actions review-actions">
								<button class="small-secondary danger" type="submit">Send back</button>
							</div>
						</form>
					</details>
				</div>
			{:else}
				<div class="placeholder-card">
					<strong>You cannot review this submission.</strong>
					{permissions.reviewReason ?? 'Only the other player can confirm or send back this result.'}
				</div>
				<div class="form-actions">
					<a class="small-secondary" href="/fixtures/{fixture.fixtureId}">Back to the fixture</a>
					{#if permissions.canResubmit}
						<a class="small-primary" href="/fixtures/{fixture.fixtureId}/record">Correct and resubmit</a>
					{/if}
				</div>
			{/if}
		{:else if record.status === 'sent_back'}
			<div class="placeholder-card">
				<strong>Waiting for a corrected submission.</strong>
				{#if record.sendBackReason}
					{record.sentBackByName ?? 'The reviewer'} asked: “{record.sendBackReason}”.
				{/if}
				{permissions.canResubmit
					? 'You can correct the scoreline or the actual date and resubmit it.'
					: (permissions.resubmitReason ?? 'Only the player who submitted it can correct it.')}
			</div>
			<div class="form-actions">
				<a class="small-secondary" href="/fixtures/{fixture.fixtureId}">Back to the fixture</a>
				{#if permissions.canResubmit}
					<a class="small-primary" href="/fixtures/{fixture.fixtureId}/record">Correct and resubmit</a>
				{/if}
			</div>
		{:else}
			<div class="form-actions">
				<a class="small-secondary" href="/fixtures/{fixture.fixtureId}">Back to the fixture</a>
				{#if permissions.canCorrect}
					<a class="small-primary" href="/fixtures/{fixture.fixtureId}/correct">Correct as admin</a>
				{/if}
			</div>
		{/if}

		{#if data.audit.length > 0}
			<details class="plan-history" open>
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
	{:else}
		<div class="placeholder-card">
			<strong>No result submitted yet.</strong>
			{#if permissions.canSubmit}
				One of the two players records the three frame winners and the day the match was actually
				played; the other confirms it here.
			{:else}
				{permissions.submitReason ?? 'Nothing can be recorded for this fixture.'}
			{/if}
		</div>
		<div class="form-actions">
			<a class="small-secondary" href="/fixtures/{fixture.fixtureId}">Back to the fixture</a>
			{#if permissions.canSubmit || permissions.canEnterDirectly}
				<a class="small-primary" href="/fixtures/{fixture.fixtureId}/record">Record the result</a>
			{/if}
		</div>
	{/if}

	<p class="flow-footnote">
		A planned date is never treated as a played date: the actual date is entered with the result and
		confirmed here, together with the scoreline.
	</p>
</section>
