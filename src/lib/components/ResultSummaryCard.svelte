<script lang="ts">
	/**
	 * The factual summary of one league result: scoreline, the actual date
	 * played, the frame-by-frame winners, and any optional detail.
	 *
	 * Used by the opponent's review screen and the fixture detail page, so the
	 * thing being confirmed is rendered identically everywhere. It shows only
	 * what was recorded — when the optional frame detail is absent it says so
	 * instead of inventing a frame order.
	 */
	import PlayerAvatar from './PlayerAvatar.svelte';
	import { formatCalendarDate, formatInstantInZone } from '$lib/format';
	import {
		entrySourceLabel,
		resultStatusClass,
		resultStatusLabel,
		type ResultRecordView
	} from '$lib/result-view';

	let {
		record,
		timeZone,
		showStatus = true,
		heading = 'ACTUAL DATE PLAYED'
	}: {
		record: ResultRecordView;
		/** League timezone, so provenance timestamps read in league-local time. */
		timeZone: string;
		showStatus?: boolean;
		heading?: string;
	} = $props();
</script>

<div class="review-card">
	{#if showStatus}
		<div class="review-result-head">
			<span class="fixture-status {resultStatusClass(record.status)}">
				{resultStatusLabel(record.status)}
			</span>
			<span class="review-round">
				ROUND {record.roundNumber}{#if record.revision > 1} · REVISION {record.revision}{/if}
			</span>
		</div>
	{/if}

	<div class="review-matchup">
		<div class="review-player">
			<PlayerAvatar player={record.low} size="md" showName={false} />
			<strong>{record.low.name}</strong>
		</div>
		<div class="review-score">
			<strong>{record.lowFrames}</strong>
			<span aria-hidden="true">—</span>
			<strong>{record.highFrames}</strong>
			<span class="visually-hidden">
				frames to {record.highFrames} — {record.winner.name} won {record.winnerFrames} to
				{record.loserFrames}
			</span>
		</div>
		<div class="review-player right-player">
			<strong>{record.high.name}</strong>
			<PlayerAvatar player={record.high} size="md" showName={false} />
		</div>
	</div>

	<div class="review-meta">
		<span>{heading}</span>
		<strong>
			<time datetime={record.actualPlayedDate}>
				{formatCalendarDate(record.actualPlayedDate, { year: true })}
			</time>
		</strong>
	</div>

	{#if record.frameWinners.length > 0}
		<ul class="review-frames">
			{#each record.frameWinners as frame (frame.frameNumber)}
				<li class="review-frame">
					<span>Frame {frame.frameNumber}</span>
					{#if frame.lowPoints !== null && frame.highPoints !== null}
						<span class="frame-points">
							{record.low.name.split(' ')[0]} {frame.lowPoints} – {frame.highPoints}
							{record.high.name.split(' ')[0]}
						</span>
					{/if}
					<strong class="frame-winner-name">{frame.playerName}</strong>
					<span class="frame-winner-tag">Winner</span>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="plan-meta">
			Only the match score was recorded ({record.winnerFrames}–{record.loserFrames}), without a
			frame-by-frame order.
		</p>
	{/if}

	{#if record.hasFramePoints || record.hasBreaks}
		<details class="review-details">
			<summary>
				Optional scores included
				{#if record.hasFramePoints}· frame points{/if}
				{#if record.hasBreaks}· highest breaks{/if}
			</summary>
			{#if record.hasFramePoints}
				<div class="review-optional-grid">
					{#each record.frames as frame (frame.frameNumber)}
						<span>Frame {frame.frameNumber}</span>
						<span>{record.low.name} {frame.lowPoints} – {frame.highPoints} {record.high.name}</span>
					{/each}
				</div>
			{/if}
			{#if record.hasBreaks}
				<div class="review-optional-grid">
					<span>Highest breaks</span>
					<span>
						{#each record.breaks as entry, index (entry.playerId)}
							{#if index > 0} · {/if}{entry.playerName} {entry.breakPoints}
						{/each}
					</span>
				</div>
			{/if}
		</details>
	{:else}
		<p class="plan-meta">No optional frame scores or breaks were entered with this result.</p>
	{/if}

	<p class="review-provenance">
		{entrySourceLabel(record.entrySource)} · submitted by <strong>{record.submittedByName}</strong>
		{formatInstantInZone(record.submittedAt, timeZone)}
		{#if record.status === 'confirmed' && record.confirmedByName}
			· confirmed by <strong>{record.confirmedByName}</strong>
		{/if}
		{#if record.status === 'sent_back' && record.sentBackByName}
			· sent back by <strong>{record.sentBackByName}</strong>
			{#if record.sendBackReason}— “{record.sendBackReason}”{/if}
		{/if}
		{#if record.correctedByName && record.correctedAt}
			· corrected after approval by <strong>{record.correctedByName}</strong>
			{#if record.correctionReason}— “{record.correctionReason}”{/if}
		{/if}
	</p>
</div>
