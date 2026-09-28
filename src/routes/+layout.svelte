<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import DevIdentitySwitch from '$lib/components/DevIdentitySwitch.svelte';
	import { page } from '$app/state';
	import '../app.css';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	const viewerLabel = $derived.by(() => {
		if (!data.viewer) return 'Not signed in — nothing can be recorded';
		const role =
			data.viewer.role === 'super_admin'
				? 'super-admin'
				: data.viewer.role === 'admin'
					? 'admin'
					: null;
		return `Signed in as ${data.viewer.name}${role ? ` (${role})` : ''}`;
	});

	const nav = [
		{ href: '/', label: 'Home', icon: 'home' },
		{ href: '/fixtures', label: 'Fixtures', icon: 'fixtures' },
		{ href: '/stats', label: 'Stats', icon: 'stats' },
		{ href: '/knockout', label: 'Knockout', icon: 'knockout' }
	];
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#073b2c" />
	<meta
		name="description"
		content="Minsnooks — a family snooker league. Build preview with fictional data."
	/>
</svelte:head>

<div class="scene-glow" aria-hidden="true"></div>

<header class="topbar">
	<a class="brand" href="/" aria-label="Minsnooks home">
		<span class="brand-ball" aria-hidden="true"></span>
		<span>Minsnooks<span class="brand-spark">✦</span></span>
	</a>
	<div class="top-actions">
		{#if data.seasonLabel}
			<span class="top-season"><span class="season-dot" aria-hidden="true"></span>Season {data.seasonLabel}</span>
		{:else}
			<span class="top-season">No season seeded</span>
		{/if}
		<a class="top-admin" href="/admin">ADMIN</a>
		<span
			class={`profile-button avatar-${data.viewer?.tone ?? 'maya'}`}
			role="img"
			aria-label={viewerLabel}
			title={viewerLabel}
		>
			<span>{data.viewer?.initials ?? '—'}</span>
		</span>
	</div>
</header>

{#if data.devIdentitySwitch}
	<DevIdentitySwitch
		options={data.identityOptions}
		currentEmail={data.viewerEmail}
		isPreview={data.viewerIsPreview}
	/>
{/if}

<main>
	{@render children()}
</main>

<nav class="bottom-nav" aria-label="Main">
	{#each nav as item (item.href)}
		<a
			class="bottom-item"
			class:active={item.href === '/'
				? page.url.pathname === '/'
				: page.url.pathname.startsWith(item.href)}
			href={item.href}
			aria-current={item.href === page.url.pathname ? 'page' : undefined}
		>
			{#if item.icon === 'home'}
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></svg>
			{:else if item.icon === 'fixtures'}
				<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 11h18" /></svg>
			{:else if item.icon === 'stats'}
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-8M22 20H2" /></svg>
			{:else}
				<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 4v16M4 12h16" /></svg>
			{/if}
			<span>{item.label}</span>
		</a>
	{/each}
	<a class="bottom-item add-button" href="/fixtures" aria-label="Record a result">
		<span class="add-circle">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
		</span>
		<span>Record</span>
	</a>
</nav>
