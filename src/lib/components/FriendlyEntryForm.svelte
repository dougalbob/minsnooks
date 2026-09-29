<script lang="ts">
	/**
	 * The friendly result entry form (Phase 10).
	 *
	 * One component serves recording and correction, because the fields and the
	 * rules are identical; only the labels and the reason requirement differ.
	 * Frame totals are free inputs (flexible counts, draws allowed, 0–0 never
	 * saved); the optional point-score grid grows to match the entered totals.
	 *
	 * Validation runs live in the browser through the *same* pure rules the
	 * server applies (`$lib/friendly-entry`), so what a player sees while typing
	 * is what the server will decide. Surprising values produce an "is this
	 * correct?" acknowledgement, never a rejection.
	 *
	 * The actual date played is always entered here. A scheduled date is only
	 * ever mentioned as a reminder — it is never offered as a default.
	 */
	import { assessFriendlyForm, type FriendlyFormValues } from '$lib/friendly-entry';

	interface Props {
		action: string;
		lowPlayerId: number;
		highPlayerId: number;
		lowName: string;
		highName: string;
		today: string;
		maxDate: string | null;
		values: FriendlyFormValues;
		serverErrors: string[];
		serverWarnings: string[];
		needsAck: boolean;
		submitLabel: string;
		cancelHref: string;
		cancelLabel?: string;
		reason?: { label: string; hint: string; value: string; required: boolean } | null;
		scheduledDateNote?: string | null;
		formId?: string;
		/** Carried with the post: a scheduled friendly by id, or a direct record by opponent. */
		friendlyId?: number | null;
		opponentId?: number | null;
	}

	let {
		action,
		lowPlayerId,
		highPlayerId,
		lowName,
		highName,
		today,
		maxDate,
		values,
		serverErrors,
		serverWarnings,
		needsAck,
		submitLabel,
		cancelHref,
		cancelLabel = 'Cancel',
		reason = null,
		scheduledDateNote = null,
		formId = 'friendly-form',
		friendlyId = null,
		opponentId = null
	}: Props = $props();

	let actualDate = $state('');
	let lowTotal = $state('');
	let highTotal = $state('');
	let points = $state<Array<{ low: string; high: string }>>([]);
	let breakLow = $state('');
	let breakHigh = $state('');
	let ackWarnings = $state(false);
	let reasonText = $state('');
	let attempted = $state(false);

	/**
	 * Adopt the incoming values deliberately instead of capturing them once: a
	 * failed post comes back with what the player typed, and a correction
	 * comes back with the saved result. Typing never feeds back into `values`,
	 * so this only runs when the page data actually changes.
	 */
	$effect(() => {
		actualDate = values.actualPlayedDate ?? '';
		lowTotal = values.lowFrames ?? '';
		highTotal = values.highFrames ?? '';
		points = (values.framePoints ?? []).map((entry) => ({ low: entry.low ?? '', high: entry.high ?? '' }));
		breakLow = values.breaks?.low ?? '';
		breakHigh = values.breaks?.high ?? '';
		reasonText = reason?.value ?? '';
	});

	const parsedTotals = $derived.by(() => {
		const low = /^\d+$/.test(lowTotal.trim()) ? Number(lowTotal.trim()) : null;
		const high = /^\d+$/.test(highTotal.trim()) ? Number(highTotal.trim()) : null;
		return { low, high, total: low !== null && high !== null ? low + high : 0 };
	});

	/** Point-score rows follow the entered totals; typed scores survive a total change. */
	const pointRows = $derived.by(() => {
		const total = parsedTotals.total;
		if (total < 1) return [];
		// A mistyped total must not render an unbounded grid; the server reads
		// at most 200 rows and the totals can always be saved without points.
		if (total > 40) return [];
		return Array.from({ length: total }, (_, index) => ({
			frameNumber: index + 1,
			low: points[index]?.low ?? '',
			high: points[index]?.high ?? ''
		}));
	});
	const pointsCapped = $derived(parsedTotals.total > 40);

	function setPoint(frameIndex: number, side: 'low' | 'high', value: string): void {
		const next = points.slice();
		while (next.length <= frameIndex) next.push({ low: '', high: '' });
		next[frameIndex] = { ...next[frameIndex], [side]: value };
		points = next;
	}

	const currentValues = $derived.by<FriendlyFormValues>(() => ({
		actualPlayedDate: actualDate,
		lowFrames: lowTotal,
		highFrames: highTotal,
		framePoints: pointsCapped ? [] : pointRows.map((row) => ({ low: row.low, high: row.high })),
		breaks: { low: breakLow, high: breakHigh }
	}));

	const live = $derived(
		assessFriendlyForm(currentValues, {
			lowPlayerId,
			highPlayerId,
			lowPlayerName: lowName,
			highPlayerName: highName,
			today
		})
	);

	const errors = $derived(serverErrors.length > 0 ? serverErrors : attempted ? live.errors : []);
	const warnings = $derived(serverWarnings.length > 0 ? serverWarnings : live.warnings);
	const needsAcknowledgement = $derived(needsAck || (warnings.length > 0 && !ackWarnings));
	const drawNote = $derived(
		parsedTotals.low !== null &&
			parsedTotals.high !== null &&
			parsedTotals.total > 0 &&
			parsedTotals.low === parsedTotals.high
			? 'That is a drawn friendly — draws are allowed and stand as saved.'
			: null
	);
