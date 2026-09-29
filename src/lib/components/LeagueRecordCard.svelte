<script lang="ts">
	import PlayerAvatar from '$lib/components/PlayerAvatar.svelte';
	import type { StatsRecord } from '$lib/server/stats-page';

	let { record, title }: { record: StatsRecord; title: string } = $props();
</script>

<article class="league-record-card">
	<p class="card-eyebrow">{title}</p>
	{#if record.value !== null}
		<div class="league-record-value"><strong>{record.value}</strong><span>pts</span></div>
		{#each record.holders as holder (holder.playerId)}
			<div class="league-record-holder">
				<PlayerAvatar player={holder} size="md" showName={false} />
				<div><strong>{holder.name}</strong><small>Round {holder.roundNumber}{holder.frameNumber ? ` · Frame ${holder.frameNumber}` : ''}</small></div>
			</div>
		{/each}
	{:else}
		<div class="record-empty">No optional scores have been recorded yet.</div>
	{/if}
</article>

<style>
	.league-record-card { min-width: 0; min-height: 142px; padding: 13px; border: 1px solid rgba(221, 200, 132, 0.2); border-radius: 11px; background: radial-gradient(circle at 95% 6%, rgba(237, 202, 111, 0.1), transparent 35%), rgba(0, 31, 22, 0.18); }
	.card-eyebrow { margin: 0 0 4px; color: #b6d49e; font-size: 8px; font-weight: 800; letter-spacing: 0.14em; }
	.league-record-value { margin: 7px 0 9px; display: flex; align-items: baseline; gap: 5px; color: #f4d781; }
	.league-record-value strong { font: 800 27px 'Manrope', sans-serif; font-variant-numeric: tabular-nums; }
	.league-record-value span { color: #b7c99f; font-size: 9px; }
	.league-record-holder { display: flex; align-items: center; gap: 7px; margin-top: 6px; }
	.league-record-holder > div { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
	.league-record-holder strong { overflow: hidden; color: #e8f0df; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
	.league-record-holder small { color: #9eb99d; font-size: 8px; }
	.record-empty { min-height: 90px; display: grid; place-items: center; color: #9db99c; font-size: 10px; text-align: center; }
</style>
