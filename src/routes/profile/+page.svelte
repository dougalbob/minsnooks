<script lang="ts">
	import PlayerAvatar from '$lib/components/PlayerAvatar.svelte';
	import { untrack } from 'svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const initial = untrack(() => ({
		contactVisible: data.profile ? (data.profile.contactVisible ? '1' : '0') : '1',
		phone: data.profile?.phone ?? ''
	}));
	let contactVisible = $state(initial.contactVisible);
	let phone = $state(initial.phone);

	const roleLabel = $derived.by(() => {
		if (!data.profile) return 'Guest';
		switch (data.profile.role) {
			case 'super_admin':
				return 'Super-admin (Full system & scoring administration)';
			case 'admin':
				return 'Admin (League operations & fixtures)';
			default:
				return 'League Player';
		}
	});
</script>

<svelte:head>
	<title>Minsnooks · Player Profile</title>
</svelte:head>

<section class="flow-screen">
	<div class="flow-header">
		<a class="back-link" href="/"><span aria-hidden="true">←</span> Home</a>
		<p class="flow-kicker">IDENTITY & PRIVACY · PROFILE SETTINGS</p>
		<h1>Player Profile</h1>
		<p class="flow-intro">
			Manage your contact details and visibility preferences within the Minsnooks league.
		</p>
	</div>

	{#if form?.message}
		<div
			class={form.success ? 'flow-success-card compact-success' : 'form-error'}
			role={form.success ? 'status' : 'alert'}
		>
			{#if form.success}
				<span class="success-mark" aria-hidden="true">✓</span>
			{/if}
			<p class="success-copy">{form.message}</p>
		</div>
	{/if}

	{#if !data.profile}
		<div class="flow-card signed-out-card">
			<div class="signed-out-badge">NOT SIGNED IN</div>
			<h2>No player signed in</h2>
			<p>
				You are currently viewing the league as an unauthenticated visitor.
				In production, sign in through Cloudflare Access. In this development preview,
				use the <strong>DEV PREVIEW</strong> bar above to switch to any registered player.
			</p>
		</div>
	{:else}
		<div class="profile-card">
			<div class="profile-header-strip">
				<PlayerAvatar
					player={{
						playerId: data.profile.id,
						name: data.profile.name,
						initials: data.profile.initials,
						tone: data.profile.tone
					}}
					size="lg"
					showName={false}
				/>
				<div class="profile-names">
					<h2 class="profile-title">{data.profile.name}</h2>
					<p class="profile-email">{data.profile.email}</p>
					<span class="role-badge role-{data.profile.role}">{roleLabel}</span>
				</div>
			</div>

			<form method="POST" action="?/updateProfile" class="profile-form">
				<div class="field-group">
					<label class="field-label" for="phone-input">Phone number (optional)</label>
					<p class="field-help">
						A contact number allows fellow players to coordinate match times by SMS or phone call.
					</p>
					<input
						class="flow-input"
						id="phone-input"
						name="phone"
						type="tel"
						placeholder="e.g. 07700 900123"
						bind:value={phone}
						maxlength="32"
					/>
				</div>

				<div class="field-group">
					<fieldset class="visibility-fieldset">
						<legend class="field-label">Contact details visibility</legend>
						<p class="field-help">
							In this family league, contact details are visible to other league members by default.
							You can hide them at any time if you prefer.
						</p>

						<div class="visibility-options">
							<label class="visibility-option" class:selected={contactVisible === '1'}>
								<input
									type="radio"
									name="contactVisible"
									value="1"
									bind:group={contactVisible}
								/>
								<div class="visibility-option-copy">
									<div class="option-title">
										<span>Visible to league members</span>
										<span class="default-pill">Default</span>
									</div>
									<p class="option-desc">
										Other authenticated players can see your email and phone number when viewing
										fixtures to arrange matches.
									</p>
								</div>
							</label>

							<label class="visibility-option" class:selected={contactVisible === '0'}>
								<input
									type="radio"
									name="contactVisible"
									value="0"
									bind:group={contactVisible}
								/>
								<div class="visibility-option-copy">
									<div class="option-title">
										<span>Hidden from other players</span>
									</div>
									<p class="option-desc">
										Keep your contact details private. Only league administrators will be able
										to see your contact details to help coordinate the schedule.
									</p>
								</div>
							</label>
						</div>
					</fieldset>
				</div>

				<div class="profile-actions">
					<button class="flow-submit-button" type="submit">Save profile settings</button>
				</div>
			</form>
		</div>

		<div class="security-info-card">
			<h3>Identity & Security Information</h3>
			<ul class="security-info-list">
				<li>
					<strong>Sign-in Identity:</strong> Authenticated cryptographically through Cloudflare Access
					(or the verified dev environment identity).
				</li>
				<li>
					<strong>Database Role:</strong> Your role ({data.profile.role}) is stored directly in SQLite and
					enforced server-side on every write path.
				</li>
				<li>
					<strong>Audit Trail:</strong> Any changes to profile settings or match entries are recorded in
					the league audit log with your player ID and timestamp.
				</li>
			</ul>
		</div>
	{/if}
</section>

<style>
	.profile-card {
		background: #0f4637;
		border: 1px solid rgba(231, 245, 221, 0.16);
		border-radius: 14px;
		padding: 24px;
		margin-bottom: 20px;
	}

	.profile-header-strip {
		display: flex;
		align-items: center;
		gap: 20px;
		padding-bottom: 20px;
		border-bottom: 1px solid rgba(231, 245, 221, 0.12);
		margin-bottom: 24px;
	}

	.profile-title {
		font-size: 22px;
		font-weight: 700;
		color: #f7faf4;
		margin: 0 0 4px 0;
	}

	.profile-email {
		font-size: 14px;
		color: #b7cebe;
		margin: 0 0 8px 0;
	}

	.role-badge {
		display: inline-block;
		font-size: 12px;
		font-weight: 600;
		padding: 3px 10px;
		border-radius: 12px;
		letter-spacing: 0.02em;
	}

	.role-super_admin {
		background: rgba(234, 179, 8, 0.2);
		color: #fef08a;
		border: 1px solid rgba(234, 179, 8, 0.4);
	}

	.role-admin {
		background: rgba(56, 189, 248, 0.2);
		color: #bae6fd;
		border: 1px solid rgba(56, 189, 248, 0.4);
	}

	.role-player {
		background: rgba(231, 245, 221, 0.12);
		color: #d1e7d8;
		border: 1px solid rgba(231, 245, 221, 0.25);
	}

	.field-group {
		margin-bottom: 24px;
	}

	.field-help {
		font-size: 13px;
		color: #b7cebe;
		margin: 4px 0 10px 0;
		line-height: 1.4;
	}

	.visibility-fieldset {
		border: none;
		padding: 0;
		margin: 0;
	}

	.visibility-options {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.visibility-option {
		display: flex;
		align-items: flex-start;
		gap: 14px;
		background: rgba(7, 43, 33, 0.5);
		border: 1px solid rgba(231, 245, 221, 0.14);
		border-radius: 10px;
		padding: 16px;
		cursor: pointer;
		transition: border-color 0.15s ease, background 0.15s ease;
	}

	.visibility-option:hover {
		border-color: rgba(231, 245, 221, 0.3);
		background: rgba(7, 43, 33, 0.7);
	}

	.visibility-option.selected {
		border-color: #55c48b;
		background: rgba(15, 60, 48, 0.8);
	}

	.visibility-option input[type='radio'] {
		margin-top: 3px;
		accent-color: #55c48b;
	}

	.visibility-option-copy {
		flex: 1;
	}

	.option-title {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 15px;
		font-weight: 600;
		color: #f7faf4;
		margin-bottom: 4px;
	}

	.default-pill {
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		background: rgba(85, 196, 139, 0.2);
		color: #86efac;
		padding: 1px 6px;
		border-radius: 6px;
	}

	.option-desc {
		font-size: 13px;
		color: #b7cebe;
		margin: 0;
		line-height: 1.4;
	}

	.profile-actions {
		margin-top: 24px;
	}

	.security-info-card {
		background: rgba(7, 43, 33, 0.4);
		border: 1px solid rgba(231, 245, 221, 0.1);
		border-radius: 12px;
		padding: 20px;
	}

	.security-info-card h3 {
		font-size: 15px;
		font-weight: 600;
		color: #d1e7d8;
		margin: 0 0 12px 0;
	}

	.security-info-list {
		margin: 0;
		padding-left: 18px;
		color: #b7cebe;
		font-size: 13px;
		line-height: 1.6;
	}

	.signed-out-card {
		padding: 30px;
		text-align: center;
	}

	.signed-out-badge {
		display: inline-block;
		font-size: 12px;
		font-weight: 700;
		background: rgba(239, 68, 68, 0.2);
		color: #fca5a5;
		border: 1px solid rgba(239, 68, 68, 0.4);
		padding: 3px 10px;
		border-radius: 10px;
		margin-bottom: 16px;
	}
</style>
