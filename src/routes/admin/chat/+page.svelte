<script lang="ts">
	import AdminRoleBanner from '$lib/components/AdminRoleBanner.svelte';
	import { chatMessageText } from '$lib/chat';
	import { formatInstantInZone } from '$lib/format';
	import type { PageData } from './$types';

	let {
		data,
		form
	}: {
		data: PageData;
		form: { message?: string; reviewed?: boolean; resolution?: 'hidden' | 'kept' } | null;
	} = $props();

	function instantLabel(value: string, timeZone: string): string {
		return formatInstantInZone(value, timeZone, { withTime: true }) ?? 'time unknown';
	}
</script>

<svelte:head>
	<title>Minsnooks · Chat reports</title>
</svelte:head>

<section class="lifecycle-page" aria-labelledby="chat-reports-title">
	<a class="back-link" href="/admin"><span aria-hidden="true">←</span> Admin</a>
	<header class="lifecycle-header">
		<p class="flow-kicker">LEAGUE CONTROL · CHAT REPORTS</p>
		<h1 id="chat-reports-title">Reported messages</h1>
		<p class="flow-intro">
			Admins never read private conversations. This queue shows only the messages a player has
			reported, so you can hide one with a written reason or leave it in place.
		</p>
	</header>

	<nav class="admin-nav" aria-label="League control sections">
		<a class="admin-nav-link" href="/admin/rounds">Round lifecycle</a>
		<a class="admin-nav-link" href="/admin/results">Result queue</a>
		<a class="admin-nav-link" href="/admin/awards">Withdrawals &amp; awards</a>
		<a class="admin-nav-link admin-nav-active" href="/admin/chat" aria-current="page">Chat reports</a>
	</nav>

	<AdminRoleBanner
		viewer={data.viewer}
		isAdmin={data.isAdmin}
		isSuperAdmin={data.isSuperAdmin}
		canManage={data.isAdmin}
		manageReason={data.isAdmin ? null : 'Sign in as an administrator to review chat reports.'}
	/>

	{#if form?.message}
		<p class="form-error" role="alert">{form.message}</p>
	{:else if form?.reviewed}
		<p class="status-note" role="status">
			{form.resolution === 'hidden'
				? 'Message hidden. The author and the reporter see a placeholder, and the decision is in the audit log.'
				: 'Message kept. It stays visible and the decision is in the audit log.'}
		</p>
	{/if}

	<section class="admin-panel" aria-labelledby="open-reports-title">
		<div class="panel-heading">
			<p class="section-label">OPEN REPORTS</p>
			<span class="lifecycle-status" class:status-open={data.open.length > 0}>
				{data.open.length} waiting
			</span>
		</div>
		<h2 id="open-reports-title" class="visually-hidden">Open reports</h2>

		{#if !data.isAdmin}
			<p class="panel-copy">
				Administrator privileges are required to review chat reports — nothing is shown here.
			</p>
		{:else if data.open.length === 0}
			<p class="panel-copy">
				No reported messages. Nobody has flagged anything in the league channel or a private
				conversation.
			</p>
		{:else}
			<ul class="report-list">
				{#each data.open as report (report.id)}
					<li class="report-card">
						<p class="report-kicker">
							{report.destination === 'channel' ? 'League channel' : 'Direct message'} ·
							{instantLabel(report.messageCreatedAt, data.timezone)}
						</p>
						<p class="report-author">
							Written by <strong>{report.messageAuthorName}</strong>
						</p>
						<blockquote class="report-body">{chatMessageText({
								state: report.messageState,
								body: report.messageBody
							})}</blockquote>
						<p class="report-reason">
							Reported by <strong>{report.reporterName}</strong> ·
							{instantLabel(report.createdAt, data.timezone)}
						</p>
						<p class="report-reason-text">“{report.reason}”</p>

						<form method="POST" action="?/review" class="review-form">
							<input type="hidden" name="reportId" value={report.id} />
							<label for="note-{report.id}">Decision note (required — recorded in the audit log)</label>
							<textarea
								id="note-{report.id}"
								name="note"
								rows="2"
								maxlength="500"
								required
								placeholder="Why you are hiding or keeping this message"
							></textarea>
							<div class="review-actions">
								<button class="review-hide" type="submit" name="decision" value="hide">
									Hide message
								</button>
								<button class="review-keep" type="submit" name="decision" value="keep">
									Keep message
								</button>
							</div>
						</form>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="admin-panel" aria-labelledby="resolved-reports-title">
		<div class="panel-heading">
			<p class="section-label">RECENT DECISIONS</p>
			<span class="lifecycle-status">{data.resolved.length} shown</span>
		</div>
		<h2 id="resolved-reports-title" class="visually-hidden">Resolved reports</h2>
		{#if data.resolved.length === 0}
			<p class="panel-copy">No chat report has been reviewed yet.</p>
		{:else}
			<ul class="resolved-list">
				{#each data.resolved as report (report.id)}
					<li class="resolved-row">
						<span class="resolved-badge" class:resolved-hidden={report.resolution === 'hidden'}>
							{report.resolution === 'hidden' ? 'Hidden' : 'Kept'}
						</span>
						<span class="resolved-text">
							<strong>{report.messageAuthorName}</strong>’s message, reported by
							{report.reporterName} — reviewed by {report.reviewedByName ?? 'an admin'}
							{report.reviewedAt ? `on ${instantLabel(report.reviewedAt, data.timezone)}` : ''}.
							<span class="resolved-note">“{report.reviewNote ?? ''}”</span>
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</section>

<style>
	.status-note {
		margin: 0 0 12px;
		padding: 10px 12px;
		border: 1px solid rgba(201, 232, 131, 0.35);
		border-radius: 12px;
		background: rgba(20, 70, 45, 0.4);
		color: #e6f5d8;
		font-size: 13px;
	}

	.report-list,
	.resolved-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 12px;
	}

	.report-card {
		padding: 14px;
		border: 1px solid rgba(163, 235, 196, 0.2);
		border-radius: 14px;
		background: rgba(0, 27, 19, 0.42);
	}

	.report-kicker {
		margin: 0 0 6px;
		color: #9fc0aa;
		font: 650 11px 'Manrope', sans-serif;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.report-author,
	.report-reason {
		margin: 0;
		color: #cfe6cf;
		font-size: 12.5px;
	}

	.report-body {
		margin: 8px 0;
		padding: 10px 12px;
		border-left: 3px solid rgba(201, 232, 131, 0.5);
		background: rgba(3, 42, 30, 0.6);
		border-radius: 0 10px 10px 0;
		color: #f3f8ec;
		font-size: 14px;
		white-space: pre-wrap;
	}

	.report-reason-text {
		margin: 4px 0 10px;
		color: #e6f5d8;
		font-size: 13.5px;
	}

	.review-form {
		display: grid;
		gap: 8px;
	}

	.review-form label {
		color: #cfe6cf;
		font-size: 12.5px;
		font-weight: 600;
	}

	.review-form textarea {
		width: 100%;
		border: 1px solid rgba(163, 235, 196, 0.24);
		border-radius: 12px;
		background: rgba(3, 42, 30, 0.85);
		color: var(--text);
		font: 400 14px 'DM Sans', sans-serif;
		padding: 9px 11px;
		resize: vertical;
	}

	.review-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}

	.review-hide,
	.review-keep {
		min-height: 44px;
		padding: 0 18px;
		border-radius: 999px;
		font: 700 13.5px 'Manrope', sans-serif;
		cursor: pointer;
	}

	.review-hide {
		border: 1px solid rgba(240, 180, 138, 0.6);
		background: rgba(120, 58, 26, 0.4);
		color: #f7d8bd;
	}

	.review-keep {
		border: 1px solid rgba(201, 232, 131, 0.55);
		background: rgba(20, 70, 45, 0.5);
		color: #e6f5d8;
	}

	.review-hide:focus-visible,
	.review-keep:focus-visible,
	.review-form textarea:focus-visible {
		outline: 2px solid var(--lime);
		outline-offset: 2px;
	}

	.resolved-row {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 10px 12px;
		border: 1px solid rgba(163, 235, 196, 0.14);
		border-radius: 12px;
		background: rgba(0, 27, 19, 0.3);
	}

	.resolved-badge {
		flex: 0 0 auto;
		padding: 3px 10px;
		border-radius: 999px;
		border: 1px solid rgba(201, 232, 131, 0.5);
		color: #e6f5d8;
		font: 700 11px 'Manrope', sans-serif;
	}

	.resolved-badge.resolved-hidden {
		border-color: rgba(240, 180, 138, 0.55);
		color: #f7d8bd;
	}

	.resolved-text {
		color: #bcd6c2;
		font-size: 12.5px;
		line-height: 1.5;
	}

	.resolved-note {
		display: block;
		color: #e6f5d8;
	}
</style>