</script>

<form
	method="POST"
	{action}
	id={formId}
	onsubmit={() => {
		attempted = true;
	}}
>
	{#if friendlyId !== null}
		<input type="hidden" name="friendlyId" value={friendlyId} />
	{/if}
	{#if opponentId !== null}
		<input type="hidden" name="opponentId" value={opponentId} />
	{/if}
	{#if scheduledDateNote}
		<p class="plan-current">{scheduledDateNote}</p>
	{/if}

	{#if errors.length > 0}
		<div class="form-error" role="alert">
			<strong>That cannot be saved yet:</strong>
			<ul>
				{#each errors as message (message)}
					<li>{message}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<div class="score-entry">
		<div class="score-side">
			<label class="field-label" for="{formId}-low-total">Frames won · {lowName}</label>
			<input
				class="flow-input score-input"
				id="{formId}-low-total"
				name="lowFrames"
				type="number"
				inputmode="numeric"
				min="0"
				step="1"
				required
				bind:value={lowTotal}
			/>
		</div>
		<span class="score-dash" aria-hidden="true">–</span>
		<div class="score-side">
			<label class="field-label" for="{formId}-high-total">Frames won · {highName}</label>
			<input
				class="flow-input score-input"
				id="{formId}-high-total"
				name="highFrames"
				type="number"
				inputmode="numeric"
				min="0"
				step="1"
				required
				bind:value={highTotal}
			/>
		</div>
	</div>
	{#if drawNote}
		<p class="field-hint" role="status">{drawNote}</p>
	{:else}
		<p class="field-hint">Any number of frames — a friendly is whatever you agreed to play.</p>
	{/if}

	<label class="field-label" for="{formId}-actual-date">Actual date played</label>
	<input
		class="flow-input"
		id="{formId}-actual-date"
		name="actualDate"
		type="date"
		bind:value={actualDate}
		max={maxDate}
		required
	/>
	<p class="field-hint">The day the frames were played — today at the latest. A scheduled date is never filled in for you.</p>

	<fieldset class="points-fieldset">
		<legend class="field-label">Frame-by-frame point scores (optional)</legend>
		{#if parsedTotals.total < 1}
			<p class="field-hint">Enter both frame totals first — the score grid appears here, or leave it empty.</p>
		{:else if pointsCapped}
			<p class="field-hint">
				That is a lot of frames for point-by-point scores, so the grid is hidden here. Save the totals as they
				are — the match still counts as a friendly.
			</p>
		{:else}
			<p class="field-hint">
				All {parsedTotals.total} frames or none — the winners must agree with the totals above.
			</p>
			<ol class="points-grid">
				{#each pointRows as row (row.frameNumber)}
					<li class="points-row">
						<span class="points-frame" aria-hidden="true">{row.frameNumber}</span>
						<label class="visually-hidden" for="{formId}-frame{row.frameNumber}-low">
							Frame {row.frameNumber} · {lowName} points
						</label>
						<input
							class="flow-input points-input"
							id="{formId}-frame{row.frameNumber}-low"
							name="frame{row.frameNumber}Low"
							type="number"
							inputmode="numeric"
							min="0"
							step="1"
							placeholder={lowName}
							autocomplete="off"
							value={row.low}
							oninput={(event) => setPoint(row.frameNumber - 1, 'low', event.currentTarget.value)}
						/>
						<label class="visually-hidden" for="{formId}-frame{row.frameNumber}-high">
							Frame {row.frameNumber} · {highName} points
						</label>
						<input
							class="flow-input points-input"
							id="{formId}-frame{row.frameNumber}-high"
							name="frame{row.frameNumber}High"
							type="number"
							inputmode="numeric"
							min="0"
							step="1"
							placeholder={highName}
							autocomplete="off"
							value={row.high}
							oninput={(event) => setPoint(row.frameNumber - 1, 'high', event.currentTarget.value)}
						/>
					</li>
				{/each}
			</ol>
		{/if}
	</fieldset>

	<div class="score-entry">
		<div class="score-side">
			<label class="field-label" for="{formId}-break-low">Highest break · {lowName} (optional)</label>
			<input
				class="flow-input score-input"
				id="{formId}-break-low"
				name="breakLow"
				type="number"
				inputmode="numeric"
				min="0"
				step="1"
				autocomplete="off"
				bind:value={breakLow}
			/>
		</div>
		<div class="score-side">
			<label class="field-label" for="{formId}-break-high">Highest break · {highName} (optional)</label>
			<input
				class="flow-input score-input"
				id="{formId}-break-high"
				name="breakHigh"
				type="number"
				inputmode="numeric"
				min="0"
				step="1"
				autocomplete="off"
				bind:value={breakHigh}
			/>
		</div>
	</div>
	<p class="field-hint">Breaks may be entered with or without the frame scores. Friendly details never enter league statistics.</p>

	{#if warnings.length > 0}
		<div class="check-panel" role="status">
			<p class="check-heading">Is this correct?</p>
			<ul>
				{#each warnings as warning (warning)}
					<li>{warning}</li>
				{/each}
			</ul>
			<p class="check-hint">
				Unusual scores are allowed — a marathon friendly or a foul-inflated frame is possible. We just ask
				you to check before it is saved.
			</p>
			{#if needsAcknowledgement}
				<label class="ack-option" for="{formId}-ack-warnings">
					<input
						id="{formId}-ack-warnings"
						name="ackWarnings"
						type="checkbox"
						value="1"
						bind:checked={ackWarnings}
						required={needsAck}
					/>
					<span>Yes — I have checked these scores and they are correct.</span>
				</label>
			{/if}
		</div>
	{/if}

	{#if reason}
		<label class="field-label" for="{formId}-reason">{reason.label}{reason.required ? '' : ' (optional)'}</label>
		<input
			class="flow-input"
			id="{formId}-reason"
			name="reason"
			type="text"
			maxlength="300"
			bind:value={reasonText}
			required={reason.required}
		/>
		<p class="field-hint">{reason.hint}</p>
	{/if}

	<div class="form-actions">
		<a class="small-secondary" href={cancelHref}>{cancelLabel}</a>
		<button class="small-primary" type="submit">{submitLabel}</button>
	</div>
</form>

<style>
	.score-entry {
		display: flex;
		align-items: flex-end;
		gap: 10px;
	}
	.score-side {
		flex: 1;
		min-width: 0;
	}
	.score-dash {
		padding-bottom: 12px;
		color: #a9c4a7;
		font-weight: 700;
	}
	.points-fieldset {
		border: 0;
		padding: 0;
		margin: 16px 0 0;
	}
	.points-grid {
		list-style: none;
		margin: 8px 0 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}
	.points-row {
		display: grid;
		grid-template-columns: 28px 1fr 1fr;
		gap: 8px;
		align-items: center;
	}
	.points-frame {
		color: #a9c4a7;
		font-weight: 700;
		text-align: center;
	}
	@media (max-width: 420px) {
		.score-entry {
			flex-direction: column;
			align-items: stretch;
		}
		.score-dash {
			display: none;
		}
	}
</style>
