<script lang="ts">
	import FixtureMatchup from '$lib/components/FixtureMatchup.svelte';
	import ResultEntryForm from '$lib/components/ResultEntryForm.svelte';
	import { formatCalendarDate, formatPlannedDate, formatShortDate } from '$lib/format';
	import type { ResultFormValues } from '$lib/result-entry';
	import type { PageData } from './$types';

	let { data, form }: { data: PageData; form: Record<string, unknown> | null } = $props();

	const fixture = $derived(data.fixture);
	const record = $derived(data.record);
	const permissions = $derived(data.permissions);

	const emptyValues = $derived.by<ResultFormValues>(() => ({
		actualPlayedDate: '',
		frameWinners: Array.from({ length: data.framesPerMatch }, () => ''),
		framePoints: Array.from({ length: data.framesPerMatch }, () => ({ low: '', high: '' })),
		breaks: { low: '', high: '' }
	}));

	// A failed post comes back with what the player typed; a resubmission comes
	// back with what they submitted before. Never the planned date.
	const values = $derived.by<ResultFormValues>(() => {
		const posted = form?.values as ResultFormValues | null | undefined;
		if (posted) return posted;
		return data.mode === 'resubmit' && data.draft ? data.draft : emptyValues;
	});

	const serverErrors = $derived((form?.errors as string[] | undefined) ?? []);
	const serverWarnings = $derived((form?.warnings as string[] | undefined) ?? []);
	const needsAck = $derived(Boolean(form?.needsAck));

	const title = $derived(
		data.mode === 'resubmit'
			? 'Correct and resubmit'
			: fixture.state === 'closed_unplayed'
				? 'Record a retrospective result'
				: 'Record the match'
	);
	const intro = $derived(
		data.mode === 'resubmit'
			? 'Fix what your opponent asked you to check, then send it back for confirmation.'
			: `Enter the ${data.framesPerMatch} frame winners and the day you actually played. Nothing enters the table until your opponent confirms it.`
	);
	const correctionNote = $derived.by(() => {
		if (data.mode !== 'resubmit' || !record) return null;
		const who = record.sentBackByName ?? 'Your opponent';
		return record.sendBackReason
			? `${who} sent this back: “${record.sendBackReason}”. Check the scoreline and the actual date, then resubmit.`
			: `${who} sent this back for correction. Check the scoreline and the actual date, then resubmit.`;
	});
	const plannedDateNote = $derived(
		fixture.plannedDate
			? `Planned date on file: ${formatPlannedDate(fixture.plannedDate.date, fixture.plannedDate.time)} — a plan is not proof of play, so enter the day you actually played.${
					fixture.plannedDate.afterWindow
						? ' That plan is after this round’s window, so the fixture closes neutrally unless a genuine result is recorded in time.'
						: ''
				}`
			: null
	);
	const submitLabel = $derived(
		data.mode === 'resubmit'
			? 'Resubmit for confirmation'
			: fixture.state === 'closed_unplayed'
				? 'Save retrospective result'
				: 'Submit to opponent →'
	);
	const cancelHref = $derived(
		record && record.status !== 'sent_back' ? `/fixtures/${fixture.fixtureId}` : `/fixtures`
	);
</script>

<svelte:head>
	<title>Minsnooks · {title}</title>
</svelte:head>

