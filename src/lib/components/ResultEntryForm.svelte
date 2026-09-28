<script lang="ts">
	/**
	 * The league result entry form (Phase 6).
	 *
	 * One component serves every write path — a first submission, a correction
	 * after a send-back, and an admin correction — because the fields and the
	 * rules are identical; only the labels, the reason requirement and the
	 * locked optional details differ.
	 *
	 * Validation runs live in the browser through the *same* pure rules the
	 * server applies (`$lib/result-entry`), so what a player sees while typing is
	 * what the server will decide. Surprising values produce an "is this
	 * correct?" acknowledgement, never a rejection: fouls can inflate a frame.
	 *
	 * The actual date played is always entered here. The planned date is only
	 * ever mentioned as a reminder — it is never offered as a default.
	 */
	import { assessResultForm, type ResultFormValues } from '$lib/result-entry';
	import { formatCalendarDate } from '$lib/format';

	interface Props {
		action: string;
		lowPlayerId: number;
		highPlayerId: number;
		lowName: string;
		highName: string;
		framesPerMatch: number;
		timeZone: string;
		today: string;
		minDate: string | null;
		maxDate: string | null;
		values: ResultFormValues;
		serverErrors: string[];
		serverWarnings: string[];
		needsAck: boolean;
		submitLabel: string;
		cancelHref: string;
		cancelLabel?: string;
		/** Categories that were absent from the original submission and stay locked. */
		locked?: { framePoints: boolean; breaks: boolean };
		reason?: { label: string; hint: string; value: string; required: boolean } | null;
		/** Super-admin direct entry: confirmed without the opponent's approval. */
		directOption?: { allowed: boolean } | null;
		plannedDateNote?: string | null;
		correctionNote?: string | null;
		formId?: string;
	}

	let {
		action,
		lowPlayerId,
		highPlayerId,
		lowName,
		highName,
		framesPerMatch,
		timeZone,
		today,
		minDate,
		maxDate,
		values,
		serverErrors,
		serverWarnings,
		needsAck,
		submitLabel,
		cancelHref,
		cancelLabel = 'Cancel',
		locked = { framePoints: false, breaks: false },
		reason = null,
		directOption = null,
		plannedDateNote = null,
		correctionNote = null,
		formId = 'result-form'
	}: Props = $props();

	let actualDate = $state('');
	let winners = $state<string[]>([]);
	let points = $state<Array<{ low: string; high: string }>>([]);
	let breakLow = $state('');
	let breakHigh = $state('');
	let ackWarnings = $state(false);
	let direct = $state(false);
	let reasonText = $state('');
	let attempted = $state(false);

	const frameNumbers = $derived(
		Array.from({ length: framesPerMatch }, (_, index) => index + 1)
	);

	/**
	 * Adopt the incoming values deliberately instead of capturing them once: a
	 * failed post returns what the player typed, and a resubmission returns the
	 * stored result as a draft. Typing locally never changes `values`, so this
	 * only runs when the server (or the fixture) actually supplies new ones.
	 */
	const incoming = $derived(JSON.stringify([values, reason?.value ?? '']));
	$effect(() => {
		incoming;
		actualDate = values.actualPlayedDate;
		winners = [...values.frameWinners];
		points = values.framePoints.map((entry) => ({ ...entry }));
		breakLow = values.breaks.low;
		breakHigh = values.breaks.high;
		reasonText = reason?.value ?? '';
	});

	const current = $derived.by<ResultFormValues>(() => ({
		actualPlayedDate: actualDate,
		frameWinners: winners,
		framePoints: points,
		breaks: { low: breakLow, high: breakHigh }
	}));

	// The same rules the server runs, live in the browser.
	const live = $derived(
		assessResultForm(current, {
			framesPerMatch,
			lowPlayerId,
			highPlayerId,
			lowPlayerName: lowName,
			highPlayerName: highName,
			today
		})
	);

	const showErrors = $derived(attempted || serverErrors.length > 0);
	const errors = $derived(showErrors ? (serverErrors.length > 0 ? serverErrors : live.errors) : []);
	const warnings = $derived(serverWarnings.length > 0 ? serverWarnings : live.warnings);
	const needsAcknowledgement = $derived(needsAck || (warnings.length > 0 && !ackWarnings));
	const liveErrors = $derived(showErrors ? live.errors : []);

	const scoreline = $derived(`${live.lowFrames}–${live.highFrames}`);
	const winnersChosen = $derived(winners.filter((choice) => choice !== '').length);
	// Open the optional block when the draft already carries optional detail, so
	// a correction shows what was recorded instead of hiding it behind a summary.
	const hasOptionalDetail = $derived(
		points.some((entry) => entry.low !== '' || entry.high !== '') ||
			breakLow !== '' ||
			breakHigh !== ''
	);
	const dateOutOfRange = $derived(
		Boolean(actualDate) &&
			((minDate !== null && actualDate < minDate) || (maxDate !== null && actualDate > maxDate))
	);

	function onFramePointsChange(index: number, side: 'low' | 'high', value: string) {
		points[index] = { ...points[index], [side]: value };
	}
