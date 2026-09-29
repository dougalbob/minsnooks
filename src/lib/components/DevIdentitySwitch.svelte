<script lang="ts">
	/**
	 * Dev-only preview identity switch (provisional — Phase 8 replaces it).
	 *
	 * The Phase 6 journeys are two-sided: one player records a result, the other
	 * confirms it or sends it back. A preview runs with a single dev identity, so
	 * this strip lets the owner walk both halves in one browser. It is rendered
	 * only when dev identity is allowed (AUTH_MODE=dev, never production) and it
	 * can only select a player that already exists — roles still come from the
	 * database, and every write path still checks them server-side.
	 */
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	let {
		options,
		currentEmail,
		isPreview
	}: {
		options: Array<{ email: string; label: string; initials: string; role: string }>;
		currentEmail: string | null;
		isPreview: boolean;
	} = $props();

	const preservedParams = $derived(
		[...page.url.searchParams.entries()].filter(([key]) => key !== 'as')
	);
	const selected = $derived(isPreview && currentEmail ? currentEmail : 'none');

	async function switchViewer(event: SubmitEvent) {
		// Drive this through SvelteKit navigation rather than leaving the preview
		// chooser dependent on the browser's native GET form navigation. The
		// identity cookie is set in hooks.server.ts and invalidateAll refreshes
		// the root layout's viewer data immediately.
		event.preventDefault();
		const params = new URLSearchParams();
		new FormData(event.currentTarget as HTMLFormElement).forEach((value, key) => {
			params.append(key, String(value));
		});
		await goto(`${page.url.pathname}?${params.toString()}`, { invalidateAll: true });
	}
</script>

<div class="dev-identity">
	<form class="dev-identity-form" method="GET" action={page.url.pathname} onsubmit={switchViewer}>
		{#each preservedParams as [key, value] (`${key}=${value}`)}
			<input type="hidden" name={key} value={value} />
		{/each}
		<label class="dev-identity-label" for="dev-viewer">
			<span class="dev-identity-tag">DEV PREVIEW</span>
			Signed in as
		</label>
		<select class="dev-identity-select" id="dev-viewer" name="as">
			<option value="none" selected={selected === 'none'}>The dev identity (default)</option>
			{#each options as option (option.email)}
				<option value={option.email} selected={selected === option.email}>
					{option.label}
				</option>
			{/each}
			<option value="nobody" selected={selected === 'nobody'}>
				Nobody — a signed-out visitor
			</option>
		</select>
		<button class="dev-identity-button" type="submit">Switch user</button>
	</form>
	<p class="dev-identity-note">
		Preview identity only: it exists so both sides of a result journey can be tried in one browser, works
		only in development, and never changes what the server allows.
	</p>
</div>