<section class="flow-screen">
	<div class="flow-header">
		<a class="back-link" href="/fixtures/{fixture.fixtureId}">
			<span aria-hidden="true">←</span> Fixture
		</a>
		<p class="flow-kicker">
			ROUND {fixture.roundNumber} · {data.season.label} SEASON · LEAGUE RESULT
		</p>
		<h1>{title}</h1>
		<p class="flow-intro">{intro}</p>
		{#if permissions.adminOverride}
			<span class="phase-pill">ADMIN — acting for the players</span>
		{/if}
	</div>

	<div class="flow-form-card">
		<div class="selected-match">
			<FixtureMatchup left={fixture.low} right={fixture.high} size="md" />
		</div>

		{#if data.mode === 'blocked'}
			<div class="placeholder-card">
				<strong>This result cannot be recorded here.</strong>
				{data.blockedReason}
				{#if record}
					<p class="plan-meta">
						Current state: <strong>{record.status.replace('_', ' ')}</strong>
						{#if record.status === 'submitted'}
							— {record.winner.name} {record.winnerFrames}–{record.loserFrames} {record.loser.name},
							played {formatShortDate(record.actualPlayedDate)}, submitted by {record.submittedByName}.
							It is not in the league table until it is confirmed.
						{:else if record.status === 'confirmed'}
							— {record.winner.name} {record.winnerFrames}–{record.loserFrames} {record.loser.name},
							played {formatShortDate(record.actualPlayedDate)}.
						{/if}
					</p>
				{/if}
			</div>

			{#if permissions.canReview}
				<div class="form-actions">
					<a class="small-secondary" href="/fixtures/{fixture.fixtureId}">Back to the fixture</a>
					<a class="small-primary" href="/fixtures/{fixture.fixtureId}/review">Review the result</a>
				</div>
			{:else if permissions.canCorrect}
				<div class="form-actions">
					<a class="small-secondary" href="/fixtures/{fixture.fixtureId}">Back to the fixture</a>
					<a class="small-primary" href="/fixtures/{fixture.fixtureId}/correct">Correct as admin</a>
				</div>
			{:else}
				<div class="form-actions">
					<a class="small-secondary" href="/fixtures/{fixture.fixtureId}">Back to the fixture</a>
					<a class="small-primary" href="/fixtures">All fixtures</a>
				</div>
			{/if}
		{:else}
			{#if record && data.mode === 'resubmit'}
				<p class="plan-current">
					Previously submitted (revision {record.revision}):
					<strong>
						{record.winner.name} {record.winnerFrames}–{record.loserFrames} {record.loser.name}
					</strong>, played {formatShortDate(record.actualPlayedDate)}.
				</p>
			{/if}

			<ResultEntryForm
				action="?/submit"
				lowPlayerId={fixture.low.playerId}
				highPlayerId={fixture.high.playerId}
				lowName={fixture.low.name}
				highName={fixture.high.name}
				framesPerMatch={data.framesPerMatch}
				timeZone={data.timeZone}
				today={data.today}
				minDate={data.minDate}
				maxDate={data.maxDate}
				{values}
				{serverErrors}
				{serverWarnings}
				{needsAck}
				locked={data.locked}
				submitLabel={submitLabel}
				cancelHref={cancelHref}
				cancelLabel={data.mode === 'resubmit' ? 'Back to the fixture' : 'Cancel'}
				directOption={{ allowed: permissions.canEnterDirectly }}
				reason={fixture.state === 'closed_unplayed' || permissions.adminOverride
					? {
							label: 'Reason for this entry',
							hint:
								fixture.state === 'closed_unplayed'
									? 'A retrospective result for a closed fixture is an admin decision, so the reason is recorded with it.'
									: 'You are recording this for the players, so the audit trail records why.',
							value: '',
							required: fixture.state === 'closed_unplayed'
						}
					: null}
				{plannedDateNote}
				{correctionNote}
			/>

			<p class="flow-footnote">
				Your opponent confirms the scoreline <em>and</em> the actual date played together. Until then the
				result stays out of the league table, and the round cannot advance.
			</p>
		{/if}
	</div>

	{#if data.lastPlayableDate}
		<p class="flow-footnote">
			Round {fixture.roundNumber} accepts results for matches played up to
			{formatCalendarDate(data.lastPlayableDate, { year: true })} (deadline plus
			{data.round.graceDays} day{data.round.graceDays === 1 ? '' : 's'}’ grace). After that, unplayed
			fixtures close neutrally — never as a 0–0.
		</p>
	{/if}
</section>
