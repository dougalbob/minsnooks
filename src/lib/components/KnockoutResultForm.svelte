<script lang="ts">
	/**
	 * The knockout result form (Phase 12).
	 *
	 * One component serves recording and correcting a first-to-N knockout
	 * match. Frames are entered in order, one winner per frame, and play stops
	 * once a player reaches the competition target: rows after the decider are
	 * disabled and never submitted, so the saved scoreline cannot over-run the
	 * format. The same pure rules run live in the browser and on the server
	 * (`$lib/knockout-progression`), so the feedback while typing is exactly
	 * what the server will decide.
	 */
	import {
		assessKnockoutResultForm,
		formatTargetLabel,
		type KnockoutResultFormValues
	} from '$lib/knockout-progression';

	interface Props {
		action: string;
		formId?: string;
		competitionId: number;
		competitionTitle: string;
		stageNumber: number;
		tieLabel: string;
		lowPlayerId: number;
		highPlayerId: number;
		lowName: string;
		highName: string;
		framesToWin: number;
		maxFrames: number;
		today: string;
		values: KnockoutResultFormValues;
		serverErrors: string[];
		correcting: boolean;
		reason: { label: string; hint: string; value: string; required: boolean } | null;
		submitLabel: string;
		cancelHref: string;
	}

	let {
		action,
		formId = 'knockout-form',
		competitionId,
		competitionTitle,
		stageNumber,
		tieLabel,
		lowPlayerId,
		highPlayerId,
		lowName,
		highName,
		framesToWin,
		maxFrames,
		today,
		values,
		serverErrors,
		correcting,
		reason,
		submitLabel,
		cancelHref
	}: Props = $props();

	let actualDate = $state('');
	let rows = $state<string[]>([]);
	let reasonText = $state('');
	let attempted = $state(false);

	/** Adopt incoming values on page-data changes only (failed post or prefill). */
	$effect(() => {
		actualDate = values.actualPlayedDate ?? '';
		rows = Array.from({ length: maxFrames }, (_, index) => values.frameWinners?.[index] ?? '');
		reasonText = reason?.value ?? '';
	});

	const currentValues = $derived.by<KnockoutResultFormValues>(() => ({
		actualPlayedDate: actualDate,
		frameWinners: rows
	}));

	const live = $derived(
		assessKnockoutResultForm(currentValues, {
			playerLowId: lowPlayerId,
			playerHighId: highPlayerId,
			lowPlayerName: lowName,
			highPlayerName: highName,
			framesToWin,
			today
		})
	);

	/** Frames whose winner is already decided live — later rows are not played. */
	const decidedAt = $derived(live.winnerPlayerId === null ? maxFrames : live.frames.length);
	const errors = $derived(serverErrors.length > 0 ? serverErrors : attempted ? live.errors : []);
	const scoreline = $derived(`${live.lowFrames}–${live.highFrames}`);
	const leaderName = $derived(
		live.lowFrames === live.highFrames
			? null
			: live.lowFrames > live.highFrames
				? lowName
				: highName
	);

	function setRow(index: number, value: string): void {
		const next = rows.slice();
		next[index] = value;
		rows = next;
	}
</script>

<form
	method="POST"
	{action}
	id={formId}
	onsubmit={() => {
		attempted = true;
	}}
