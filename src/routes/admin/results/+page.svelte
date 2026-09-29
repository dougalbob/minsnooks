<script lang="ts">
	import { formatCalendarDate, formatInstantInZone, formatShortDate } from '$lib/format';
	import { auditActionLabel } from '$lib/result-view';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const queue = $derived(data.queue);
	const activity = $derived(data.activity);
	const needsMine = $derived(queue.filter((item) => item.needsMyReview).length);
</script>

<svelte:head>
	<title>Minsnooks · Result queue</title>
</svelte:head>

<section class="lifecycle-page" aria-labelledby="results-title">
	<a class="back-link" href="/admin"><span aria-hidden="true">←</span> Admin</a>
	<header class="lifecycle-header">
		<p class="flow-kicker">LEAGUE CONTROL · RESULT QUEUE</p>
		<h1 id="results-title">Results awaiting confirmation</h1>
		<p class="flow-intro">
			A submission is never a table entry. Everything listed here has been recorded by a player but not
			yet confirmed by the opponent, so none of it counts in the round or season tables.
		</p>
		<p class="preview-warning">
			Preview console: admin controls are visible in development only, and Phase 8 replaces this with
			real authorization.
		</p>
	</header>

	<nav class="admin-nav" aria-label="League control sections">
		<a class="admin-nav-link" href="/admin/rounds">Round lifecycle</a>
		<a class="admin-nav-link admin-nav-active" href="/admin/results" aria-current="page">Result queue</a>
		<a class="admin-nav-link" href="/admin/awards">Withdrawals & awards</a>
	</nav>

	<section class="admin-panel" aria-label="Unconfirmed results">
		<div class="panel-heading">
			<p class="section-label">SUBMITTED · NOT IN THE TABLE</p>
			<span class="lifecycle-status" class:status-open={queue.length > 0}>
				{queue.length} waiting{#if needsMine > 0} · {needsMine} need you{/if}
			</span>
		</div>

		{#if queue.length === 0}
			<p class="panel-copy">
				Nothing is waiting for confirmation{data.isAdmin
					? ' anywhere in the league'
					: ` from ${data.viewer?.name ?? 'you'}`}. Every recorded result has been confirmed, sent back
				or corrected.
			</p>
		{:else}
			<ul class="queue-list">
				{#each queue as item (item.resultId)}
					<li class="queue-item">
						<div class="queue-facts">
							<strong class="queue-players">{item.low.name} v {item.high.name}</strong>
							<span class="queue-score">
								{item.lowFrames}–{item.highFrames}
								<span class="visually-hidden">frames, low seed first</span>
							</span>
							<span class="queue-meta">
								Round {item.roundNumber}
								{#if item.revision > 1}· revision {item.revision}{/if}
								· played {formatShortDate(item.actualPlayedDate)}
								· submitted by {item.submittedByName}
								{formatInstantInZone(item.submittedAt, data.timeZone) ?? ''}
							</span>
							<span class="queue-meta">
								Waiting on <strong>{item.reviewerName}</strong>
								{#if item.needsMyReview}<span class="your-fixture-tag">NEEDS YOU</span>{/if}
								{#if !item.canReview}· you cannot confirm this one{/if}
							</span>
						</div>
						<a
							class={item.needsMyReview ? 'small-primary' : 'small-secondary'}
							href="/fixtures/{item.fixtureId}/review">Review</a
						>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="admin-panel" aria-label="Result history">
		<div class="panel-heading">
			<p class="section-label">AUDIT TRAIL · WHO, WHAT, WHEN, WHY</p>
			<span class="lifecycle-status">{activity.length} entries</span>
		</div>

		{#if activity.length === 0}
			<p class="panel-copy">No result has been recorded yet.</p>
		{:else}
			<ol class="result-audit">
				{#each activity as entry (entry.id)}
					<li>
						<span class="history-state">{auditActionLabel(entry.action)}</span>
						<span class="history-date">
							{#if entry.fixtureId > 0}
								<a href="/fixtures/{entry.fixtureId}">{entry.players}</a>
							{:else}
								{entry.players}
							{/if}
							{#if entry.frames}· {entry.frames}{/if}
							{#if entry.actualPlayedDate}
								· played {formatCalendarDate(entry.actualPlayedDate)}
							{/if}
						</span>
						<span class="history-meta">
							{entry.actorName ?? 'the system'} ·
							{formatInstantInZone(entry.createdAt, data.timeZone)}
							{#if entry.reason}· “{entry.reason}”{/if}
						</span>
					</li>
				{/each}
			</ol>
		{/if}
	</section>
</section>
