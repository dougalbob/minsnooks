<script lang="ts">
	import KnockoutResultForm from '$lib/components/KnockoutResultForm.svelte';
	import type { PageData } from './$types';
	import type { KnockoutResultFormValues } from '$lib/knockout-progression';

	let { data, form }: { data: PageData; form: Record<string, unknown> | null } = $props();

	const values = $derived.by<KnockoutResultFormValues>(() => {
		const posted = form?.values as KnockoutResultFormValues | null | undefined;
		if (posted) return posted;
		return data.values;
	});
	const serverErrors = $derived((form?.errors as string[] | undefined) ?? []);

	const title = $derived(data.correcting ? 'Correct the knockout result' : 'Record the knockout result');
	const tieLabel = $derived(`tie ${data.tie.tieNumber}`);
</script>

<svelte:head>
	<title>Minsnooks · {title}</title>
</svelte:head>

<section class="flow-screen">
	<div class="flow-header">
		<a class="back-link" href="/knockout#competition-{data.tie.competitionId}">
			<span aria-hidden="true">←</span> Knockout
		</a>
		<p class="flow-kicker">KNOCKOUT · {data.correcting ? 'CORRECTION' : 'SAVED RESULT'}</p>
		<h1>{title}</h1>
		<p class="flow-intro">
			{#if data.correcting}
				Re-enter the frames exactly as they finished. The correction replaces the saved result and is
				written to the audit trail
				{#if data.reasonRequired}with your reason{:else}— no reason needed for your own match{/if}.
			{:else}
				Enter the frames in order — play stops at {data.tie.framesToWin}. The result is saved
				immediately; knockout matches have no opponent-approval step.
			{/if}
		</p>
	</div>

	<div class="flow-form-card">
		{#if !data.canAct}
			{#if data.blockReason}
				<div class="placeholder-card">
					<strong>This result cannot be {data.correcting ? 'corrected' : 'recorded'} here.</strong>
					{data.blockReason}
				</div>
			{:else}
				<div class="placeholder-card">
					<strong>Only the two players in this tie (or an admin) can {data.correcting ? 'correct' : 'record'} this match.</strong>
					Switch to one of the participants in the DEV PREVIEW chooser to walk this journey.
				</div>
			{/if}
			<div class="form-actions">
				<a class="small-secondary" href="/knockout">Back to the knockout</a>
			</div>
		{:else}
			<KnockoutResultForm
				action="?/default"
				competitionId={data.tie.competitionId}
				competitionTitle={data.tie.competitionTitle}
				stageNumber={data.tie.stageNumber}
				tieLabel={tieLabel}
				lowPlayerId={data.tie.playerLow.playerId}
				highPlayerId={data.tie.playerHigh.playerId}
				lowName={data.tie.playerLow.name}
				highName={data.tie.playerHigh.name}
				framesToWin={data.tie.framesToWin}
				maxFrames={data.maxFrames}
				today={data.today}
				{values}
				serverErrors={serverErrors}
				correcting={data.correcting}
				reason={
					data.reasonRequired
						? {
								label: 'Reason for the correction',
								hint: 'You are changing another player’s saved result — the audit trail records why.',
								value: String(form?.reason ?? ''),
								required: true
							}
						: data.correcting
							? {
									label: 'What changed? (optional)',
									hint: 'Optional for your own match — a note helps the trail if you spot it later.',
									value: String(form?.reason ?? ''),
									required: false
								}
							: null
				}
				submitLabel={data.correcting ? 'Save correction' : 'Save result'}
				cancelHref="/knockout"
			/>
		{/if}
	</div>

	<p class="flow-footnote">No fixed stage deadlines — arrange the date that suits you both. Knockout results never add league points or stats.</p>
</section>
