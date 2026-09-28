<script lang="ts">
	import type { PlayerView } from '$lib/fixture-view';

	let {
		player,
		size = 'md',
		showName = true
	}: { player: PlayerView; size?: 'sm' | 'md' | 'lg'; showName?: boolean } = $props();
</script>

<span class="matchup-player">
	<span class="avatar avatar-{player.tone} avatar-size-{size}" aria-hidden="true">
		<span>{player.initials}</span>
	</span>
	{#if showName}
		<strong class="matchup-name">{player.name}</strong>
	{/if}
</span>

<style>
	.matchup-player {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.matchup-name {
		color: #f0f6e9;
		font: 600 14px 'Manrope', sans-serif;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.avatar-size-sm {
		width: 26px;
		height: 26px;
		font-size: 8px;
	}

	.avatar-size-md {
		width: 30px;
		height: 30px;
		font-size: 9px;
	}

	.avatar-size-lg {
		width: 38px;
		height: 38px;
		font-size: 11px;
	}
</style>