>
	<input type="hidden" name="competitionId" value={competitionId} />

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

	<p class="match-meta">
		{competitionTitle} · stage {stageNumber} · {tieLabel} — {formatTargetLabel(framesToWin)}
	</p>

	<div class="live-score" role="status" aria-live="polite">
		<span class="live-name">{lowName}</span>
		<span class="live-figure">{scoreline}</span>
		<span class="live-name">{highName}</span>
		<span class="live-note">
			{#if live.winnerPlayerId !== null}
				Match decided — {live.winnerPlayerId === lowPlayerId ? lowName : highName} reaches {framesToWin}.
			{:else if leaderName}
				{leaderName} leads · first to {framesToWin} wins
			{:else}
				Playing to {framesToWin} frames
			{/if}
		</span>
	</div>

	<fieldset class="frames-fieldset">
		<legend class="field-label">Frame winners, in the order played</legend>
		<ol class="frame-list">
			{#each rows as row, index (index)}
				{@const frameNumber = index + 1}
				{@const notPlayed = index >= decidedAt}
				<li class="frame-row" class:decided={index < decidedAt} class:not-played={notPlayed}>
					<span class="frame-number" aria-hidden="true">{frameNumber}</span>
					<label class="frame-option" for="{formId}-frame{frameNumber}-low">
						<input
							id="{formId}-frame{frameNumber}-low"
							class="frame-radio"
							type="radio"
							name="frame{frameNumber}"
							value="low"
							checked={row === 'low'}
							disabled={notPlayed}
							onchange={() => setRow(index, 'low')}
						/>
						<span>{lowName}</span>
					</label>
					<label class="frame-option" for="{formId}-frame{frameNumber}-high">
						<input
							id="{formId}-frame{frameNumber}-high"
							class="frame-radio"
							type="radio"
							name="frame{frameNumber}"
							value="high"
							checked={row === 'high'}
							disabled={notPlayed}
							onchange={() => setRow(index, 'high')}
						/>
						<span>{highName}</span>
					</label>
					{#if notPlayed}
						<span class="frame-state">Not played — the match was decided first</span>
					{/if}
				</li>
			{/each}
		</ol>
		<p class="field-hint">
			Pick who won each frame. Play stops as soon as someone reaches {framesToWin} — the form locks the
			rows after the decider to match.
		</p>
	</fieldset>

	<label class="field-label" for="{formId}-actual-date">Actual date played</label>
	<input
		class="flow-input"
		id="{formId}-actual-date"
		name="actualDate"
		type="date"
		bind:value={actualDate}
		max={today}
		required
	/>
	<p class="field-hint">The day the frames were played — today at the latest. An arranged date is never filled in for you.</p>

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
		<a class="small-secondary" href={cancelHref}>Cancel</a>
		<button class="small-primary" type="submit">{submitLabel}</button>
	</div>
</form>

<style>
	.match-meta {
		margin: 0 0 12px;
		color: #9fc0aa;
		font-size: 12px;
		font-weight: 650;
	}
	.live-score {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: baseline;
		gap: 10px;
		margin: 0 0 6px;
		padding: 14px;
		border: 1px solid rgba(163, 235, 196, 0.22);
		border-radius: 14px;
		background: rgba(0, 27, 19, 0.42);
	}
	.live-name {
		color: #e2f3e8;
		font-size: 14px;
		font-weight: 750;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.live-name:last-of-type {
		text-align: right;
	}
	.live-figure {
		color: #d8f0a2;
		font-family: Georgia, serif;
		font-size: 28px;
		letter-spacing: 0.02em;
	}
	.live-note {
		grid-column: 1 / -1;
		color: #93b8a0;
		font-size: 11px;
	}
	.frames-fieldset {
		border: 0;
		padding: 0;
		margin: 16px 0 0;
	}
	.frame-list {
		list-style: none;
		margin: 8px 0 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}
	.frame-row {
		display: grid;
		grid-template-columns: 28px 1fr 1fr;
		gap: 8px;
		align-items: center;
		padding: 8px 10px;
		border: 1px solid rgba(181, 223, 192, 0.14);
		border-radius: 11px;
		background: rgba(0, 26, 19, 0.24);
	}
	.frame-row.decided {
		border-color: rgba(202, 234, 123, 0.3);
		background: rgba(152, 188, 73, 0.08);
	}
	.frame-row.not-played {
		opacity: 0.55;
	}
	.frame-number {
		color: #a9c4a7;
		font-weight: 750;
		text-align: center;
	}
	.frame-option {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 40px;
		padding: 6px 8px;
		border-radius: 9px;
		color: #dcebe1;
		font-size: 13px;
		font-weight: 650;
		cursor: pointer;
	}
	.frame-option:hover {
		background: rgba(180, 221, 193, 0.08);
	}
	.frame-radio {
		width: 18px;
		height: 18px;
		accent-color: #bce66d;
	}
	.frame-state {
		grid-column: 2 / -1;
		color: #8aa78f;
		font-size: 10px;
	}
	.form-error {
		margin: 0 0 14px;
		padding: 12px 14px;
		border: 1px solid rgba(240, 170, 130, 0.4);
		border-radius: 12px;
		background: rgba(136, 69, 36, 0.16);
		color: #f4cfae;
		font-size: 12px;
	}
	.form-error ul {
		margin: 6px 0 0;
		padding-left: 18px;
	}
</style>
