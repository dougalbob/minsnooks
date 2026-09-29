<script lang="ts">
	import AdminRoleBanner from '$lib/components/AdminRoleBanner.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	const cards = [
		{ href: '/admin/rounds', title: 'Round lifecycle', copy: 'Open and close rounds, review deadlines, manage withdrawals and start a new season.' },
		{ href: '/admin/results', title: 'Result queue', copy: 'Review submitted results and inspect result-specific history.' },
		{ href: '/admin/awards', title: 'Withdrawals & awards', copy: 'Resolve withdrawals and review source-linked award changes.' },
		{ href: '/admin/reports', title: 'Reports & audit', copy: 'Scan unresolved fixtures, the awards ledger and league-wide activity.' },
		{ href: '/admin/settings', title: 'League settings', copy: 'Set defaults for future rounds, seasons and new-member privacy.' },
		{ href: '/admin/chat', title: 'Chat reports', copy: 'Review reported messages using the audited hide-or-keep process.' }
	];
</script>
<svelte:head><title>Minsnooks · Admin</title></svelte:head>
<section class="lifecycle-page" aria-labelledby="admin-title">
	<header class="lifecycle-header"><p class="flow-kicker">LEAGUE CONTROL</p><h1 id="admin-title">Admin dashboard</h1><p class="flow-intro">Welcome, {data.viewer.name}. A clear view of the league’s operational queue.</p></header>
	<AdminRoleBanner viewer={data.viewer} isAdmin={true} isSuperAdmin={data.isSuperAdmin} canManage={true} manageReason={null} />
	<div class="admin-summary-grid"><a class="summary-card" href="/admin/reports"><span>Unplayed fixtures</span><strong>{data.unplayed}</strong></a><a class="summary-card" href="/admin/results"><span>Awaiting confirmation</span><strong>{data.awaitingConfirmation}</strong></a><a class="summary-card" href="/admin/awards"><span>Awards needing review</span><strong>{data.pendingAwardReviews}</strong></a></div>
	<div class="admin-destination-grid">{#each cards as card (card.href)}<a class="admin-destination" href={card.href}><span class="section-label">OPEN</span><h2>{card.title}<span aria-hidden="true"> ↗</span></h2><p>{card.copy}</p></a>{/each}</div>
	<p class="panel-copy">Current defaults: {data.settings.roundDurationDays} days per round · {data.settings.graceDays} grace days · {data.settings.timezone}. Changes apply to future snapshots only.</p>
</section>
<style>
	.admin-summary-grid,.admin-destination-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr)); gap:.9rem; margin:1.2rem 0; }
	.summary-card,.admin-destination { display:block; color:inherit; text-decoration:none; border:1px solid rgba(220,255,237,.15); border-radius:1.1rem; padding:1.1rem; background:rgba(5,48,35,.62); }
	.summary-card span { display:block; color:var(--muted,#a5b7ad); }
	.summary-card strong { display:block; font-size:2rem; margin-top:.35rem; }
	.admin-destination h2 { font-size:1.1rem; margin:.55rem 0; }
	.admin-destination p { color:var(--muted,#a5b7ad); line-height:1.5; margin:0; }
	.admin-destination:hover,.summary-card:hover { border-color:#70dca6; transform:translateY(-1px); }
	.admin-destination:focus-visible,.summary-card:focus-visible { outline:3px solid #f3cf63; outline-offset:3px; }
</style>
