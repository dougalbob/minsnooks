<script lang="ts">
	import PlayerAvatar from './PlayerAvatar.svelte';
	import type { PlayerView } from '$lib/fixture-view';

	let {
		left,
		right,
		size = 'md'
	}: { left: PlayerView; right: PlayerView; size?: 'sm' | 'md' | 'lg' } = $props();
</script>

<div class="matchup">
	<PlayerAvatar player={left} {size} />
	<span class="versus-mark" aria-hidden="true">vs</span>
	<span class="visually-hidden">against</span>
	<PlayerAvatar player={right} {size} />
</div>

<style>
	.matchup {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		min-height: 32px;
	}

	.versus-mark {
		color: #a9c4a7;
		font-size: 12px;
		font-weight: 600;
	}
</style>
