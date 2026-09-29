<script lang="ts">
	import PlayerAvatar from '$lib/components/PlayerAvatar.svelte';
	import type { StatsRecord } from '$lib/server/stats-page';

	let {
		kind,
		value,
		round
	}: {
		kind: string;
		value: StatsRecord;
		round: number;
	} = $props();
</script>

<article class="spotlight-card record-spotlight" aria-label={`${kind.toLowerCase()} in Round ${round}: ${value.value} points, ${value.holders.map((holder) => holder.name).join(' and ')}`}>
	<div class="record-score-ball" aria-hidden="true"><span>{value.value}</span></div>
	<div class="record-copy">
		<span class="spotlight-caption">{kind}</span>
		<strong>{value.value}<small> pts</small></strong>
		<span class="spotlight-names">{value.holders.map((holder) => holder.name).join(' & ')}</span>
		<span class="spotlight-subtle">Round {round}{value.holders.length > 1 ? ' · shared record' : ''}</span>
	</div>
	<div class="record-avatars" aria-hidden="true">
		{#each value.holders as holder (holder.playerId)}
			<PlayerAvatar player={holder} size="md" showName={false} />
		{/each}
	</div>
</article>

<style>
	.spotlight-card {
		position: relative;
		min-width: 0;
		min-height: 116px;
		padding: 14px;
		border: 1px solid rgba(194, 228, 168, 0.28);
		border-radius: 13px;
		background: linear-gradient(145deg, rgba(10, 80, 53, 0.94), rgba(4, 48, 37, 0.98));
		box-shadow: inset 0 1px rgba(255, 255, 255, 0.06), 0 10px 24px rgba(0, 20, 13, 0.12);
	}

	.record-spotlight { display: flex; align-items: center; gap: 11px; }
	.spotlight-caption { color: #d7e9b9; font-size: 8px; font-weight: 800; letter-spacing: 0.12em; }
	.spotlight-names { color: #f2f7e8; font: 700 12px 'Manrope', sans-serif; text-align: center; }
	.spotlight-subtle { color: #a9c7aa; font-size: 9px; text-align: center; }

	.record-score-ball {
		width: 49px;
		height: 49px;
		flex: none;
		border: 1px solid rgba(255, 255, 255, 0.32);
		border-radius: 50%;
		display: grid;
		place-items: center;
		background: radial-gradient(circle at 31% 24%, #ffedb0, #ce9c3b 57%, #795322 100%);
		box-shadow: inset -4px -5px 8px rgba(30, 22, 9, 0.35), 0 3px 12px rgba(239, 205, 114, 0.18);
		color: #30240d;
		font: 800 15px 'Manrope', sans-serif;
		font-variant-numeric: tabular-nums;
	}

	.record-copy { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
	.record-copy > strong { color: #f8f9e9; font: 800 18px 'Manrope', sans-serif; font-variant-numeric: tabular-nums; }
	.record-copy > strong small { color: #c9d9a6; font-size: 9px; font-weight: 600; }
	.record-avatars { display: flex; align-items: center; justify-content: center; gap: 3px; margin-left: auto; align-self: flex-end; }

	@media (max-width: 440px) { .record-spotlight { min-height: 100px; } }
</style>
