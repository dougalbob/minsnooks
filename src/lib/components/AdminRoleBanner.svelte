<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	let {
		viewer,
		isAdmin,
		isSuperAdmin,
		canManage = true,
		manageReason = null
	}: {
		viewer: { name: string; role: string } | null;
		isAdmin: boolean;
		isSuperAdmin: boolean;
		canManage?: boolean;
		manageReason?: string | null;
	} = $props();

	async function switchQuickRole(targetEmail: string) {
		const params = new URLSearchParams(page.url.searchParams);
		params.set('as', targetEmail);
		await goto(`${page.url.pathname}?${params.toString()}`, { invalidateAll: true });
	}
</script>

<div class="admin-role-banner" class:role-denied={!isAdmin}>
	<div class="role-banner-top">
		<div class="role-identity-block">
			{#if isSuperAdmin}
				<span class="role-pill pill-super">SUPER-ADMIN</span>
				<div class="role-identity-copy">
					<strong>Signed in as {viewer?.name}</strong>
					<span class="role-desc">Full system permissions: round management, scheduler, withdrawals, awards review, and season creation.</span>
				</div>
			{:else if isAdmin}
				<span class="role-pill pill-admin">ADMIN</span>
				<div class="role-identity-copy">
					<strong>Signed in as {viewer?.name}</strong>
					<span class="role-desc">Operational permissions: round management, scheduler, withdrawals, and awards review. Season creation is reserved for super-admin.</span>
				</div>
			{:else if viewer}
				<span class="role-pill pill-player">PLAYER (RESTRICTED)</span>
				<div class="role-identity-copy">
					<strong>Signed in as {viewer.name} (Player)</strong>
					<span class="role-desc">League player without administrator privileges. Administrative write actions are forbidden (HTTP 403).</span>
				</div>
			{:else}
				<span class="role-pill pill-visitor">NOT SIGNED IN</span>
				<div class="role-identity-copy">
					<strong>Unauthenticated Visitor</strong>
					<span class="role-desc">Sign in with an administrator account to perform administrative operations. All mutations are rejected.</span>
				</div>
			{/if}
		</div>

		{#if page.data.devIdentitySwitch}
			<div class="quick-role-switch">
				<span class="quick-switch-label">Test role:</span>
				<button
					type="button"
					class="quick-switch-btn"
					class:active={isSuperAdmin}
					onclick={() => switchQuickRole('maya.chen@example.test')}
					title="Switch to Maya Chen (super_admin)"
				>
					Super-admin
				</button>
				<button
					type="button"
					class="quick-switch-btn"
					class:active={isAdmin && !isSuperAdmin}
					onclick={() => switchQuickRole('jules.rivera@example.test')}
					title="Switch to Jules Rivera (admin)"
				>
					Admin
				</button>
				<button
					type="button"
					class="quick-switch-btn"
					class:active={viewer?.role === 'player'}
					onclick={() => switchQuickRole('leon.park@example.test')}
					title="Switch to Leon Park (player)"
				>
					Player
				</button>
				<button
					type="button"
					class="quick-switch-btn"
					class:active={!viewer}
					onclick={() => switchQuickRole('nobody')}
					title="Switch to unauthenticated visitor"
				>
					Visitor
				</button>
			</div>
		{/if}
	</div>

	{#if !canManage && manageReason}
		<div class="role-banner-warning">
			<span class="warning-icon" aria-hidden="true">🔒</span>
			<span>{manageReason}</span>
		</div>
	{/if}
</div>

<style>
	.admin-role-banner {
		background: rgba(15, 70, 55, 0.7);
		border: 1px solid rgba(231, 245, 221, 0.2);
		border-radius: 12px;
		padding: 14px 18px;
		margin-bottom: 20px;
	}

	.admin-role-banner.role-denied {
		background: rgba(80, 20, 20, 0.4);
		border-color: rgba(248, 113, 113, 0.35);
	}

	.role-banner-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 12px;
	}

	.role-identity-block {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}

	.role-identity-copy {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.role-identity-copy strong {
		color: #f7faf4;
		font-size: 14px;
	}

	.role-desc {
		color: #b7cebe;
		font-size: 12px;
		line-height: 1.4;
	}

	.role-pill {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.04em;
		padding: 3px 8px;
		border-radius: 6px;
		text-transform: uppercase;
		flex-shrink: 0;
	}

	.pill-super {
		background: rgba(234, 179, 8, 0.25);
		color: #fef08a;
		border: 1px solid rgba(234, 179, 8, 0.5);
	}

	.pill-admin {
		background: rgba(56, 189, 248, 0.25);
		color: #bae6fd;
		border: 1px solid rgba(56, 189, 248, 0.5);
	}

	.pill-player {
		background: rgba(251, 146, 60, 0.2);
		color: #fed7aa;
		border: 1px solid rgba(251, 146, 60, 0.4);
	}

	.pill-visitor {
		background: rgba(239, 68, 68, 0.2);
		color: #fca5a5;
		border: 1px solid rgba(239, 68, 68, 0.4);
	}

	.quick-role-switch {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}

	.quick-switch-label {
		font-size: 11px;
		font-weight: 600;
		color: #9eb8a7;
		text-transform: uppercase;
		margin-right: 2px;
	}

	.quick-switch-btn {
		background: rgba(231, 245, 221, 0.08);
		border: 1px solid rgba(231, 245, 221, 0.2);
		color: #d1e7d8;
		font-size: 12px;
		font-weight: 500;
		padding: 4px 10px;
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.quick-switch-btn:hover {
		background: rgba(231, 245, 221, 0.18);
		border-color: rgba(231, 245, 221, 0.4);
		color: #fff;
	}

	.quick-switch-btn.active {
		background: #55c48b;
		border-color: #55c48b;
		color: #072b21;
		font-weight: 700;
	}

	.role-banner-warning {
		margin-top: 10px;
		padding-top: 10px;
		border-top: 1px solid rgba(248, 113, 113, 0.2);
		display: flex;
		align-items: center;
		gap: 8px;
		color: #fca5a5;
		font-size: 13px;
	}

	.warning-icon {
		font-size: 14px;
	}
</style>
