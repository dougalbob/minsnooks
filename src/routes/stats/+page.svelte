<script lang="ts">
	import PlayerAvatar from '$lib/components/PlayerAvatar.svelte';
	import LeagueRecordCard from '$lib/components/LeagueRecordCard.svelte';
	import StatsTrendChart from '$lib/components/StatsTrendChart.svelte';
	import type { TrendPoint } from '$lib/stats';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let activeView = $state<'mine' | 'league'>('mine');

	const personal = $derived(data.personal);
	const recentWins = $derived(personal?.recentForm.filter((result) => result.outcome === 'win').length ?? 0);
	const positionPoints = $derived<TrendPoint[]>(
		(personal?.leaguePositionHistory ?? []).map((point) => ({ ...point }))
	);
	const rollingPoints = $derived<TrendPoint[]>(
		(personal?.rollingFramesAverage ?? []).map((point) => ({
			id: `match-${point.resultId}`,
			date: point.playedDate,
			value: point.average,
			label: `Round ${point.roundNumber}`,
			detail: `Rolling average after Round ${point.roundNumber}; ${point.matchesInWindow} match${point.matchesInWindow === 1 ? '' : 'es'} in the window`
		}))
	);
	const pointsPerFramePoints = $derived<TrendPoint[]>(
		(personal?.pointsPerRound ?? []).flatMap((round) =>
			round.average === null
				? []
				: [{
						id: `round-${round.roundNumber}`,
						date: round.date,
						value: round.average,
						label: `Round ${round.roundNumber}`,
						detail: `Round ${round.roundNumber}: ${round.average.toFixed(1)} average points per frame; optional scores entered for ${round.recordedMatches} of ${round.eligibleMatches} matches`
					}]
		)
	);
	const positionMax = $derived(Math.max(2, ...positionPoints.map((point) => point.value)));
	const pointsMax = $derived(
		Math.max(50, Math.ceil(Math.max(0, ...pointsPerFramePoints.map((point) => point.value)) / 25) * 25)
	);

	function percentage(value: number | null): string {
		return value === null ? '—' : `${Math.round(value)}%`;
	}

	function average(value: number | null): string {
		return value === null ? '—' : value.toFixed(2);
	}

	function signed(value: number): string {
		return `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
	}

	function comparisonRounds(matches: Array<{ roundNumber: number }>): string {
		if (matches.length === 0) return '—';
		const first = matches[0].roundNumber;
		const last = matches[matches.length - 1].roundNumber;
		return first === last ? `R${first}` : `R${first}–R${last}`;
	}

	function pointsWindowLabel(points: number): string {
		return `${points} point${points === 1 ? '' : 's'}`;
	}
</script>

<svelte:head>
	<title>Minsnooks · Player Stats</title>
	<meta name="description" content="League-only player form, season trends, records and highlights." />
</svelte:head>

<section class="stats-page" aria-labelledby="stats-page-title">
	<div class="stats-intro">
		<a class="back-link" href="/"><span aria-hidden="true">←</span> Home</a>
		<div class="intro-orbit" aria-hidden="true"><span></span><span></span><span></span></div>
		<p class="flow-kicker">SEASON {data.season?.label ?? '—'} · LEAGUE ONLY</p>
		<h1 id="stats-page-title">Numbers with a story.</h1>
		<p class="flow-intro">Form, frame scoring and the little wins along the way.</p>
		<div class="stats-data-note"><span aria-hidden="true">●</span> Confirmed league matches only · no friendlies or awarded fixtures in performance stats</div>
	</div>

	<div class="stats-view-switch" role="group" aria-label="Choose stats view">
		<button
			type="button"
			class:active={activeView === 'mine'}
			aria-pressed={activeView === 'mine'}
			disabled={!personal}
			onclick={() => (activeView = 'mine')}
		>
			<span class="switch-icon" aria-hidden="true">◎</span>
			<span><strong>My Stats</strong><small>Your form & trends</small></span>
		</button>
		<button
			type="button"
			class:active={activeView === 'league'}
			aria-pressed={activeView === 'league'}
			onclick={() => (activeView = 'league')}
		>
			<span class="switch-icon league-switch-icon" aria-hidden="true">✦</span>
			<span><strong>League Stats</strong><small>Records & highlights</small></span>
		</button>
	</div>

	{#if activeView === 'mine'}
		{#if personal}
			<section class="stats-view" aria-labelledby="my-stats-title">
				<div class="player-identity-card">
					<PlayerAvatar player={personal.player} size="lg" showName={false} />
					<div class="identity-copy">
						<p class="card-eyebrow">YOUR SEASON SO FAR</p>
						<h2 id="my-stats-title">{personal.player.name}</h2>
						<p>Season {data.season?.label ?? '—'}{personal.roundSummary.roundNumber ? ` · Round ${personal.roundSummary.roundNumber}` : ''}</p>
					</div>
					<div class="position-chip">
						<strong>{personal.seasonSummary.position ? String(personal.seasonSummary.position).padStart(2, '0') : '—'}</strong>
						<span>season position</span>
					</div>
				</div>

				<section class="summary-panel" aria-labelledby="season-overview-title">
					<div class="panel-heading">
						<div><p class="card-eyebrow">SEASON OVERVIEW</p><h3 id="season-overview-title">The season in a frame</h3></div>
						<span class="season-label">{data.season?.label ?? '—'}</span>
					</div>
					<div class="season-metrics">
						<div class="primary-metric"><strong>{personal.seasonSummary.played}</strong><span>played</span></div>
						<div><strong>{personal.seasonSummary.wins}</strong><span>won</span></div>
						<div><strong>{personal.seasonSummary.losses}</strong><span>lost</span></div>
						<div class="rate-metric"><strong>{percentage(personal.seasonSummary.winRate)}</strong><span>win rate</span></div>
					</div>
					<div class="season-footline">
						<span>{personal.seasonSummary.framesWon} frames won</span>
						<span aria-hidden="true">·</span>
						<span>{personal.seasonSummary.framesLost} conceded</span>
						<span aria-hidden="true">·</span>
						<span>{average(personal.seasonSummary.averageFramesWon)} frames / match</span>
					</div>
				</section>

				<section class="round-form-grid" aria-label="Current round and recent form">
					<article class="round-summary-card">
						<p class="card-eyebrow">CURRENT ROUND</p>
						<h3>{personal.roundSummary.roundNumber ? `Round ${personal.roundSummary.roundNumber}` : 'No round yet'}</h3>
						<div class="round-record-line">
							<span><strong>{personal.roundSummary.played}</strong> played</span>
							<span><strong>{personal.roundSummary.wins}</strong> won</span>
							<span><strong>{personal.roundSummary.losses}</strong> lost</span>
						</div>
						<p class="round-rank">Round position <strong>{personal.roundSummary.position ?? '—'}</strong></p>
					</article>

					<article class="recent-form-card" aria-labelledby="recent-form-title">
						<div class="form-heading"><div><p class="card-eyebrow">LAST FIVE · LEAGUE MATCHES</p><h3 id="recent-form-title">Recent form</h3></div><span class="form-count">{recentWins} win{recentWins === 1 ? '' : 's'}</span></div>
						{#if personal.recentForm.length > 0}
							<ol class="form-tokens" aria-label={`Recent form: ${recentWins} wins in ${personal.recentForm.length} matches`}>
								{#each personal.recentForm as result (result.resultId)}
									<li class:form-win={result.outcome === 'win'} class:form-loss={result.outcome === 'loss'} aria-label={`${result.outcome === 'win' ? 'Win' : 'Loss'} against ${result.opponentName}, Round ${result.roundNumber}, ${result.framesWon}–${result.framesLost}`} title={`${result.outcome === 'win' ? 'Win' : 'Loss'} vs ${result.opponentName} · R${result.roundNumber}`}>
										<span aria-hidden="true">{result.outcome === 'win' ? '✓' : '×'}</span>
									</li>
								{/each}
							</ol>
							<p class="form-summary">{recentWins} win{recentWins === 1 ? '' : 's'} from the last {personal.recentForm.length} confirmed match{personal.recentForm.length === 1 ? '' : 'es'}. Newest result is on the right.</p>
						{:else}
							<p class="empty-copy">No confirmed league matches yet. Your first result will start the run.</p>
						{/if}
					</article>
				</section>

				{#if personal.mostImproved}
					<section class="my-improvement-card" aria-labelledby="my-improvement-title">
						<div class="improvement-symbol" aria-hidden="true">↗</div>
						<div class="improvement-copy">
							<p class="card-eyebrow">YOUR FORM · TWO EIGHT-MATCH WINDOWS</p>
							<h3 id="my-improvement-title">The trend behind your shout-out</h3>
							<p>{comparisonRounds(personal.mostImproved.previousMatches)} vs {comparisonRounds(personal.mostImproved.recentMatches)} · {personal.mostImproved.previousAverage.toFixed(2)} → {personal.mostImproved.recentAverage.toFixed(2)} frames per match</p>
						</div>
						<strong class:positive={personal.mostImproved.change > 0} class:negative={personal.mostImproved.change < 0}>{signed(personal.mostImproved.change)}</strong>
					</section>
				{/if}

				<div class="charts-stack">
					<StatsTrendChart
						title="League position"
						kicker="TABLE TRAJECTORY"
						description="Official league position after each confirmed result or table-point award. First place is at the top; tied places are shared."
						points={positionPoints}
						minValue={1}
						maxValue={positionMax}
						invert={true}
						decimals={0}
						emptyMessage="Your position line will appear after the first league table update."
					/>
					<StatsTrendChart
						title="Frames won per match"
						kicker="ROLLING FORM · LAST EIGHT"
						description="Average frames won across your most recent eight confirmed league matches. Early points use the matches available so far; the season average is in the overview above."
						points={rollingPoints}
						minValue={0}
						maxValue={data.season?.framesPerMatch ?? 3}
						decimals={2}
						valueSuffix="frm/match"
						referenceValue={personal.seasonSummary.averageFramesWon ?? undefined}
						referenceLabel="Season avg"
						emptyMessage="Your frame-form line will appear after your first confirmed league match."
					/>
					<section class="points-trend-card" aria-labelledby="points-trend-heading">
						<div class="points-trend-copy">
							<p class="card-eyebrow">OPTIONAL SCORE DETAIL</p>
							<h3 id="points-trend-heading">Average snooker points per frame</h3>
							<p>Only frames with recorded point scores appear. Breaks can be entered separately.</p>
							<div class="coverage-pill"><span aria-hidden="true">◉</span>{personal.pointsCoverage.recorded} of {personal.pointsCoverage.eligible} matches have frame-point detail{personal.pointsCoverage.percent === null ? '' : ` · ${Math.round(personal.pointsCoverage.percent)}%`}</div>
						</div>
						<StatsTrendChart
							title="Points scored per frame"
							kicker="BY ROUND"
							description="Your average points scored in frames with optional detail, grouped by round. Rounds without recorded frame points are omitted from the line; coverage is shown above."
							points={pointsPerFramePoints}
							minValue={0}
							maxValue={pointsMax}
							decimals={1}
							valueSuffix="pts"
							emptyMessage="No frame-point detail has been entered yet. This graph will never invent scores."
						/>
					</section>
				</div>

				<section class="records-section" aria-labelledby="personal-records-title">
					<div class="section-heading"><div><p class="card-eyebrow">PERSONAL BESTS · THIS SEASON</p><h3 id="personal-records-title">Your table moments</h3></div><span class="season-label">{data.season?.label ?? '—'}</span></div>
					<div class="personal-record-grid">
						<article class="personal-record-card">
							<span class="record-type">HIGHEST RECORDED BREAK</span>
							<strong>{personal.personalBestBreak.value ?? '—'}{#if personal.personalBestBreak.value !== null}<small> pts</small>{/if}</strong>
							<span>{personal.personalBestBreak.holders[0] ? `Round ${personal.personalBestBreak.holders[0].roundNumber}` : 'No break entered yet'}</span>
						</article>
						<article class="personal-record-card">
							<span class="record-type">BEST RECORDED SINGLE FRAME</span>
							<strong>{personal.personalBestFrame.value ?? '—'}{#if personal.personalBestFrame.value !== null}<small> pts</small>{/if}</strong>
							<span>{personal.personalBestFrame.holders[0] ? `Round ${personal.personalBestFrame.holders[0].roundNumber}` : 'No frame points entered yet'}</span>
						</article>
					</div>
					<p class="coverage-copy">Break entered in {personal.breakCoverage.recorded} of {personal.breakCoverage.eligible} of your confirmed matches. Optional frame points were entered in {personal.pointsCoverage.recorded} of {personal.pointsCoverage.eligible}.</p>
				</section>

				<section class="extra-stats-grid" aria-label="Match runs and opponent records">
					<article class="streak-card">
						<p class="card-eyebrow">MATCH RUNS</p>
						<h3>{personal.streaks.currentOutcome === 'win' ? `${personal.streaks.currentLength} in a row` : personal.streaks.currentOutcome === 'loss' ? `${personal.streaks.currentLength} losses running` : 'Ready for a run'}</h3>
						<p>Best winning streak this season <strong>{personal.streaks.bestWinLength}</strong></p>
					</article>
					<section class="head-to-head-card" aria-labelledby="head-to-head-title">
						<div class="section-heading"><div><p class="card-eyebrow">LEAGUE RIVALRIES</p><h3 id="head-to-head-title">Head to head</h3></div><span class="season-label">{personal.headToHead.length} played</span></div>
						{#if personal.headToHead.length > 0}
							<ul class="head-to-head-list">
								{#each personal.headToHead as opponent (opponent.opponent.playerId)}
									<li>
										<PlayerAvatar player={opponent.opponent} size="sm" showName={false} />
										<span class="opponent-name">{opponent.opponent.name}</span>
										<span class="opponent-record"><strong>{opponent.wins}–{opponent.losses}</strong><small>W–L</small></span>
										<span class="opponent-frames">{opponent.framesWon}–{opponent.framesLost}<small>frames</small></span>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="empty-copy">Opponent records will fill in as results are confirmed.</p>
						{/if}
					</section>
				</section>
			</section>
		{:else}
			<section class="signed-out-stats" aria-labelledby="signed-out-stats-title">
				<span class="signed-out-badge">PLAYER IDENTITY NEEDED</span>
				<h2 id="signed-out-stats-title">Your stats are waiting on you.</h2>
				<p>Choose a player in the DEV PREVIEW switcher above, or sign in through Cloudflare Access in production. League-wide records remain available in the other view.</p>
				<a class="stats-primary-link" href="/profile">Open profile</a>
			</section>
		{/if}
	{:else}
		<section class="stats-view league-view" aria-labelledby="league-stats-title">
			<div class="league-intro-card">
				<p class="card-eyebrow">SEASON {data.season?.label ?? '—'} · TO DATE</p>
				<h2 id="league-stats-title">The league, in little moments.</h2>
				<p>{data.league.confirmedMatches} confirmed league results feed these records. Optional score detail is never guessed.</p>
				<span class="season-label">{data.season?.label ?? 'No season seeded'}</span>
			</div>

			{#if data.league.mostImprovedReady && data.league.mostImproved.length > 0}
				<section class="league-improved-panel" aria-labelledby="league-improved-title">
					<div class="section-heading"><div><p class="card-eyebrow">FROZEN FOR ROUND {data.currentRound?.number ?? '—'}</p><h3 id="league-improved-title">Most Improved</h3></div><span class="improved-symbol-small" aria-hidden="true">↗</span></div>
					{#each data.league.mostImproved as winner (winner.player.playerId)}
						<div class="league-improved-row">
							<PlayerAvatar player={winner.player} size="lg" showName={false} />
							<div class="league-improved-copy">
								<strong>{winner.player.name}</strong>
								<span>{comparisonRounds(winner.previousMatches)} vs {comparisonRounds(winner.recentMatches)}</span>
								<small>{winner.previousAverage.toFixed(2)} → {winner.recentAverage.toFixed(2)} frames won per match</small>
							</div>
							<b class="improvement-value">{signed(winner.change)}</b>
						</div>
					{/each}
					<p class="coverage-copy">A player needs two full eight-match windows in this season. Each current-round snapshot uses results from earlier rounds only.</p>
				</section>
			{:else if data.league.mostImprovedReady}
				<div class="no-improvement-note"><strong>No positive shift this snapshot.</strong><span>Most Improved appears when a player's latest eight matches show a higher frames-won average than their previous eight.</span></div>
			{/if}

			<section class="league-records-section" aria-labelledby="league-records-title">
				<div class="section-heading"><div><p class="card-eyebrow">RECORDED THIS SEASON</p><h3 id="league-records-title">Season records</h3></div><span class="season-label">{data.season?.label ?? '—'}</span></div>
				<div class="league-record-grid">
					<LeagueRecordCard record={data.league.highestBreak} title="HIGHEST RECORDED BREAK" />
					<LeagueRecordCard record={data.league.bestFrame} title="BEST RECORDED SINGLE FRAME" />
				</div>
				<div class="coverage-strip">
					<p><strong>{data.league.breakCoverage.recorded} / {data.league.breakCoverage.eligible}</strong> player-match break records entered{data.league.breakCoverage.percent === null ? '' : ` · ${Math.round(data.league.breakCoverage.percent)}%`}</p>
					<p><strong>{data.league.frameCoverage.recorded} / {data.league.frameCoverage.eligible}</strong> confirmed matches include frame points{data.league.frameCoverage.percent === null ? '' : ` · ${Math.round(data.league.frameCoverage.percent)}%`}</p>
				</div>
			</section>

			<section class="league-scoreboard" aria-labelledby="league-scoreboard-title">
				<div class="section-heading"><div><p class="card-eyebrow">PLAYED MATCHES ONLY</p><h3 id="league-scoreboard-title">Season scorecards</h3></div><span class="season-label">W–L · frame form</span></div>
				<p class="scoreboard-note">Position follows the official table, including administrative table points. Played / won / lost and frame stats only count confirmed matches.</p>
				<ol class="league-player-list">
					{#each data.league.players as player (player.playerId)}
						<li>
							<span class="league-position">{String(player.position).padStart(2, '0')}</span>
							<PlayerAvatar player={player} size="sm" showName={false} />
							<span class="league-player-name">{player.name}</span>
							<span class="league-player-wl"><strong>{player.wins}–{player.losses}</strong><small>W–L</small></span>
							<span class="league-player-rate">{percentage(player.winRate)}</span>
							<span class="league-player-frames">{average(player.averageFramesWon)}<small>frames / match</small></span>
						</li>
					{/each}
				</ol>
			</section>
		</section>
	{/if}

	<p class="stats-footnote">League stats use confirmed played league results. Awards affect table position only; they never become wins, losses or frames.</p>
</section>


<style>
	.stats-page {
		position: relative;
		padding: 8px 0 20px;
	}

	.stats-intro {
		position: relative;
		min-height: 204px;
		padding: 0 5px 22px;
		overflow: hidden;
	}

	.back-link {
		position: relative;
		z-index: 2;
		display: inline-flex;
		align-items: center;
		gap: 7px;
		min-height: 38px;
		color: #c7ddb4;
		font-size: 12px;
		font-weight: 700;
		text-decoration: none;
	}
	.back-link:hover { color: #f2f8e8; }

	.intro-orbit {
		position: absolute;
		top: 40px;
		right: 45px;
		width: 150px;
		height: 100px;
		border: 1px solid rgba(199, 232, 131, 0.17);
		border-radius: 50%;
		transform: rotate(-18deg);
		background: radial-gradient(ellipse, rgba(193, 229, 122, 0.1), transparent 70%);
	}
	.intro-orbit span {
		position: absolute;
		width: 13px;
		height: 13px;
		border-radius: 50%;
		background: radial-gradient(circle at 30% 24%, #f4df9b, #b78234 76%);
		box-shadow: 0 0 13px rgba(240, 208, 122, 0.38);
	}
	.intro-orbit span:nth-child(1) { top: 3px; left: 25px; }
	.intro-orbit span:nth-child(2) { bottom: 8px; left: 66px; width: 8px; height: 8px; background: radial-gradient(circle at 30% 24%, #f4b4c7, #b14868 76%); }
	.intro-orbit span:nth-child(3) { right: 8px; top: 34px; width: 9px; height: 9px; background: radial-gradient(circle at 30% 24%, #b1d7f7, #3c70a7 76%); }

	.flow-kicker { margin: 15px 0 4px; color: #c3daa7; font-size: 9px; font-weight: 800; letter-spacing: 0.16em; }
	.stats-intro h1 { margin: 0; max-width: 590px; color: #f3f9e8; font: 800 clamp(30px, 6vw, 43px) 'Manrope', sans-serif; letter-spacing: -1.6px; line-height: 1.08; }
	.flow-intro { margin: 9px 0 0; color: #c1d5b9; font-size: 13px; }
	.stats-data-note { display: inline-flex; align-items: center; gap: 7px; margin-top: 13px; color: #a9c7a9; font-size: 9px; }
	.stats-data-note span { color: #c8e786; font-size: 8px; text-shadow: 0 0 8px rgba(200, 231, 134, 0.5); }

	.stats-view-switch {
		position: sticky;
		top: 0;
		z-index: 4;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 7px;
		margin: 0 0 15px;
		padding: 8px;
		border: 1px solid rgba(205, 235, 186, 0.17);
		border-radius: 13px;
		background: rgba(3, 43, 31, 0.93);
		box-shadow: 0 8px 22px rgba(0, 15, 10, 0.2);
		backdrop-filter: blur(12px);
	}

	.stats-view-switch button {
		min-width: 0;
		min-height: 54px;
		padding: 8px 11px;
		border: 1px solid transparent;
		border-radius: 9px;
		background: transparent;
		color: #aac5a8;
		text-align: left;
		font-family: 'DM Sans', sans-serif;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 9px;
	}
	.stats-view-switch button.active { border-color: rgba(206, 232, 158, 0.25); background: linear-gradient(145deg, rgba(112, 151, 75, 0.2), rgba(198, 225, 139, 0.08)); color: #f2f6e7; }
	.stats-view-switch button:disabled { opacity: 0.45; cursor: not-allowed; }
	.stats-view-switch button > span:last-child { display: flex; flex-direction: column; gap: 2px; }
	.stats-view-switch strong { font-size: 12px; }
	.stats-view-switch small { color: #a3bea2; font-size: 9px; }
	.switch-icon { width: 28px; height: 28px; flex: none; border-radius: 50%; display: grid; place-items: center; background: radial-gradient(circle at 30% 24%, #d6ef9b, #69a54c); color: #14391f; font-size: 16px; }
	.league-switch-icon { background: radial-gradient(circle at 30% 24%, #f5df9b, #bd8735); color: #412e0e; font-size: 13px; }

	.stats-view { display: grid; gap: 13px; }
	.player-identity-card, .summary-panel, .round-summary-card, .recent-form-card, .records-section, .streak-card, .head-to-head-card, .league-intro-card, .league-improved-panel, .league-records-section, .league-scoreboard, .signed-out-stats {
		border: 1px solid rgba(190, 228, 171, 0.25);
		border-radius: 14px;
		background: linear-gradient(150deg, rgba(8, 75, 51, 0.94), rgba(4, 47, 36, 0.98));
		box-shadow: inset 0 1px rgba(255, 255, 255, 0.04), 0 11px 24px rgba(0, 20, 13, 0.1);
	}

	.player-identity-card { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 14px 16px; }
	.identity-copy { min-width: 0; }
	.card-eyebrow { margin: 0 0 4px; color: #b6d49e; font-size: 8px; font-weight: 800; letter-spacing: 0.14em; }
	.identity-copy h2 { margin: 0; color: #f3f8e9; font: 700 17px 'Manrope', sans-serif; }
	.identity-copy > p:last-child { margin: 4px 0 0; color: #aac5a7; font-size: 10px; }
	.position-chip { margin-left: auto; min-width: 70px; padding: 7px 9px; border: 1px solid rgba(214, 235, 178, 0.19); border-radius: 10px; background: rgba(222, 242, 198, 0.055); display: flex; flex-direction: column; align-items: center; }
	.position-chip strong { color: #e8efc5; font: 800 19px 'Manrope', sans-serif; }
	.position-chip span { color: #a6c09f; font-size: 8px; text-align: center; }

	.summary-panel, .round-summary-card, .recent-form-card, .records-section, .streak-card, .head-to-head-card, .league-records-section, .league-scoreboard { padding: 15px; }
	.panel-heading, .section-heading, .form-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
	.panel-heading h3, .round-summary-card h3, .recent-form-card h3, .section-heading h3, .streak-card h3 { margin: 0; color: #f2f7e9; font: 700 15px 'Manrope', sans-serif; }
	.season-label { flex: none; display: inline-flex; align-items: center; justify-content: center; min-height: 27px; padding: 4px 9px; border: 1px solid rgba(216, 237, 192, 0.17); border-radius: 18px; background: rgba(222, 242, 198, 0.055); color: #c8ddae; font-size: 9px; font-weight: 700; white-space: nowrap; }
	.season-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; margin-top: 16px; }
	.season-metrics > div { min-width: 0; min-height: 66px; padding: 9px 6px; border: 1px solid rgba(214, 235, 195, 0.1); border-radius: 10px; background: rgba(0, 31, 22, 0.18); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; }
	.season-metrics strong { color: #f3f7e9; font: 800 21px 'Manrope', sans-serif; font-variant-numeric: tabular-nums; }
	.season-metrics span { color: #a9c3a8; font-size: 9px; }
	.season-metrics .rate-metric { border-color: rgba(205, 231, 141, 0.24); background: radial-gradient(circle, rgba(199, 226, 135, 0.1), rgba(0, 31, 22, 0.14)); }
	.season-metrics .rate-metric strong { color: #d9ec9e; }
	.season-footline { margin-top: 11px; display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; color: #b3cba8; font-size: 9px; font-variant-numeric: tabular-nums; }

	.round-form-grid { display: grid; grid-template-columns: minmax(180px, 0.75fr) minmax(0, 1.25fr); gap: 11px; }
	.round-summary-card h3 { margin-top: 2px; }
	.round-record-line { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
	.round-record-line span { padding: 6px 8px; border: 1px solid rgba(214, 235, 195, 0.12); border-radius: 9px; color: #a9c5a8; font-size: 9px; }
	.round-record-line strong { color: #f1f5e7; font-size: 13px; margin-right: 3px; }
	.round-rank { margin: 11px 0 0; color: #a9c3a8; font-size: 10px; }
	.round-rank strong { margin-left: 5px; color: #d7e99e; font-size: 13px; }
	.form-count { color: #cce99a; font: 800 12px 'Manrope', sans-serif; }
	.form-tokens { display: flex; gap: 7px; margin: 12px 0 0; padding: 0; list-style: none; }
	.form-tokens li { width: 32px; height: 32px; border: 1px solid rgba(255, 255, 255, 0.32); border-radius: 50%; display: grid; place-items: center; font: 800 17px 'Manrope', sans-serif; box-shadow: inset -2px -3px 5px rgba(0, 0, 0, 0.23), 0 2px 6px rgba(0, 0, 0, 0.2); }
	.form-win { background: radial-gradient(circle at 30% 22%, #bde99d, #398a51 75%); color: #092d1b; }
	.form-loss { background: radial-gradient(circle at 30% 22%, #efa7a0, #a93d42 75%); color: #310e15; }
	.form-summary { margin: 9px 0 0; color: #a8c2a5; font-size: 9px; }
	.empty-copy { margin: 11px 0 0; color: #adc5a8; font-size: 11px; line-height: 1.5; }

	.my-improvement-card { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border: 1px solid rgba(235, 204, 114, 0.31); border-radius: 14px; background: radial-gradient(circle at 4% 50%, rgba(239, 204, 114, 0.1), transparent 34%), linear-gradient(145deg, rgba(10, 77, 51, 0.96), rgba(5, 46, 36, 0.98)); }
	.improvement-symbol { flex: none; width: 38px; height: 38px; display: grid; place-items: center; border-radius: 50%; background: rgba(239, 204, 114, 0.14); color: #efd47b; font-size: 24px; }
	.improvement-copy { min-width: 0; flex: 1; }
	.improvement-copy h3 { margin: 2px 0 4px; color: #f3f5e7; font: 700 13px 'Manrope', sans-serif; }
	.improvement-copy p:last-child { margin: 0; color: #b6cbaa; font-size: 9px; line-height: 1.45; }
	.my-improvement-card > strong { color: #d2dba9; font: 800 19px 'Manrope', sans-serif; font-variant-numeric: tabular-nums; white-space: nowrap; }
	.my-improvement-card > strong.positive { color: #d5ed92; }
	.my-improvement-card > strong.negative { color: #f1a8a0; }

	.charts-stack { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; min-width: 0; }
	.points-trend-card { padding: 15px; border: 1px solid rgba(187, 224, 165, 0.23); border-radius: 14px; background: rgba(4, 47, 36, 0.72); }
	.points-trend-copy { margin-bottom: 12px; }
	.points-trend-copy h3 { margin: 0; color: #f0f7e8; font: 700 15px 'Manrope', sans-serif; }
	.points-trend-copy > p:last-of-type { margin: 5px 0 9px; color: #aec6a9; font-size: 10px; }
	.coverage-pill { width: fit-content; display: flex; align-items: center; gap: 6px; padding: 6px 9px; border: 1px solid rgba(202, 229, 156, 0.17); border-radius: 18px; background: rgba(213, 235, 179, 0.06); color: #c6dba8; font-size: 9px; }

	.records-section { margin-top: 1px; }
	.personal-record-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; margin-top: 13px; }
	.personal-record-card { min-width: 0; min-height: 99px; padding: 12px; border: 1px solid rgba(214, 235, 195, 0.12); border-radius: 11px; background: rgba(0, 31, 22, 0.2); display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
	.record-type { color: #b8d3a6; font-size: 8px; font-weight: 800; letter-spacing: 0.1em; }
	.personal-record-card > strong { color: #f4d881; font: 800 24px 'Manrope', sans-serif; font-variant-numeric: tabular-nums; }
	.personal-record-card > strong small { color: #c5d5a8; font-size: 10px; }
	.personal-record-card > span:last-child { color: #a4bea3; font-size: 9px; }
	.coverage-copy { margin: 10px 0 0; color: #9fb99f; font-size: 9px; line-height: 1.5; }

	.extra-stats-grid { display: grid; grid-template-columns: minmax(170px, 0.7fr) minmax(0, 1.3fr); gap: 11px; }
	.streak-card h3 { margin-top: 8px; color: #d8e99f; font-size: 18px; }
	.streak-card > p:last-child { margin: 10px 0 0; color: #aec5a7; font-size: 10px; }
	.streak-card > p:last-child strong { color: #f3f6e9; margin-left: 4px; }
	.head-to-head-card { min-width: 0; }
	.head-to-head-list, .league-player-list { list-style: none; padding: 0; margin: 12px 0 0; }
	.head-to-head-list li { min-width: 0; display: flex; align-items: center; gap: 8px; padding: 8px 1px; border-top: 1px solid rgba(211, 234, 196, 0.09); }
	.opponent-name { min-width: 0; flex: 1; overflow: hidden; color: #e7f0df; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
	.opponent-record, .opponent-frames { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; color: #e7f0df; font-variant-numeric: tabular-nums; font-size: 11px; }
	.opponent-record small, .opponent-frames small { color: #91ad96; font-size: 7px; letter-spacing: 0.06em; }

	.league-intro-card { position: relative; padding: 18px; overflow: hidden; background: radial-gradient(circle at 94% 14%, rgba(203, 232, 131, 0.13), transparent 30%), linear-gradient(145deg, rgba(10, 83, 54, 0.95), rgba(4, 44, 34, 0.98)); }
	.league-intro-card h2 { margin: 0; max-width: 510px; color: #f3f9e8; font: 800 24px 'Manrope', sans-serif; letter-spacing: -0.6px; }
	.league-intro-card > p:not(.card-eyebrow) { margin: 7px 0 12px; max-width: 530px; color: #b6cdae; font-size: 11px; line-height: 1.5; }
	.league-improved-panel { padding: 16px; border-color: rgba(232, 202, 119, 0.27); }
	.improved-symbol-small { color: #edd27a; font-size: 22px; }
	.league-improved-row { display: flex; align-items: center; gap: 10px; padding: 11px 0; border-top: 1px solid rgba(217, 237, 191, 0.1); }
	.league-improved-copy { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 3px; }
	.league-improved-copy strong { color: #f2f5e8; font: 700 12px 'Manrope', sans-serif; }
	.league-improved-copy span { color: #d2e3ae; font-size: 9px; }
	.league-improved-copy small { color: #9fb79d; font-size: 9px; }
	.improvement-value { color: #d5ea98; font: 800 17px 'Manrope', sans-serif; font-variant-numeric: tabular-nums; white-space: nowrap; }
	.no-improvement-note { display: flex; flex-direction: column; gap: 5px; padding: 13px 15px; border: 1px dashed rgba(205, 231, 180, 0.23); border-radius: 12px; color: #dce8ca; font-size: 11px; }
	.no-improvement-note span { color: #a9c1a4; font-size: 9px; }

	.league-record-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; margin-top: 12px; }
	.coverage-strip { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 11px; }
	.coverage-strip p { margin: 0; padding: 9px; border-radius: 9px; background: rgba(221, 241, 198, 0.05); color: #a8c1a5; font-size: 8px; line-height: 1.5; }
	.coverage-strip strong { color: #dce9bd; font-variant-numeric: tabular-nums; }

	.scoreboard-note { margin: 7px 0 0; color: #a7c0a4; font-size: 9px; line-height: 1.5; }
	.league-player-list li { min-width: 0; display: grid; grid-template-columns: 27px 28px minmax(80px, 1fr) 58px 48px 72px; align-items: center; gap: 7px; padding: 8px 0; border-top: 1px solid rgba(211, 234, 196, 0.09); }
	.league-position { color: #cee39a; text-align: center; font: 700 10px 'Manrope', sans-serif; font-variant-numeric: tabular-nums; }
	.league-player-name { min-width: 0; overflow: hidden; color: #ebf2e2; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
	.league-player-wl, .league-player-frames { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; color: #eef2e4; font-size: 10px; font-variant-numeric: tabular-nums; }
	.league-player-wl small, .league-player-frames small { color: #95b097; font-size: 7px; }
	.league-player-rate { color: #d6e8a1; text-align: right; font-size: 9px; font-weight: 700; font-variant-numeric: tabular-nums; }

	.signed-out-stats { padding: 22px; }
	.signed-out-badge { display: inline-flex; padding: 5px 8px; border-radius: 14px; background: rgba(223, 241, 198, 0.08); color: #c2d9a7; font-size: 8px; font-weight: 800; letter-spacing: 0.1em; }
	.signed-out-stats h2 { margin: 12px 0 6px; color: #f0f5e7; font: 700 19px 'Manrope', sans-serif; }
	.signed-out-stats p { margin: 0 0 15px; max-width: 560px; color: #adC5a8; font-size: 11px; line-height: 1.6; }
	.stats-primary-link { display: inline-flex; min-height: 40px; align-items: center; padding: 0 14px; border: 1px solid rgba(208, 234, 175, 0.25); border-radius: 9px; color: #e2efc8; font-size: 11px; font-weight: 700; text-decoration: none; }
	.stats-footnote { margin: 13px 2px 5px; padding: 11px 3px; border-top: 1px solid rgba(209, 234, 195, 0.12); color: #9fb99f; font-size: 9px; line-height: 1.5; }

	@media (max-width: 640px) {
		.round-form-grid, .extra-stats-grid { grid-template-columns: 1fr; }
		.league-record-grid { grid-template-columns: 1fr; }
		.league-player-list li { grid-template-columns: 24px 28px minmax(60px, 1fr) 48px 40px; }
		.league-player-frames { display: none; }
	}

	@media (max-width: 400px) {
		.season-metrics { gap: 4px; }
		.season-metrics > div { min-height: 58px; }
		.season-metrics strong { font-size: 18px; }
		.season-metrics span { font-size: 8px; }
		.season-footline { font-size: 8px; }
		.position-chip { min-width: 59px; padding-inline: 5px; }
		.league-player-list li { grid-template-columns: 22px 26px minmax(52px, 1fr) 41px 34px; gap: 4px; }
		.league-player-name { font-size: 9px; }
	}
</style>
