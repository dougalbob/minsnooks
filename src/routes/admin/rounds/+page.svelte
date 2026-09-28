<script lang="ts">
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const activeSummary = $derived(
		data.activeRound
			? data.season?.rounds.find((round) => round.roundId === data.activeRound?.id)
			: undefined
	);
	const canOpenRound = $derived(
		Boolean(
			data.season &&
			!data.activeRound &&
			!data.lastRound?.isFinal &&
			(!data.lastRound || data.lastRound.status === 'closed')
		)
	);
	const canCreateSeason = $derived(
		Boolean(data.season && !data.activeRound && data.lastRound?.status === 'closed' && data.lastRound.isFinal)
	);

	function formatInstant(value: string | null): string {
		if (!value) return 'No deadline';
		return new Intl.DateTimeFormat('en-GB', {
			timeZone: data.timezone,
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(value));
	}
</script>

<svelte:head>
	<title>Minsnooks · Round lifecycle</title>
</svelte:head>

<section class="lifecycle-page" aria-labelledby="lifecycle-title">
	<a class="back-link" href="/admin"><span aria-hidden="true">←</span> Admin</a>
	<header class="lifecycle-header">
		<p class="flow-kicker">LEAGUE CONTROL · PREVIEW CONSOLE</p>
		<h1 id="lifecycle-title">Round lifecycle</h1>
		<p class="flow-intro">
			Open a round from a saved roster, test deadline and grace handling, and inspect server-side auto-advance.
		</p>
		<p class="preview-warning">
			Fictional preview controls only. Mutations are disabled in production until the Phase 8 role gates land.
		</p>
	</header>

	<nav class="admin-nav" aria-label="League control sections">
		<a class="admin-nav-link admin-nav-active" href="/admin/rounds" aria-current="page">Round lifecycle</a>
		<a class="admin-nav-link" href="/admin/results">Result queue</a>
	</nav>

	{#if form?.message}
		<p class="lifecycle-flash" role="status" aria-live="polite">{form.message}</p>
	{/if}

	{#if data.season}
		<section class="lifecycle-season" aria-label="Current season">
			<div>
				<p class="section-label">ACTIVE SEASON</p>
				<h2>{data.season.label}</h2>
			</div>
			<div class="season-meta">
				<span>{data.season.timezone}</span>
				<span>{data.season.framesPerMatch} frames · {data.season.pointsPerFrame} point per frame</span>
			</div>
		</section>

		<section class="lifecycle-grid" aria-label="Round controls">
			<article class="admin-panel active-round-panel" aria-labelledby="active-round-title">
				<div class="panel-heading">
					<div>
						<p class="section-label">SCHEDULING STATUS</p>
						<h2 id="active-round-title">
							{#if activeSummary}Round {activeSummary.number}{:else}No round open{/if}
						</h2>
					</div>
					<span class:status-open={activeSummary} class="lifecycle-status">
						{activeSummary ? 'Open for scheduling' : 'Waiting for admin'}
					</span>
				</div>

				{#if activeSummary}
					<dl class="round-facts">
						<div><dt>Confirmed results</dt><dd>{activeSummary.progress.confirmed} / {activeSummary.progress.total}</dd></div>
						<div><dt>Awaiting confirmation</dt><dd>{activeSummary.progress.awaitingConfirmation}</dd></div>
						<div><dt>Still unplayed</dt><dd>{activeSummary.progress.unplayed}</dd></div>
						<div><dt>Neutral closures</dt><dd>{activeSummary.progress.closedUnplayed}</dd></div>
						<div><dt>Administrative awards</dt><dd>{activeSummary.progress.awarded}</dd></div>
						<div><dt>Grace period</dt><dd>{activeSummary.graceDays} days</dd></div>
					</dl>
					<p class="deadline-line">
						<strong>Deadline:</strong> {formatInstant(activeSummary.deadlineAt)} · closes unplayed fixtures only after the saved grace period.
					</p>

					<div class="admin-actions-row">
						{#if activeSummary.isFinal}
							<form method="POST" action="?/markFinal">
								<input type="hidden" name="roundId" value={activeSummary.roundId} />
								<input type="hidden" name="isFinal" value="false" />
								<button class="small-secondary" type="submit">Remove final-round mark</button>
							</form>
						{:else}
							<form method="POST" action="?/markFinal">
								<input type="hidden" name="roundId" value={activeSummary.roundId} />
								<input type="hidden" name="isFinal" value="true" />
								<button class="small-secondary" type="submit">Mark as season final</button>
							</form>
						{/if}
					</div>
				{:else}
					<p class="panel-copy">
						No scheduler work is run while this page loads. The final resolved round can trigger the next round; a final-season round waits for an admin to create another season.
					</p>
				{/if}
			</article>

			<article class="admin-panel scheduler-panel" aria-labelledby="scheduler-title">
				<p class="section-label">SERVER-SIDE WORKER</p>
				<h2 id="scheduler-title">Run the scheduler</h2>
				<p class="panel-copy">
					The app also checks deadlines on a process timer. This explicit preview action evaluates the same server worker at a chosen league-local time.
				</p>
				<form method="POST" action="?/runScheduler" class="admin-form">
					<label class="field-label" for="effectiveAt">Evaluate as of ({data.timezone})</label>
					<input
						class="flow-input"
						id="effectiveAt"
						name="effectiveAt"
						type="datetime-local"
						value={data.nowLocal}
					/>
					<p class="field-hint">
						To demo expiry, set this after the round deadline plus its grace days. A no-op run is still visible in the log.
					</p>
					<button class="small-primary" type="submit">Run server scheduler</button>
				</form>
			</article>
		</section>

		{#if canOpenRound}
			<section class="admin-panel setup-panel" aria-labelledby="open-round-title">
				<p class="section-label">ADMIN ACTION · SNAPSHOTTED AT OPEN</p>
				<h2 id="open-round-title">Open Round {data.nextNumber}</h2>
				<p class="panel-copy">
					The selected roster, deadline date and grace period are saved on this round. Future membership or settings changes will not rewrite the snapshot.
				</p>
				<form method="POST" action="?/openRound" class="admin-form">
					<fieldset class="player-picker">
						<legend>Players in this round</legend>
						<div class="player-picker-grid">
							{#each data.eligiblePlayers as player (player.id)}
								<label class="player-option">
									<input type="checkbox" name="playerIds" value={player.id} checked />
									<span class="avatar avatar-{player.tone}" aria-hidden="true"><span>{player.initials}</span></span>
									<span>{player.name}</span>
								</label>
							{/each}
						</div>
					</fieldset>
					<div class="form-field-grid">
						<div>
							<label class="field-label" for="deadlineDate">Round deadline ({data.timezone})</label>
							<input class="flow-input" id="deadlineDate" name="deadlineDate" type="date" value={data.defaultDeadlineDate} required />
						</div>
						<div>
							<label class="field-label" for="graceDays">Grace period in days</label>
							<input class="flow-input" id="graceDays" name="graceDays" type="number" min="0" max="90" value={data.defaults.graceDays} required />
						</div>
					</div>
					<label class="check-option final-check">
						<input type="checkbox" name="isFinal" value="true" />
						<span>Mark this as the season’s final round</span>
					</label>
					<button class="small-primary" type="submit">Open Round {data.nextNumber}</button>
				</form>
			</section>
		{/if}

		{#if canCreateSeason}
			<section class="admin-panel setup-panel" aria-labelledby="new-season-title">
				<p class="section-label">FINAL ROUND RESOLVED</p>
				<h2 id="new-season-title">Start a new season</h2>
				<p class="panel-copy">Seasons never begin automatically. An admin chooses the label and scoring rules; a first round must then be opened separately.</p>
				<form method="POST" action="?/createSeason" class="admin-form">
					<div class="form-field-grid">
						<div><label class="field-label" for="seasonLabel">Season label</label><input class="flow-input" id="seasonLabel" name="label" maxlength="32" placeholder="2027" required /></div>
						<div><label class="field-label" for="timezone">League timezone</label><input class="flow-input" id="timezone" name="timezone" value={data.timezone} required /></div>
						<div><label class="field-label" for="framesPerMatch">Frames per match</label><input class="flow-input" id="framesPerMatch" name="framesPerMatch" type="number" min="1" value={data.season.framesPerMatch} required /></div>
						<div><label class="field-label" for="pointsPerFrame">Points per frame</label><input class="flow-input" id="pointsPerFrame" name="pointsPerFrame" type="number" min="0" value={data.season.pointsPerFrame} required /></div>
						<div><label class="field-label" for="matchWinBonus">Match-win bonus</label><input class="flow-input" id="matchWinBonus" name="matchWinBonus" type="number" min="0" value={data.season.matchWinBonus} required /></div>
					</div>
					<button class="small-primary" type="submit">Create season</button>
				</form>
			</section>
		{/if}

		<section class="lifecycle-grid withdrawal-grid" aria-label="Withdrawal support">
			<article class="admin-panel" aria-labelledby="withdrawal-title">
				<p class="section-label">ROSTER PRESERVATION</p>
				<h2 id="withdrawal-title">Withdraw a player</h2>
				<p class="panel-copy">The current round snapshot and earned history stay intact. The player is excluded from future round rosters.</p>
				{#if data.eligiblePlayers.length > 0}
					<form method="POST" action="?/withdrawPlayer" class="admin-form">
						<label class="field-label" for="playerId">Player</label>
						<select class="flow-input" id="playerId" name="playerId" required>
							{#each data.eligiblePlayers as player (player.id)}<option value={player.id}>{player.name}</option>{/each}
						</select>
						<label class="field-label" for="withdrawReason">Reason for audit record</label>
						<input class="flow-input" id="withdrawReason" name="reason" maxlength="240" required />
						<button class="small-secondary" type="submit">Withdraw from future rounds</button>
					</form>
				{:else}
					<p class="panel-copy">No active players are available to withdraw.</p>
				{/if}
			</article>
			<article class="admin-panel" aria-labelledby="withdrawal-list-title">
				<p class="section-label">AUDITABLE MEMBERSHIP</p>
				<h2 id="withdrawal-list-title">Withdrawn from future rounds</h2>
				{#if data.withdrawals.length}
					<ul class="withdrawal-list">
						{#each data.withdrawals as withdrawal (withdrawal.player_name)}
							<li><strong>{withdrawal.player_name}</strong><span>From Round {withdrawal.effective_from_round} · {withdrawal.season_label}</span>{#if withdrawal.reason}<small>{withdrawal.reason}</small>{/if}</li>
						{/each}
					</ul>
				{:else}
					<p class="panel-copy">No players are withdrawn in this fictional league.</p>
				{/if}
			</article>
		</section>

		<section class="admin-panel round-history-panel" aria-labelledby="round-history-title">
			<p class="section-label">ROSTER & FIXTURE SNAPSHOTS</p>
			<h2 id="round-history-title">Rounds in Season {data.season.label}</h2>
			<div class="standings-scroll">
				<table>
					<caption class="visually-hidden">Round lifecycle, fixture states, deadlines and final-round marking.</caption>
					<thead><tr><th scope="col">Round</th><th scope="col">State</th><th scope="col">Roster</th><th scope="col">Confirmed</th><th scope="col">Awaiting</th><th scope="col">Unplayed</th><th scope="col">Closed</th><th scope="col">Grace</th><th scope="col">Deadline</th><th scope="col">Season end</th></tr></thead>
					<tbody>
						{#each data.season.rounds as round (round.roundId)}
							<tr>
								<th scope="row">{round.number}</th>
								<td><span class:status-open={round.status === 'open'} class="lifecycle-status">{round.status === 'open' ? 'Open' : 'Closed'}</span></td>
								<td>{round.playerCount}</td>
								<td>{round.progress.confirmed}</td>
								<td>{round.progress.awaitingConfirmation}</td>
								<td>{round.progress.unplayed}</td>
								<td>{round.progress.closedUnplayed}</td>
								<td>{round.graceDays}d</td>
								<td>{formatInstant(round.deadlineAt)}</td>
								<td>{round.isFinal ? 'Final round' : '—'}</td>
							</tr>
						{:else}
							<tr><td colspan="10">No rounds have been opened.</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="panel-copy">A round closes only when every fixture is confirmed, awarded or neutrally closed. Awaiting-confirmation submissions remain unresolved and block auto-advance.</p>
		</section>
	{:else}
		<section class="admin-panel" aria-labelledby="no-season-title">
			<h2 id="no-season-title">No seeded season</h2>
			<p class="panel-copy">Run <code>npm run seed</code> to load the fictional preview league before testing round lifecycle controls.</p>
		</section>
	{/if}

	<section class="admin-panel scheduler-log" aria-labelledby="scheduler-log-title">
		<p class="section-label">APPEND-ONLY PREVIEW RUNS</p>
		<h2 id="scheduler-log-title">Scheduler run log</h2>
		{#if data.runs.length}
			<ol class="run-list">
				{#each data.runs as run (run.id)}
					<li>
						<div class="run-meta"><strong>{run.trigger === 'timer' ? 'Process timer' : 'Admin run'}</strong><time datetime={run.evaluated_at}>{formatInstant(run.evaluated_at)}</time></div>
						{#if run.events.length}
							<ul>{#each run.events as event, index (`${event.kind}-${index}`)}<li>{event.message}</li>{/each}</ul>
						{:else}
							<p>No lifecycle changes were due.</p>
						{/if}
					</li>
				{/each}
			</ol>
		{:else}
			<p class="panel-copy">No scheduler runs recorded yet. Running a check adds an entry even when there is nothing to process.</p>
		{/if}
	</section>

	<footer class="footer-note">
		<span class="footer-ball" aria-hidden="true"></span>
		<a href="/">Return to the league table</a>
		<span class="footer-spark" aria-hidden="true">✦</span>
	</footer>
</section>
