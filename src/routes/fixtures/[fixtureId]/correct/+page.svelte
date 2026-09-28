<script lang="ts">
	import FixtureMatchup from '$lib/components/FixtureMatchup.svelte';
	import ResultEntryForm from '$lib/components/ResultEntryForm.svelte';
	import ResultSummaryCard from '$lib/components/ResultSummaryCard.svelte';
	import { auditActionLabel } from '$lib/result-view';
	import { formatInstantInZone } from '$lib/format';
	import type { ResultFormValues } from '$lib/result-entry';
	import type { PageData } from './$types';

	let { data, form }: { data: PageData; form: Record<string, unknown> | null } = $props();

	const fixture = $derived(data.fixture);
	const record = $derived(data.record);

	const values = $derived.by<ResultFormValues>(() => {
		const posted = form?.values as ResultFormValues | null | undefined;
		if (posted) return posted;
		return (
			data.draft ?? {
				actualPlayedDate: '',
				frameWinners: Array.from({ length: data.framesPerMatch }, () => ''),
				framePoints: Array.from({ length: data.framesPerMatch }, () => ({ low: '', high: '' })),
				breaks: { low: '', high: '' }
			}
		);
	});
	const serverErrors = $derived((form?.errors as string[] | undefined) ?? []);
	const serverWarnings = $derived((form?.warnings as string[] | undefined) ?? []);
	const needsAck = $derived(Boolean(form?.needsAck));
</script>

<svelte:head>
	<title>Minsnooks · Correct result · {fixture.low.name} v {fixture.high.name}</title>
</svelte:head>

<section class="flow-screen">
	<div class="flow-header">
		<a class="back-link" href="/fixtures/{fixture.fixtureId}">
			<span aria-hidden="true">←</span> Fixture
		</a>
		<p class="flow-kicker">
			ROUND {fixture.roundNumber} · {data.season.label} SEASON · ADMIN CORRECTION
		</p>
		<h1>Change a confirmed result</h1>
		<p class="flow-intro">
			After approval only an admin can change a result. The reason is mandatory, the original
			confirmation stays on record, and the audit trail keeps the before and after.
		</p>
		<span class="phase-pill">ADMIN ONLY</span>
	</div>

	<div class="flow-form-card">
		<div class="selected-match">
			<FixtureMatchup left={fixture.low} right={fixture.high} size="md" />
		</div>

		{#if !data.canCorrectHere || !record}
			<div class="placeholder-card">
				<strong>Nothing to correct here.</strong>
				{#if record && record.status !== 'confirmed'}
					This result is {record.status === 'submitted'
						? 'waiting for the opponent to confirm it — corrections belong to the players until then'
						: 'sent back for correction — the player who submitted it fixes it'}.
				{:else}
					{data.blockedReason ?? 'Only a confirmed result can be corrected by an admin.'}
				{/if}
			</div>
			<div class="form-actions">
				<a class="small-secondary" href="/fixtures/{fixture.fixtureId}">Back to the fixture</a>
				{#if record?.status === 'submitted' && data.permissions.canReview}
					<a class="small-primary" href="/fixtures/{fixture.fixtureId}/review">Review the result</a>
				{:else}
					<a class="small-primary" href="/fixtures">All fixtures</a>
				{/if}
			</div>
		{:else}
			<ResultSummaryCard {record} timeZone={data.timeZone} heading="CURRENTLY CONFIRMED" />

			{#if record.isAwardSource}
				<p class="field-warning" role="status">
					An administrative award takes its table points from this result. Correcting it flags that
					award for review rather than silently rewriting a later table.
				</p>
			{/if}

			<p class="plan-current">
				Correction {record.revision + 1} of this result. The confirmation by
				{record.confirmedByName ?? 'an admin'} stays on record; your change is recorded against your
				name.
			</p>

			<ResultEntryForm
				action="?/correct"
				formId="correction-form"
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
				submitLabel="Save correction"
				cancelHref="/fixtures/{fixture.fixtureId}"
				reason={{
					label: 'Why is this result being changed?',
					hint:
						'Mandatory after approval. Recorded with your name and the time, alongside the before and after values.',
					value: '',
					required: true
				}}
			/>

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
		{/if}
	</div>

	<p class="flow-footnote">
		Corrections never rewrite history silently: the league table recalculates from the corrected
		result, and every change stays in the audit trail.
	</p>
</section>
