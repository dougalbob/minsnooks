<script lang="ts">
	import FixtureMatchup from '$lib/components/FixtureMatchup.svelte';
	import FriendlyEntryForm from '$lib/components/FriendlyEntryForm.svelte';
	import type { FriendlyFormValues } from '$lib/friendly-entry';
	import type { PageData } from './$types';

	let { data, form }: { data: PageData; form: Record<string, unknown> | null } = $props();

	const detail = $derived(data.detail);
	const permissions = $derived(data.permissions);

	const values = $derived.by<FriendlyFormValues>(() => {
		const posted = form?.values as FriendlyFormValues | null | undefined;
		if (posted) return posted;
		return data.draft;
	});

	const serverErrors = $derived((form?.errors as string[] | undefined) ?? []);
	const serverWarnings = $derived((form?.warnings as string[] | undefined) ?? []);
	const needsAck = $derived(Boolean(form?.needsAck));
</script>

<svelte:head>
	<title>Minsnooks · Correct friendly</title>
</svelte:head>

<section class="flow-screen">
	<div class="flow-header">
		<a class="back-link" href="/friendlies/{detail.friendlyId}">
			<span aria-hidden="true">←</span> Friendly
		</a>
		<p class="flow-kicker">FRIENDLY · CORRECTION</p>
		<h1>Correct this friendly</h1>
		<p class="flow-intro">
			Fix the totals, the date or the optional details. The change is recorded in the friendly’s
			history — nothing here can move a league table.
		</p>
		{#if permissions.adminOverride}
			<span class="phase-pill">ADMIN — acting for the players</span>
		{/if}
	</div>

	<div class="flow-form-card">
		<div class="selected-match">
			<FixtureMatchup left={detail.low} right={detail.high} size="md" />
		</div>

		{#if !permissions.canCorrect}
			<div class="placeholder-card">
				<strong>This friendly cannot be corrected here.</strong>
				{data.blockedReason}
			</div>
			<div class="form-actions">
				<a class="small-secondary" href="/friendlies/{detail.friendlyId}">Back to the friendly</a>
			</div>
		{:else}
			<FriendlyEntryForm
				action="?/correct"
				lowPlayerId={detail.low.playerId}
				highPlayerId={detail.high.playerId}
				lowName={detail.low.name}
				highName={detail.high.name}
				today={data.today}
				maxDate={data.today}
				{values}
				{serverErrors}
				{serverWarnings}
				{needsAck}
				submitLabel="Save correction"
				cancelHref="/friendlies/{detail.friendlyId}"
				cancelLabel="Back to the friendly"
				reason={{
					label: 'Reason for this correction',
					hint: data.reasonRequired
						? 'You are correcting this for the players, so the audit trail records why.'
						: 'Optional — a short note helps the other player understand the change.',
					value: '',
					required: data.reasonRequired
				}}
			/>
		{/if}
	</div>
</section>
