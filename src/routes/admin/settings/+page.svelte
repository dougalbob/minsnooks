<script lang="ts">
	import AdminRoleBanner from '$lib/components/AdminRoleBanner.svelte';
	import type { PageData, ActionData } from './$types';
	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Minsnooks · League settings</title></svelte:head>

<section class="lifecycle-page" aria-labelledby="settings-title">
	<a class="back-link" href="/admin"><span aria-hidden="true">←</span> Admin</a>
	<header class="lifecycle-header">
		<p class="flow-kicker">LEAGUE CONTROL · SETTINGS</p>
		<h1 id="settings-title">Set the defaults</h1>
		<p class="flow-intro">These defaults guide future rounds and seasons. Saved round deadlines, season scoring and each player’s privacy choice remain unchanged.</p>
	</header>
	<nav class="admin-nav" aria-label="League control sections">
		<a class="admin-nav-link" href="/admin/rounds">Round lifecycle</a>
		<a class="admin-nav-link" href="/admin/reports">Reports & audit</a>
		<a class="admin-nav-link admin-nav-active" href="/admin/settings" aria-current="page">Settings</a>
	</nav>
	<AdminRoleBanner viewer={data.viewer} isAdmin={true} isSuperAdmin={data.isSuperAdmin} canManage={true} manageReason={null} />
	<form method="POST" class="admin-panel settings-form">
		<div class="panel-heading"><p class="section-label">FUTURE ROUND DEFAULTS</p></div>
		<div class="settings-grid">
			<div><label class="field-label" for="roundDurationDays">Round duration (days)</label><input class="flow-input" id="roundDurationDays" name="roundDurationDays" type="number" min="1" max="180" value={data.settings.roundDurationDays} required /></div>
			<div><label class="field-label" for="graceDays">Grace period (days)</label><input class="flow-input" id="graceDays" name="graceDays" type="number" min="0" max="90" value={data.settings.graceDays} required /></div>
		</div>
		<p class="panel-copy">The next round form starts with these values. Every opened round keeps its own immutable deadline and grace snapshot.</p>
		<div class="settings-grid">
			<div><label class="field-label" for="timezone">League timezone</label><input class="flow-input" id="timezone" name="timezone" value={data.settings.timezone} maxlength="64" autocomplete="off" required /><small>Use an IANA name, such as Europe/London. This is the default for future seasons; an existing season keeps its timezone.</small></div>
			<fieldset><legend class="field-label">New-member contact visibility</legend><label class="choice-card"><input type="radio" name="contactVisibilityDefault" value="visible" checked={data.settings.contactVisibilityDefault} /><span>Visible to league members by default</span></label><label class="choice-card"><input type="radio" name="contactVisibilityDefault" value="hidden" checked={!data.settings.contactVisibilityDefault} /><span>Hidden until a player chooses otherwise</span></label><small>Existing players’ profile privacy choices are never changed by this default.</small></fieldset>
		</div>
		{#if form?.message}<p class={form.error ? 'form-error' : 'form-success'} role={form.error ? 'alert' : 'status'}>{form.message}</p>{/if}
		<button class="primary-button" type="submit">Save league defaults</button>
	</form>
	<section class="admin-panel"><div class="panel-heading"><p class="section-label">SEASON SCORING</p></div><p class="panel-copy">Scoring is selected when a season is created by a super-admin. It is not editable during a season; open <a href="/admin/rounds">Round lifecycle</a> to start a new season once the current season’s final round is closed.</p><p class="panel-copy">Current authority: {data.isSuperAdmin ? 'you can create the next season' : 'super-admin only'}.</p></section>
</section>

<style>
	.settings-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr)); gap:1.2rem; margin:1rem 0; }
	.settings-grid small { display:block; color:var(--muted,#a5b7ad); margin-top:.45rem; line-height:1.45; }
	.settings-form fieldset { border:0; padding:0; margin:0; }
	.choice-card { display:flex; align-items:center; gap:.65rem; margin:.6rem 0; min-height:2.8rem; }
	.choice-card input { accent-color:#53d394; width:1.15rem; height:1.15rem; }
	.form-success { color:#91e8b8; }
</style>
