<script lang="ts">
	import FixtureMatchup from '$lib/components/FixtureMatchup.svelte';
	import { formatCalendarDate, formatPlannedDate } from '$lib/format';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Minsnooks · Friendlies</title>
</svelte:head>

<section class="flow-screen">
	<div class="flow-header">
		<a class="back-link" href="/"><span aria-hidden="true">←</span> Home</a>
		<p class="flow-kicker">INFORMAL GAMES · OUTSIDE THE LEAGUE</p>
		<h1>Friendlies</h1>
		<p class="flow-intro">
			Arrange a knockabout or record one you already played. Friendlies are only between registered
			league players, and they never touch the league tables, stats, highlights or knockout.
		</p>
		{#if data.viewer}
			<p class="viewer-line">
				Playing as <strong>{data.viewer.name}</strong>
			</p>
		{:else}
			<p class="viewer-line">You are browsing signed out — sign in to arrange or record a friendly.</p>
		{/if}
	</div>

	{#if data.status === 'cancelled'}
		<p class="plan-current" role="status">The scheduled friendly was withdrawn. The players can arrange another any time.</p>
	{/if}

	{#if data.canSchedule}
		<div class="form-actions friendly-cta">
			<a class="small-secondary" href="/friendlies/schedule">Arrange a friendly</a>
			<a class="small-primary" href="/friendlies/record">Record a played friendly</a>
		</div>
	{/if}

	<h2 class="section-heading">Scheduled</h2>
	{#if data.scheduled.length === 0}
		<div class="placeholder-card empty-card">
			<strong>No friendlies on the calendar.</strong>
			Arrange one, or record a match you already played.
		</div>
	{:else}
		<ul class="friendly-list">
			{#each data.scheduled as friendly (friendly.friendlyId)}
				<li class="friendly-card">
					<div class="friendly-top">
						<FixtureMatchup left={friendly.low} right={friendly.high} size="sm" />
						{#if friendly.isParticipant}
							<span class="phase-pill">YOUR GAME</span>
						{/if}
					</div>
					<p class="friendly-line">
						{#if friendly.scheduledDate}
							Planned <strong>{formatPlannedDate(friendly.scheduledDate, friendly.scheduledTime)}</strong>
						{:else}
							No date arranged
						{/if}
					</p>
					{#if friendly.expiryDate}
						<p class="friendly-expiry">
							Removed {formatCalendarDate(friendly.expiryDate, { year: true })} if no result is saved.
						</p>
					{/if}
					<a class="small-secondary" href="/friendlies/{friendly.friendlyId}">Open friendly</a>
				</li>
			{/each}
		</ul>
	{/if}

	<h2 class="section-heading">Played</h2>
	{#if data.played.length === 0}
		<div class="placeholder-card empty-card">
			<strong>No friendly results yet.</strong>
			Record the first one — any frame count, draws allowed.
		</div>
	{:else}
		<ul class="friendly-list">
			{#each data.played as friendly (friendly.friendlyId)}
				<li class="friendly-card">
					<div class="friendly-top">
						<FixtureMatchup left={friendly.low} right={friendly.high} size="sm" />
						{#if friendly.isParticipant}
							<span class="phase-pill">YOUR GAME</span>
						{/if}
					</div>
					<p class="friendly-score">
						<span class="visually-hidden">Result:</span>
						<strong>{friendly.lowFrames}–{friendly.highFrames}</strong>
						{#if friendly.isDraw}
							<span class="draw-pill">Draw</span>
						{/if}
					</p>
					<p class="friendly-line">
						{#if friendly.actualPlayedDate}
							Played <time datetime={friendly.actualPlayedDate}>
								{formatCalendarDate(friendly.actualPlayedDate, { year: true })}
							</time>
						{/if}
						{#if friendly.hasFramePoints || friendly.hasBreaks}
							<span class="detail-note">
								with {friendly.hasFramePoints ? 'frame scores' : ''}{friendly.hasFramePoints && friendly.hasBreaks ? ' and ' : ''}{friendly.hasBreaks ? 'breaks' : ''}
							</span>
						{/if}
					</p>
					<a class="small-secondary" href="/friendlies/{friendly.friendlyId}">Open friendly</a>
				</li>
			{/each}
		</ul>
	{/if}

	<p class="flow-footnote">
		Scheduled friendlies with no result are removed five days after the scheduled date — even if you
		rearranged offline. Saved results are never removed. Either player may correct a saved friendly;
		an admin can help when needed.
	</p>
</section>

<style>
	.friendly-cta {
		margin: 4px 0 20px;
	}
	.section-heading {
		margin: 20px 0 10px;
		font-size: 1.05rem;
	}
	.friendly-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 12px;
	}
	.friendly-card {
		border: 1px solid rgba(169, 196, 167, 0.28);
		border-radius: 14px;
		padding: 12px 14px;
		background: rgba(7, 59, 44, 0.35);
	}
	.friendly-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		flex-wrap: wrap;
	}
	.friendly-line {
		margin: 8px 0 4px;
	}
	.friendly-score {
		margin: 8px 0 0;
		font-size: 1.25rem;
	}
	.draw-pill {
		display: inline-block;
		margin-left: 8px;
		padding: 1px 10px;
		border-radius: 999px;
		border: 1px solid rgba(169, 196, 167, 0.5);
		font-size: 0.8rem;
		vertical-align: middle;
	}
	.friendly-expiry {
		margin: 4px 0 8px;
		color: #cfe3cd;
		font-size: 0.9rem;
	}
	.detail-note {
		color: #cfe3cd;
		font-size: 0.9rem;
	}
	.friendly-card .small-secondary {
		margin-top: 8px;
	}
	.viewer-line {
		margin: 6px 0 0;
	}
</style>
