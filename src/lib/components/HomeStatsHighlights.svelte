<script lang="ts">
	import HomeStatRecord from '$lib/components/HomeStatRecord.svelte';
	import PlayerAvatar from '$lib/components/PlayerAvatar.svelte';
	import type { HomeStatsHighlights } from '$lib/server/stats-page';

	let { highlights }: { highlights: HomeStatsHighlights } = $props();

	const improved = $derived(highlights.mostImprovedReady ? highlights.mostImproved : []);
	const showBreak = $derived(
		highlights.currentRoundRecordsReady && highlights.currentRoundHighestBreak.value !== null
	);
	const showFrame = $derived(
		highlights.currentRoundRecordsReady && highlights.currentRoundBestFrame.value !== null
	);
	const hasAnything = $derived(improved.length > 0 || showBreak || showFrame);

</script>

{#if hasAnything}
	<section class="round-spotlight" aria-labelledby="round-spotlight-title">
		<div class="spotlight-heading">
			<div>
				<p class="section-label">SMALL WINS, BIG MOMENTS</p>
				<h2 id="round-spotlight-title">Round {highlights.currentRoundNumber ?? '—'} spotlight</h2>
			</div>
			<a href="/stats" class="spotlight-link">More stats <span aria-hidden="true">→</span></a>
		</div>

		<div class="spotlight-grid">
			{#if improved.length > 0}
				<a class="spotlight-card improved-spotlight" href="/stats" aria-label={`Most Improved${improved.length > 1 ? ' — shared by ' : ' — '}${improved.map((winner) => winner.player.name).join(' and ')}. View stats for the comparison.`}>
					<span class="improved-symbol" aria-hidden="true">
						<svg viewBox="0 0 24 24" fill="none">
							<circle cx="12" cy="12" r="10" />
							<path d="m6.5 15.5 4-4 2.7 2.5 4.3-5.3M14.7 8.7h2.8v2.8" />
						</svg>
					</span>
					<span class="spotlight-caption">MOST IMPROVED</span>
					<span class="spotlight-avatars">
						{#each improved as winner (winner.player.playerId)}
							<PlayerAvatar player={winner.player} size="lg" showName={false} />
						{/each}
					</span>
					<span class="spotlight-names">{improved.map((winner) => winner.player.name).join(' & ')}</span>
					<span class="spotlight-subtle">A little form worth celebrating</span>
				</a>
			{/if}

			{#if showBreak}
				<HomeStatRecord
					kind="HIGHEST RECORDED BREAK"
					value={highlights.currentRoundHighestBreak}
					round={highlights.currentRoundNumber ?? 0}
				/>
			{/if}

			{#if showFrame}
				<HomeStatRecord
					kind="BEST RECORDED FRAME"
					value={highlights.currentRoundBestFrame}
					round={highlights.currentRoundNumber ?? 0}
				/>
			{/if}
		</div>
	</section>
{/if}

<style>
	.round-spotlight {
		margin: 22px 0 6px;
	}

	.spotlight-heading {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 11px;
	}

	.spotlight-heading h2 {
		margin: 0;
		color: #f5faee;
		font: 700 18px 'Manrope', sans-serif;
		letter-spacing: -0.35px;
	}

	.section-label {
		margin: 0 0 4px;
		color: #bad3ae;
		font-size: 9px;
		letter-spacing: 0.16em;
		font-weight: 700;
	}

	.spotlight-link {
		flex: none;
		color: #d4e99c;
		font-size: 11px;
		font-weight: 700;
		text-decoration: none;
		padding: 7px 0 4px 8px;
	}

	.spotlight-link:hover { color: #fff5cb; }

	.spotlight-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
		gap: 9px;
	}

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

	.improved-spotlight {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 5px;
		color: inherit;
		text-decoration: none;
		background:
			radial-gradient(circle at 50% 3%, rgba(239, 205, 114, 0.14), transparent 55%),
			linear-gradient(145deg, rgba(10, 80, 53, 0.97), rgba(4, 48, 37, 0.98));
	}

	.improved-spotlight:hover {
		border-color: rgba(239, 205, 114, 0.62);
		transform: translateY(-1px);
	}

	.improved-symbol {
		width: 27px;
		height: 27px;
		display: grid;
		place-items: center;
		color: #f2d77f;
		filter: drop-shadow(0 2px 7px rgba(239, 205, 114, 0.28));
	}

	.improved-symbol svg { width: 24px; height: 24px; }
	.improved-symbol circle { stroke: currentColor; stroke-width: 1.4; fill: rgba(239, 205, 114, 0.12); }
	.improved-symbol path { stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.65; }

	.spotlight-caption {
		color: #d7e9b9;
		font-size: 8px;
		font-weight: 800;
		letter-spacing: 0.12em;
	}

	.spotlight-avatars {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
	}

	.spotlight-names {
		color: #f2f7e8;
		font: 700 12px 'Manrope', sans-serif;
		text-align: center;
	}

	.spotlight-subtle {
		color: #a9c7aa;
		font-size: 9px;
		text-align: center;
	}

	@media (max-width: 440px) {
		.spotlight-grid { grid-template-columns: 1fr; }
	}

	@media (prefers-reduced-motion: no-preference) {
		.improved-spotlight { transition: transform 160ms ease, border-color 160ms ease; }
	}
</style>
