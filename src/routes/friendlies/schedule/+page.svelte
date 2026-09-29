<script lang="ts">
	import { untrack } from 'svelte';
	import type { PageData } from './$types';

	let { data, form }: { data: PageData; form: { message?: string } | null } = $props();

	const initial = untrack(() => ({ date: data.minDate, time: '16:00', note: '' }));
	let opponentId = $state('');
	let date = $state(initial.date);
	let time = $state(initial.time);
	let note = $state(initial.note);
</script>

<svelte:head>
	<title>Minsnooks · Arrange a friendly</title>
</svelte:head>

<section class="flow-screen">
	<div class="flow-header">
		<a class="back-link" href="/friendlies"><span aria-hidden="true">←</span> Friendlies</a>
		<p class="flow-kicker">FRIENDLY · SCHEDULED PLAN</p>
		<h1>Arrange a friendly</h1>
		<p class="flow-intro">
			Pick an opponent and a date. There are no reminders and no approval step — if you play, either
			of you records the result afterwards.
		</p>
	</div>

	{#if form?.message}
		<p class="form-error" role="alert">{form.message}</p>
	{/if}

	<div class="flow-form-card">
		{#if !data.canSchedule}
			<div class="placeholder-card">
				<strong>This cannot be arranged here.</strong>
				{data.scheduleReason}
			</div>
			<div class="form-actions">
				<a class="small-secondary" href="/friendlies">Back to friendlies</a>
			</div>
		{:else if data.opponents.length === 0}
			<div class="placeholder-card">
				<strong>No opponents available.</strong>
				Friendlies need two registered league players.
			</div>
			<div class="form-actions">
				<a class="small-secondary" href="/friendlies">Back to friendlies</a>
			</div>
		{:else}
			<form method="POST" action="?/schedule">
				<label class="field-label" for="opponent">Opponent</label>
				<select class="flow-input" id="opponent" name="opponentId" bind:value={opponentId} required>
					<option value="">Choose a league player…</option>
					{#each data.opponents as opponent (opponent.playerId)}
						<option value={opponent.playerId}>{opponent.name}</option>
					{/each}
				</select>
				<label class="field-label" for="planned-date">Scheduled date</label>
				<input
					class="flow-input"
					id="planned-date"
					name="date"
					type="date"
					bind:value={date}
					min={data.minDate}
					required
				/>
				<label class="field-label" for="planned-time">Scheduled time (optional)</label>
				<select class="flow-input" id="planned-time" name="time" bind:value={time}>
					<option value="">No particular time</option>
					<option value="10:00">10:00 am</option>
					<option value="14:00">2:00 pm</option>
					<option value="16:00">4:00 pm</option>
					<option value="18:00">6:00 pm</option>
					<option value="19:00">7:00 pm</option>
					<option value="19:30">7:30 pm</option>
					<option value="20:00">8:00 pm</option>
				</select>
				<label class="field-label" for="planned-note">Note for the other player (optional)</label>
				<input
					class="flow-input"
					id="planned-note"
					name="note"
					type="text"
					maxlength="200"
					placeholder="e.g. At the club, snooker table 2"
					bind:value={note}
				/>
				<p class="field-hint">
					This is a plan only ({data.timezone}). The actual date played is entered separately with the
					result.
				</p>
				<div class="form-actions">
					<a class="small-secondary" href="/friendlies">Cancel</a>
					<button class="small-primary" type="submit">Save friendly plan</button>
				</div>
			</form>
		{/if}
	</div>

	<p class="flow-footnote">
		If no result is saved, the plan is removed five days after the scheduled date — even if you
		rearranged offline. You can always arrange another later.
	</p>
</section>
