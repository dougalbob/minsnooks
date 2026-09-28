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
</script>

<div class="dev-identity">
	<form class="dev-identity-form" method="GET" action={page.url.pathname}>
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
		<button class="dev-identity-button" type="submit">Switch</button>
	</form>
	<p class="dev-identity-note">
		Preview identity only: it exists so both sides of a result journey can be tried in one browser, works
		only in development, and never changes what the server allows.
	</p>
</div>
