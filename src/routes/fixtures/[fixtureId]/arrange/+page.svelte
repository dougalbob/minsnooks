<script lang="ts">
	import FixtureMatchup from '$lib/components/FixtureMatchup.svelte';
	import { untrack } from 'svelte';
	import { formatCalendarDate, formatPlannedDate } from '$lib/format';
	import type { PageData } from './$types';

	let { data, form }: { data: PageData; form: { message?: string } | null } = $props();

	// Initial form values are a one-off snapshot of the load data (untrack: the
	// fields are user-editable state from then on and never rewrite the fixture).
	const initial = untrack(() => ({
		date: data.active?.proposedDate ?? data.minDate,
		time: data.active?.proposedTime ?? '16:00',
		note: data.active?.note ?? ''
	}));
	let date = $state(initial.date);
	let time = $state(initial.time);
	let note = $state(initial.note);

	const afterWindow = $derived(
		Boolean(data.fixture.lastPlayableDate && date && date > data.fixture.lastPlayableDate)
	);
</script>

<svelte:head>
	<title>Minsnooks · Arrange a date</title>
</svelte:head>

<section class="flow-screen">
	<div class="flow-header">
		<a class="back-link" href="/fixtures/{data.fixture.fixtureId}">
			<span aria-hidden="true">←</span> Fixture
		</a>
		<p class="flow-kicker">ROUND {data.fixture.roundNumber} · PLANNED DATE</p>
		<h1>{data.active ? 'Change the planned date' : 'Arrange a date'}</h1>
		<p class="flow-intro">
			Suggest a time that works for both players. You can still record a match without booking first.
		</p>
	</div>

	{#if form?.message}
		<p class="form-error" role="alert">{form.message}</p>
	{/if}

	<div class="flow-form-card">
		<div class="selected-match">
			<FixtureMatchup left={data.fixture.low} right={data.fixture.high} size="md" />
		</div>

		{#if data.active}
			<p class="plan-current">
				Currently planned: <strong>{formatPlannedDate(data.active.proposedDate, data.active.proposedTime)}</strong>
				— proposed by {data.active.proposedByName}. Saving a new date keeps this one in the history.
			</p>
		{/if}

		{#if data.opponentContact}
			<div class="opponent-contact-card">
				<p class="section-label">OPPONENT CONTACT</p>
				<p class="contact-name">{data.opponentContact.name}</p>
				{#if data.opponentContact.email || data.opponentContact.phone}
					<div class="contact-details-row">
						{#if data.opponentContact.email}
							<span class="contact-chip">
								<span class="contact-label">Email:</span>
								<a class="contact-link" href="mailto:{data.opponentContact.email}">{data.opponentContact.email}</a>
							</span>
						{/if}
						{#if data.opponentContact.phone}
							<span class="contact-chip">
								<span class="contact-label">Phone:</span>
								<a class="contact-link" href="tel:{data.opponentContact.phone}">{data.opponentContact.phone}</a>
							</span>
						{/if}
						{#if data.opponentContact.adminViewOnly}
							<span class="contact-admin-notice">
								(Admin view: player hid details from league members)
							</span>
						{/if}
					</div>
				{:else if data.opponentContact.isHidden}
					<p class="contact-hidden-notice">
						🔒 Contact details hidden by player. An administrator can help coordinate your match.
					</p>
				{/if}
			</div>
		{/if}

		{#if data.canArrange}
			<form method="POST" action="?/propose">
				<label class="field-label" for="planned-date">Planned date</label>
				<input
					class="flow-input"
					id="planned-date"
					name="date"
					type="date"
					bind:value={date}
					min={data.minDate}
					required
				/>
				<label class="field-label" for="planned-time">Planned time (optional)</label>
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
					This is a planned date only ({data.timeZone}). The actual date played is entered separately with the
					result, and is confirmed by your opponent.
				</p>
				{#if afterWindow}
					<p class="field-warning" role="status">
						{formatCalendarDate(date, { year: true })} is after this round’s deadline and grace window (up to
						{data.fixture.lastPlayableDate
							? formatCalendarDate(data.fixture.lastPlayableDate, { year: true })
							: 'the deadline'}). You can still save it, but the fixture closes neutrally unless a genuine result
						is recorded first.
					</p>
				{/if}
				<div class="form-actions">
					<a class="small-secondary" href="/fixtures/{data.fixture.fixtureId}">Cancel</a>
					<button class="small-primary" type="submit">
						{data.active ? 'Save new date' : 'Send date proposal'}
					</button>
				</div>
			</form>
		{:else}
			<div class="placeholder-card">
				<strong>You cannot arrange this date.</strong>
				{data.arrangeBlockedReason ?? 'Only the two players in this fixture can arrange its date.'}
			</div>
			<div class="form-actions">
				<a class="small-secondary" href="/fixtures/{data.fixture.fixtureId}">Back to the fixture</a>
			</div>
		{/if}
	</div>

	<p class="flow-footnote">
		Bookings never count as results. If the match is played without a prior date, record the result and the day you
		actually played.
	</p>
</section>
