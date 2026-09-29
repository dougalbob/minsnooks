<script lang="ts">
	import FixtureMatchup from '$lib/components/FixtureMatchup.svelte';
	import FriendlyEntryForm from '$lib/components/FriendlyEntryForm.svelte';
	import type { FriendlyFormValues } from '$lib/friendly-entry';
	import type { PageData } from './$types';

	let { data, form }: { data: PageData; form: Record<string, unknown> | null } = $props();

	const emptyValues = $derived.by<FriendlyFormValues>(() => ({
		actualPlayedDate: '',
		lowFrames: '',
		highFrames: '',
		framePoints: [],
		breaks: { low: '', high: '' }
	}));

	const values = $derived.by<FriendlyFormValues>(() => {
		const posted = form?.values as FriendlyFormValues | null | undefined;
		if (posted) return posted;
		return emptyValues;
	});

	const serverErrors = $derived((form?.errors as string[] | undefined) ?? []);
	const serverWarnings = $derived((form?.warnings as string[] | undefined) ?? []);
	const needsAck = $derived(Boolean(form?.needsAck));

	const title = $derived(data.mode === 'scheduled' ? 'Record the friendly' : 'Record a played friendly');
	const intro = $derived(
		data.mode === 'scheduled'
			? 'Enter the frame totals and the day you actually played. The result is saved immediately — there is no opponent approval for friendlies.'
			: 'Choose who you played, then enter the frame totals and the day you actually played.'
	);
	let opponentChoice = $state('');
</script>

<svelte:head>
	<title>Minsnooks · {title}</title>
</svelte:head>

<section class="flow-screen">
	<div class="flow-header">
		<a class="back-link" href="/friendlies"><span aria-hidden="true">←</span> Friendlies</a>
		<p class="flow-kicker">FRIENDLY · SAVED RESULT</p>
		<h1>{title}</h1>
		<p class="flow-intro">{intro}</p>
	</div>

	<div class="flow-form-card">
		{#if data.mode === 'blocked' || !data.low || !data.high}
			{#if data.mode === 'blocked'}
				<div class="placeholder-card">
					<strong>This friendly cannot be recorded here.</strong>
					{data.blockedReason}
				</div>
				<div class="form-actions">
					<a class="small-secondary" href="/friendlies">Back to friendlies</a>
					{#if data.friendlyId !== null}
						<a class="small-primary" href="/friendlies/{data.friendlyId}">Open the friendly</a>
					{/if}
				</div>
			{:else}
				{#if data.blockedReason}
					<div class="placeholder-card">
						<strong>This cannot be recorded here.</strong>
						{data.blockedReason}
					</div>
				{:else}
					<form method="GET" action="/friendlies/record">
						<label class="field-label" for="opponent-choice">Who did you play?</label>
						<select
							class="flow-input"
							id="opponent-choice"
							name="opponent"
							bind:value={opponentChoice}
							required
						>
							<option value="">Choose a league player…</option>
							{#each data.opponents as opponent (opponent.playerId)}
								<option value={opponent.playerId}>{opponent.name}</option>
							{/each}
						</select>
						<div class="form-actions">
							<a class="small-secondary" href="/friendlies">Cancel</a>
							<button class="small-primary" type="submit">Choose players</button>
						</div>
					</form>
				{/if}
			{/if}
		{:else}
			<div class="selected-match">
				<FixtureMatchup left={data.low} right={data.high} size="md" />
			</div>

			<FriendlyEntryForm
				action="?/record"
				lowPlayerId={data.low.playerId}
				highPlayerId={data.high.playerId}
				lowName={data.low.name}
				highName={data.high.name}
				today={data.today}
				maxDate={data.today}
				{values}
				{serverErrors}
				{serverWarnings}
				{needsAck}
				submitLabel="Save friendly result"
				cancelHref="/friendlies"
				scheduledDateNote={data.scheduledDateNote}
				friendlyId={data.friendlyId}
				opponentId={data.mode === 'direct' && data.viewer
					? data.low.playerId === data.viewer.playerId
						? data.high.playerId
						: data.low.playerId
					: null}
			/>
		{/if}
	</div>

	<p class="flow-footnote">
		Friendlies never enter the league tables, stats, highlights or knockout. Either player may
		correct a saved friendly afterwards.
	</p>
</section>
