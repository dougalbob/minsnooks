<script lang="ts">
	import AdminRoleBanner from '$lib/components/AdminRoleBanner.svelte';
	import { formatInstantInZone } from '$lib/format';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	function auditLabel(value: string): string { return value.replaceAll('_', ' '); }
</script>

<svelte:head><title>Minsnooks · Admin reports</title></svelte:head>

<section class="lifecycle-page" aria-labelledby="reports-title">
	<a class="back-link" href="/admin"><span aria-hidden="true">←</span> Admin</a>
	<header class="lifecycle-header">
		<p class="flow-kicker">LEAGUE CONTROL · REPORTS</p>
		<h1 id="reports-title">League reports</h1>
		<p class="flow-intro">A read-only view of what needs attention and a bounded, newest-first audit trail.</p>
	</header>
	<nav class="admin-nav" aria-label="League control sections">
		<a class="admin-nav-link" href="/admin/rounds">Round lifecycle</a>
		<a class="admin-nav-link admin-nav-active" href="/admin/reports" aria-current="page">Reports & audit</a>
		<a class="admin-nav-link" href="/admin/settings">Settings</a>
		<a class="admin-nav-link" href="/admin/awards">Withdrawals & awards</a>
	</nav>
	<AdminRoleBanner viewer={data.viewer} isAdmin={true} isSuperAdmin={data.isSuperAdmin} canManage={true} manageReason={null} />

	<section class="admin-panel" aria-labelledby="unresolved-title">
		<div class="panel-heading"><p class="section-label" id="unresolved-title">UNRESOLVED FIXTURES</p><span class="lifecycle-status">{data.unresolvedFixtures.length}</span></div>
		{#if data.unresolvedFixtures.length === 0}<p class="panel-copy">No fixtures are unresolved. Every round fixture is confirmed, awarded or neutrally closed.</p>
		{:else}<ul class="queue-list">{#each data.unresolvedFixtures as item (item.fixtureId)}<li class="queue-item"><div class="queue-facts"><strong class="queue-players">{item.lowName} v {item.highName}</strong><span class="queue-meta">{item.seasonLabel} · Round {item.roundNumber} · {item.state === 'awaiting_confirmation' ? 'awaiting confirmation' : 'awaiting play'}{#if item.deadlineAt} · deadline {item.deadlineAt.slice(0,10)}{/if}{#if item.bookedDate} · planned {item.bookedDate}{/if}</span></div><a class="small-secondary" href="/fixtures/{item.fixtureId}">Open fixture</a></li>{/each}</ul>{#if data.unresolvedFixtures.length === 250}<p class="panel-copy">Showing the first 250 unresolved fixtures.</p>{/if}{/if}
	</section>

	<section class="admin-panel" aria-labelledby="confirm-title">
		<div class="panel-heading"><p class="section-label" id="confirm-title">AWAITING CONFIRMATION</p><span class="lifecycle-status">{data.awaitingConfirmations.length}</span></div>
		<p class="panel-copy">Submitted scores do not count in standings until the opponent confirms. <a href="/admin/results">Open result queue →</a></p>
		{#if data.awaitingConfirmations.length}<ul class="queue-list">{#each data.awaitingConfirmations as item (item.fixtureId)}<li class="queue-item"><span class="queue-players">{item.lowName} v {item.highName} · {item.seasonLabel} Round {item.roundNumber}</span><a class="small-secondary" href="/fixtures/{item.fixtureId}">Review</a></li>{/each}</ul>{/if}
	</section>

	<section class="admin-panel" aria-labelledby="awards-title">
		<div class="panel-heading"><p class="section-label" id="awards-title">AWARDS LEDGER · CURRENT SEASON</p><a class="small-secondary" href="/admin/awards">Manage awards</a></div>
		{#if data.awardLedger.length === 0}<p class="panel-copy">No administrative awards are recorded for the current season.</p>
		{:else}<div class="report-table-wrap"><table class="report-table"><thead><tr><th>Round</th><th>Player</th><th>Opponent</th><th>Table points</th><th>Source</th></tr></thead><tbody>{#each data.awardLedger as award (award.awardId)}<tr><td>{award.roundNumber}</td><td>{award.playerName}</td><td>{award.opponentName}</td><td>{award.tablePoints}</td><td>{award.sourceType.replaceAll('_',' ')}{#if award.drawValue !== null} · draw {award.drawValue}{/if}</td></tr>{/each}</tbody></table></div>{/if}
	</section>

	<section class="admin-panel" aria-labelledby="audit-title">
		<div class="panel-heading"><p class="section-label" id="audit-title">AUDIT TRAIL · LATEST 100</p><span class="lifecycle-status">{data.auditTrail.length} entries</span></div>
		{#if data.auditTrail.length === 0}<p class="panel-copy">No administrative activity has been recorded.</p>
		{:else}<ol class="report-audit">{#each data.auditTrail as entry (entry.id)}<li><div class="audit-top"><strong>{auditLabel(entry.action)}</strong><time datetime={entry.createdAt}>{formatInstantInZone(entry.createdAt, 'Europe/London') ?? entry.createdAt}</time></div><p>{entry.entityType} #{entry.entityId} · {entry.actorName ?? 'system'}{#if entry.reason} · Reason: {entry.reason}{/if}</p>{#if entry.detail}<details><summary>Change detail</summary><pre>{entry.detail}</pre></details>{/if}</li>{/each}</ol>{/if}
	</section>
</section>

<style>
	.report-table-wrap { overflow-x:auto; }
	.report-table { width:100%; border-collapse:collapse; text-align:left; }
	.report-table th,.report-table td { padding:.7rem .5rem; border-bottom:1px solid rgba(220,255,237,.12); }
	.report-audit { list-style:none; padding:0; margin:0; }
	.report-audit li { padding:1rem 0; border-bottom:1px solid rgba(220,255,237,.12); overflow-wrap:anywhere; }
	.audit-top { display:flex; justify-content:space-between; gap:1rem; flex-wrap:wrap; }
	.report-audit p { margin:.45rem 0; color:var(--muted,#a5b7ad); }
	.report-audit pre { white-space:pre-wrap; font:inherit; font-size:.82rem; }
</style>