</script>

<form
	id={formId}
	class="result-form"
	method="POST"
	{action}
	onsubmit={() => {
		attempted = true;
	}}
>
	{#if correctionNote}
		<p class="correction-note" role="status">{correctionNote}</p>
	{/if}

	{#if errors.length > 0}
		<div class="form-error" role="alert">
			<strong>Check the result:</strong>
			<ul>
				{#each errors as message (message)}
					<li>{message}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<label class="field-label" for="actual-date">
		Actual date played <span class="required-mark">Required</span>
	</label>
	<input
		class="flow-input"
		id="actual-date"
		name="actualDate"
		type="date"
		bind:value={actualDate}
		min={minDate ?? undefined}
		max={maxDate ?? undefined}
		required
		aria-invalid={dateOutOfRange || undefined}
		aria-describedby="actual-date-hint"
	/>
	<p class="field-hint" id="actual-date-hint">
		Enter the day the frames were played ({timeZone}) — not the fixture’s planned date.
		{#if minDate && maxDate}
			This round accepts dates from {formatCalendarDate(minDate, { year: true })} to
			{formatCalendarDate(maxDate, { year: true })}.
		{/if}
	</p>
	{#if plannedDateNote}
		<p class="plan-reminder">{plannedDateNote}</p>
	{/if}
	{#if dateOutOfRange}
		<p class="field-warning" role="status">
			That date is outside this round’s play window, so the result cannot be saved with it.
		</p>
	{/if}

	<div class="frame-entry-heading">
		<span>FRAME WINNERS</span>
		<span>Best of {framesPerMatch} · all frames played</span>
	</div>
	<div class="frame-winners" role="group" aria-label="Frame winners">
		{#each frameNumbers as frameNumber, index (frameNumber)}
			<label class="frame-winner-row" for="winner-{frameNumber}">
				<span class="frame-number" aria-hidden="true">{String(frameNumber).padStart(2, '0')}</span>
				<span>Frame {frameNumber}</span>
				<select
					class="flow-input winner-select"
					id="winner-{frameNumber}"
					name="winner{frameNumber}"
					bind:value={winners[index]}
					required
					aria-invalid={showErrors && winners[index] === '' ? true : undefined}
				>
					<option value="" disabled>Choose the winner</option>
					<option value="low">{lowName}</option>
					<option value="high">{highName}</option>
				</select>
			</label>
		{/each}
	</div>
	<p class="field-hint live-scoreline" role="status" aria-live="polite">
		{#if winnersChosen === framesPerMatch}
			Match score so far: <strong>{lowName} {scoreline} {highName}</strong>
		{:else}
			{winnersChosen} of {framesPerMatch} frame winners chosen — a league match plays every frame, and it
			cannot be drawn.
		{/if}
	</p>

	<details class="optional-details" open={hasOptionalDetail}>
		<summary>Optional frame scores &amp; highest breaks</summary>
		<p class="field-hint">
			You can leave these blank. A highest break may be entered without frame-point detail — but
			once the result is submitted, optional details cannot be added later.
		</p>

		{#if locked.framePoints}
			<p class="field-warning" role="status">
				Frame-by-frame scores were not part of the original submission, so they are locked. Only an
				admin can add them, with a reason.
			</p>
		{:else}
			<div class="score-detail-grid">
				<span></span>
				<span class="score-column-head">{lowName.split(' ')[0].toUpperCase()}</span>
				<span class="score-column-head">{highName.split(' ')[0].toUpperCase()}</span>
				{#each frameNumbers as frameNumber, index (frameNumber)}
					<label for="frame-{frameNumber}-low">Frame {frameNumber} points</label>
					<input
						class="flow-input score-input"
						id="frame-{frameNumber}-low"
						name="frame{frameNumber}Low"
						type="number"
						min="0"
						step="1"
						inputmode="numeric"
						placeholder="e.g. 65"
						value={points[index]?.low ?? ''}
						oninput={(event) =>
							onFramePointsChange(index, 'low', event.currentTarget.value)}
						aria-label={`Frame ${frameNumber} points for ${lowName}`}
					/>
					<input
						class="flow-input score-input"
						id="frame-{frameNumber}-high"
						name="frame{frameNumber}High"
						type="number"
						min="0"
						step="1"
						inputmode="numeric"
						placeholder="e.g. 38"
						value={points[index]?.high ?? ''}
						oninput={(event) =>
							onFramePointsChange(index, 'high', event.currentTarget.value)}
						aria-label={`Frame ${frameNumber} points for ${highName}`}
					/>
				{/each}
			</div>
		{/if}

		<div class="break-inputs">
			{#if locked.breaks}
				<p class="field-warning" role="status">
					Highest breaks were not part of the original submission, so they are locked. Only an admin
					can add them, with a reason.
				</p>
			{:else}
				<div>
					<label class="field-label" for="break-low">{lowName}’s highest break</label>
					<input
						class="flow-input score-input"
						id="break-low"
						name="breakLow"
						type="number"
						min="0"
						step="1"
						inputmode="numeric"
						placeholder="Optional"
						bind:value={breakLow}
					/>
				</div>
				<div>
					<label class="field-label" for="break-high">{highName}’s highest break</label>
					<input
						class="flow-input score-input"
						id="break-high"
						name="breakHigh"
						type="number"
						min="0"
						step="1"
						inputmode="numeric"
						placeholder="Optional"
						bind:value={breakHigh}
					/>
				</div>
			{/if}
		</div>
	</details>

	{#if warnings.length > 0}
		<div class="check-panel" role="status">
			<p class="check-heading">Is this correct?</p>
			<ul>
				{#each warnings as warning (warning)}
					<li>{warning}</li>
				{/each}
			</ul>
			<p class="check-hint">
				Unusual scores are allowed — fouls can give away points, so a 100–50 frame is possible. We just
				ask you to check before it goes to your opponent.
			</p>
			<label class="ack-option" for="ack-warnings">
				<input
					id="ack-warnings"
					name="ackWarnings"
					type="checkbox"
					value="1"
					bind:checked={ackWarnings}
					required={needsAcknowledgement}
				/>
				<span>Yes — I have checked these scores and they are correct.</span>
			</label>
		</div>
	{/if}

	{#if directOption?.allowed}
		<div class="direct-panel">
			<label class="ack-option" for="direct-entry">
				<input id="direct-entry" name="direct" type="checkbox" value="1" bind:checked={direct} />
				<span>
					Enter directly as super-admin — confirmed immediately, without the opponent’s approval.
				</span>
			</label>
			<p class="field-hint">
				Ordinary submissions wait for the other player to confirm the scoreline and the actual date
				together. A direct entry is audited with your reason.
			</p>
		</div>
	{/if}

	{#if reason || direct}
		<label class="field-label" for="change-reason">
			{reason?.label ?? 'Reason for this entry'}
			{#if reason?.required || direct}<span class="required-mark">Required</span>{/if}
		</label>
		<input
			class="flow-input"
			id="change-reason"
			name="reason"
			type="text"
			maxlength="300"
			bind:value={reasonText}
			placeholder="e.g. Corrected after both players checked the score sheet"
			required={Boolean(reason?.required) || direct}
			aria-describedby="change-reason-hint"
		/>
		<p class="field-hint" id="change-reason-hint">
			{reason?.hint ??
				'Recorded in the audit trail with your name and the time, so the change is never silent.'}
		</p>
	{/if}

	{#if liveErrors.length === 0 && showErrors && errors.length === 0}
		<p class="field-hint" role="status">Everything checks out — ready to save.</p>
	{/if}

	<div class="form-actions">
		<a class="small-secondary" href={cancelHref}>{cancelLabel}</a>
		<button class="small-primary" type="submit">{submitLabel}</button>
	</div>
</form>
