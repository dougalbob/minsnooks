<script lang="ts">
	import AdminRoleBanner from '$lib/components/AdminRoleBanner.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	function formatInstant(value: string): string {
		return new Intl.DateTimeFormat('en-GB', {
			timeZone: data.timezone,
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(value));
	}

	/** A stored league-local calendar date, shown without inventing a time. */
	function formatPlayedDate(value: string): string {
		return new Intl.DateTimeFormat('en-GB', {
			timeZone: data.timezone,
			weekday: 'short',
			day: 'numeric',
			month: 'short'
		}).format(new Date(`${value}T12:00:00Z`));
	}

	interface StatusTone {
		label: string;
		tone: 'inviting' | 'progress' | 'done' | 'won';
	}

	function competitionStatus(competition: PageData['competitions'][number]): StatusTone {
		if (competition.completedAt) {
			return {
				label: competition.winner ? 'Complete' : 'Closed — no winner',
				tone: 'won'
			};
		}
		if (competition.status === 'inviting') return { label: 'Replies open', tone: 'inviting' };
		if (competition.status === 'abandoned') return { label: 'Attempt abandoned', tone: 'done' };
		if (competition.status === 'selected') return { label: 'Entrants selected', tone: 'progress' };
		return { label: 'Underway', tone: 'progress' };
	}

	function lastStage(competition: PageData['competitions'][number]) {
		return competition.stages.length ? competition.stages[competition.stages.length - 1] : null;
	}

	function dropoutCandidates(competition: PageData['competitions'][number]) {
		const dropped = new Set(competition.dropouts.map((entry) => entry.player.playerId));
		return competition.selectedPlayers.filter((player) => !dropped.has(player.playerId));
	}

	function dropoutKindLabel(kind: string): string {
		if (kind === 'paired') return 'Opponent advanced on a walkover — no result invented';
		if (kind === 'bye') return 'Bye voided — the next stage is drawn afresh from the rest';
		return 'Left the competition before the next draw';
	}

	function arrangedLabel(date: string, time: string | null): string {
		return time ? `Arranged for ${formatPlayedDate(date)} · ${time}` : `Arranged for ${formatPlayedDate(date)}`;
	}
</script>

<svelte:head>
	<title>Minsnooks · Knockout</title>
	<meta name="description" content="Enter the Minsnooks family knockout, follow the draw and record results." />
</svelte:head>

<section class="knockout-page" aria-labelledby="knockout-title">
	<header class="knockout-hero">
		<a class="back-link" href="/fixtures"><span aria-hidden="true">←</span> Fixtures &amp; results</a>
		<div class="hero-content">
			<div class="hero-copy">
				<p class="eyebrow"><span class="cue-dot" aria-hidden="true"></span>THE FAMILY KNOCKOUT</p>
				<h1 id="knockout-title">A fresh draw.<br /><span>Your shot at glory.</span></h1>
				<p class="hero-intro">
					Opt in before the reply deadline. Once entries close, the server saves the draw — arrange your
					ties, play to the target, and every stage is drawn fresh from whoever is still standing.
				</p>
				<div class="hero-rules" aria-label="Knockout rules">
					<span><strong>6–8</strong> selected players</span>
					<span><strong>First to 2, 3 or 4</strong> frames, all the way to the final</span>
					<span>Fresh draw at every stage</span>
				</div>
			</div>
			<div class="draw-mark" aria-hidden="true">
				<span class="draw-ring ring-one"></span>
				<span class="draw-ring ring-two"></span>
				<span class="draw-ball">8</span>
				<span class="draw-spark spark-one">✦</span>
				<span class="draw-spark spark-two">✧</span>
			</div>
		</div>
	</header>

	<AdminRoleBanner
		viewer={data.viewer}
		isAdmin={data.isAdmin}
		isSuperAdmin={data.isSuperAdmin}
		canManage={data.canManage}
		manageReason={data.manageReason}
	/>

	{#if data.savedTieId}
		<p class="knockout-flash" role="status" aria-live="polite">
			Result saved — the bracket below is up to date, straight from the audit trail.
		</p>
	{/if}
	{#if form?.message}
		<p class="knockout-flash" role="status" aria-live="polite">{form.message}</p>
	{/if}

	{#if data.isAdmin}
		<section class="admin-panel announce-panel" aria-labelledby="announce-title">
			<div class="panel-heading">
				<div>
					<p class="section-label">ADMIN · NEW COMPETITION</p>
					<h2 id="announce-title">Announce an invitation</h2>
				</div>
				<span class="panel-orb" aria-hidden="true">✦</span>
			</div>
			<p class="panel-copy">Set the reply deadline and lock the match format now. The invitation appears in-app for active league players.</p>
			<form method="POST" action="?/announce" class="announce-form">
				<div class="form-row">
					<div class="field field-wide">
						<label for="competition-title">Competition name</label>
						<input id="competition-title" name="title" maxlength="80" placeholder="Autumn knockout" required />
					</div>
					<div class="field">
						<label for="knockout-format">Match format</label>
						<select id="knockout-format" name="framesToWin" required>
							<option value="2">First to 2 frames · best of 3</option>
							<option value="3" selected>First to 3 frames · best of 5</option>
							<option value="4">First to 4 frames · best of 7</option>
						</select>
					</div>
				</div>
				<div class="form-row">
					<div class="field field-wide">
						<label for="knockout-announcement">Invitation note <span>(optional)</span></label>
						<textarea id="knockout-announcement" name="announcement" maxlength="500" rows="2" placeholder="Fancy a few frames? Let us know by the date below."></textarea>
					</div>
					<div class="field">
						<label for="knockout-deadline">Reply deadline <span>({data.timezone})</span></label>
						<input id="knockout-deadline" name="replyDeadline" type="datetime-local" value={data.defaultDeadline} required />
						<small>After this time, entry closes. If fewer than six opt in, the attempt is abandoned — no extension or smaller event.</small>
					</div>
				</div>
				<button class="primary-button" type="submit"><span aria-hidden="true">＋</span> Post invitation</button>
			</form>
		</section>
	{/if}

	<section class="competition-section" aria-labelledby="competitions-title">
		<div class="section-heading">
			<div>
				<p class="section-label">THE ROAD TO THE FINAL</p>
				<h2 id="competitions-title">Knockout invitations</h2>
			</div>
			<span class="section-count">{data.competitions.length} {data.competitions.length === 1 ? 'competition' : 'competitions'}</span>
		</div>

		{#if data.competitions.length === 0}
			<article class="empty-state">
				<div class="empty-balls" aria-hidden="true"><span></span><span></span><span></span></div>
				<h3>No knockout announced yet</h3>
				<p>{data.isAdmin ? 'Create an invitation above to get the entries rolling.' : 'When an admin posts an invitation, it will appear here with its reply deadline.'}</p>
			</article>
		{:else}
			<div class="competition-list">
				{#each data.competitions as competition (competition.competitionId)}
					{@const status = competitionStatus(competition)}
					<article class="competition-card" aria-labelledby={`competition-${competition.competitionId}`} id={`competition-${competition.competitionId}`}>
						<div class="competition-topline">
							<div>
								<p class="section-label">KNOCKOUT · INVITATION {competition.competitionId}</p>
								<h3 id={`competition-${competition.competitionId}`}>{competition.title}</h3>
							</div>
							<span class="status-pill" class:status-inviting={status.tone === 'inviting'} class:status-won={status.tone === 'won'} class:status-done={status.tone !== 'inviting' && status.tone !== 'won'}>
								<span class="status-dot" aria-hidden="true"></span>{status.label}
							</span>
						</div>

						{#if competition.announcement}
							<p class="announcement-note">“{competition.announcement}”</p>
						{/if}

						<dl class="competition-facts">
							<div><dt>Format</dt><dd>First to {competition.framesToWin}</dd></div>
							<div><dt>Reply by</dt><dd>{formatInstant(competition.replyDeadlineAt)}</dd></div>
							{#if competition.status === 'inviting'}
								<div><dt>Opted in</dt><dd>{competition.optedInPlayers.length}</dd></div>
							{:else}
								<div><dt>Selected</dt><dd>{competition.selectedPlayers.length} of 8</dd></div>
							{/if}
						</dl>

						{#if competition.status === 'inviting'}
							<div class="entry-panel">
								<div class="entry-copy">
									<strong>{#if competition.viewerOptedIn === true}You’re in the hat.{:else if competition.viewerOptedIn === false}You’re not entered yet.{:else}Fancy joining in?{/if}</strong>
									<span>{competition.optedInPlayers.length} {competition.optedInPlayers.length === 1 ? 'player has' : 'players have'} opted in. Six are needed to run the event; eight places are available.</span>
								</div>
								{#if competition.canRespond}
									<form method="POST" action="?/respond" class="response-form">
										<input type="hidden" name="competitionId" value={competition.competitionId} />
										{#if competition.viewerOptedIn === true}
											<button class="quiet-button" type="submit" name="optedIn" value="false">Change to not entering</button>
										{:else}
											<button class="primary-button" type="submit" name="optedIn" value="true">I’m in for the draw <span aria-hidden="true">→</span></button>
										{/if}
									</form>
								{:else if competition.deadlinePassed}
									<p class="locked-copy">The reply window has closed.</p>
								{:else}
									<p class="locked-copy">Sign in as an active league player to send your reply.</p>
								{/if}
							</div>

							{#if competition.optedInPlayers.length}
								<ul class="player-chip-list" aria-label="Players who opted in">
									{#each competition.optedInPlayers as player (player.playerId)}
										<li><span class="avatar avatar-{player.tone}" aria-hidden="true"><span>{player.initials}</span></span><span>{player.name}</span></li>
									{/each}
								</ul>
							{/if}

							{#if competition.canFinalise}
								<form method="POST" action="?/finalise" class="close-entry-form">
									<input type="hidden" name="competitionId" value={competition.competitionId} />
									<div><strong>Reply deadline reached</strong><span>Close entry once. This cannot be extended or rerun with a smaller group.</span></div>
									<button class="primary-button" type="submit">Close replies &amp; select</button>
								</form>
							{:else if data.isAdmin}
								<p class="deadline-hint">Entry stays open until the saved deadline. The close-and-select action appears afterwards.</p>
							{/if}
						{:else if competition.status === 'abandoned'}
							<div class="abandoned-state">
								<span class="abandoned-mark" aria-hidden="true">↻</span>
								<div><strong>Not enough entries this time</strong><span>{competition.optedInPlayers.length} opted in. The attempt is closed; the reply deadline will not be extended and no smaller event will run.</span></div>
							</div>
						{:else}
							<div class="entry-results">
								<section class="entrant-column" aria-labelledby={`selected-${competition.competitionId}`}>
									<div class="list-heading"><h4 id={`selected-${competition.competitionId}`}>Selected players</h4><span>{competition.selectedPlayers.length}</span></div>
									<ul class="entrant-list">
										{#each competition.selectedPlayers as player (player.playerId)}
											{@const isOut = competition.dropouts.some((dropout) => dropout.player.playerId === player.playerId)}
											<li>
												<span class="avatar avatar-{player.tone}" aria-hidden="true"><span>{player.initials}</span></span><span>{player.name}</span>
												<small>{isOut ? 'Withdrew' : competition.status === 'selected' ? 'Selected' : 'Out'}</small>
											</li>
										{/each}
									</ul>
								</section>
								<section class="entrant-column waiting-column" aria-labelledby={`waiting-${competition.competitionId}`}>
									<div class="list-heading"><h4 id={`waiting-${competition.competitionId}`}>Random waiting list</h4><span>{competition.waitingPlayers.length}</span></div>
									{#if competition.waitingPlayers.length}
										<ul class="entrant-list">
											{#each competition.waitingPlayers as player (player.playerId)}
												<li><span class="avatar avatar-{player.tone}" aria-hidden="true"><span>{player.initials}</span></span><span>{player.name}</span><small>Waiting</small></li>
											{/each}
										</ul>
									{:else}
										<p class="no-waitlist">No waiting list needed for this entry count.</p>
									{/if}
								</section>
							</div>

							{#if competition.swaps.length}
								<details class="swap-history">
									<summary>Recorded consensual swaps <span>{competition.swaps.length}</span></summary>
									<ol>
										{#each competition.swaps as swap, index (`${swap.recordedAt}-${index}`)}
											<li>{swap.waitingPlayer.name} replaced {swap.selectedPlayer.name} before the draw · recorded by {swap.recordedByName}{#if swap.reason} · {swap.reason}{/if}</li>
										{/each}
									</ol>
								</details>
							{/if}

							{#if competition.canSwap && competition.selectedPlayers.length && competition.waitingPlayers.length}
								<form method="POST" action="?/swap" class="swap-form">
									<div class="swap-form-intro"><strong>Record a consensual swap</strong><span>Both players must agree. The first draw is the cut-off; selection is never rerun.</span></div>
									<input type="hidden" name="competitionId" value={competition.competitionId} />
									<div class="swap-fields">
										<label><span>Selected player to swap out</span><select name="selectedPlayerId" required><option value="">Choose selected player</option>{#each competition.selectedPlayers as player}<option value={player.playerId}>{player.name}</option>{/each}</select></label>
										<label><span>Waiting-list player to bring in</span><select name="waitingPlayerId" required><option value="">Choose waiting-list player</option>{#each competition.waitingPlayers as player}<option value={player.playerId}>{player.name}</option>{/each}</select></label>
									</div>
									<label class="consent-check"><input type="checkbox" name="consentConfirmed" value="yes" required /><span>I confirm both players have agreed to this swap.</span></label>
									<label class="field"><span>Audit note <small>(optional)</small></span><input name="reason" maxlength="300" placeholder="Short context for the record" /></label>
									<button class="quiet-button" type="submit">Save swap to the audit trail</button>
								</form>
							{/if}

							{#if competition.status === 'selected'}
								{#if competition.canDraw}
									<div class="draw-action">
										<div><strong>Ready for the first draw</strong><span>Six players receive two opening ties and two byes; seven receive one bye; eight receive none.</span></div>
										<form method="POST" action="?/draw"><input type="hidden" name="competitionId" value={competition.competitionId} /><button class="draw-button" type="submit"><span class="draw-button-ball" aria-hidden="true">8</span> Draw opening stage</button></form>
									</div>
								{:else}
									<p class="deadline-hint">An admin must save the first-stage draw.</p>
								{/if}
							{:else}
								{#if competition.completedAt}
									<div class="champion-banner" role="status">
										{#if competition.winner}
											<span class="champ-mark" aria-hidden="true">♛</span>
											<div>
												<strong>{competition.winner.name} takes the {competition.title}!</strong>
												<span>First to {competition.framesToWin} frames throughout · completed {formatInstant(competition.completedAt)}. None of it touches the league table.</span>
											</div>
										{:else}
											<span class="champ-mark champ-mark-void" aria-hidden="true">∅</span>
											<div>
												<strong>Ended without a winner</strong>
												<span>Every player dropped out, so no result was invented. The full story is in the history below.</span>
											</div>
										{/if}
									</div>
								{/if}

								{#each competition.stages as stage (stage.stageNumber)}
									<section class="draw-stage" aria-labelledby={`draw-stage-${competition.competitionId}-${stage.stageNumber}`}>
										<div class="stage-heading">
											<div>
												<p class="section-label">STAGE {stage.stageNumber} · SERVER-SAVED DRAW</p>
												<h4 id={`draw-stage-${competition.competitionId}-${stage.stageNumber}`}>{stage.label}</h4>
											</div>
											<span>Drawn by {stage.drawnByName} · {formatInstant(stage.drawnAt)} · {stage.ties.filter((tie) => tie.type === 'match').length} {stage.ties.filter((tie) => tie.type === 'match').length === 1 ? 'tie' : 'ties'}{#if stage.ties.some((tie) => tie.type === 'bye')} · {stage.ties.filter((tie) => tie.type === 'bye').length} {stage.ties.filter((tie) => tie.type === 'bye').length === 1 ? 'bye' : 'byes'}{/if}</span>
										</div>
										<div class="tie-grid">
											{#each stage.ties as tie (tie.tieId)}
												{@const lowPlayer = tie.playerLow}
												{@const highPlayer = tie.playerHigh}
												{#if tie.type === 'bye'}
													<article class="draw-tie bye-tie" class:bye-void={tie.resolvedType === 'void'}>
														<span class="tie-label">BYE {tie.tieNumber}</span>
														{#if tie.resolvedType === 'void'}
															<div class="tie-player"><span class="avatar avatar-{tie.byePlayer?.tone}" aria-hidden="true"><span>{tie.byePlayer?.initials}</span></span><strong>{tie.byePlayer?.name}</strong></div>
															<span class="bye-note bye-note-void">Bye voided — withdrew before playing</span>
														{:else}
															<div class="tie-player"><span class="avatar avatar-{tie.byePlayer?.tone}" aria-hidden="true"><span>{tie.byePlayer?.initials}</span></span><strong>{tie.byePlayer?.name}</strong></div>
															<span class="bye-note">Through to the next stage</span>
														{/if}
													</article>
												{:else if lowPlayer && highPlayer}
													<article class="draw-tie" class:tie-done={tie.resolvedType === 'played'} class:tie-walkover={tie.resolvedType === 'walkover'}>
														<span class="tie-label">TIE {tie.tieNumber} · FIRST TO {competition.framesToWin}</span>
														{#if tie.resolvedType === 'played'}
															<div class="tie-scoreline">
																<div class="tie-player" class:tie-winner={tie.winner?.playerId === lowPlayer.playerId}>
																	<span class="avatar avatar-{lowPlayer.tone}" aria-hidden="true"><span>{lowPlayer.initials}</span></span>
																	<strong>{lowPlayer.name}</strong>
																</div>
																<span class="tie-frames">{tie.lowFrames}–{tie.highFrames}</span>
																<div class="tie-player" class:tie-winner={tie.winner?.playerId === highPlayer.playerId}>
																	<span class="avatar avatar-{highPlayer.tone}" aria-hidden="true"><span>{highPlayer.initials}</span></span>
																	<strong>{highPlayer.name}</strong>
																</div>
															</div>
															{#if tie.frames.length}
																<div class="frame-ribbon" aria-label="Frame winners in order">
																	{#each tie.frames as frame (frame.frameNumber)}
																		<span
																			class="ribbon-dot"
																			class:dot-low={frame.winnerPlayerId === lowPlayer.playerId}
																			title={`Frame ${frame.frameNumber}: ${frame.winnerName}`}
																		>{frame.frameNumber}</span>
																	{/each}
																</div>
															{/if}
															<small class="tie-meta">
																Played {formatPlayedDate(tie.actualPlayedDate ?? '')} · recorded by {tie.recordedByName}{#if tie.revision > 1} · corrected (revision {tie.revision}){/if}
															</small>
															{#if tie.viewer.canCorrect}
																<div class="tie-actions">
																	<a class="tie-action-link" href="/knockout/tie/{tie.tieId}/record">Correct result</a>
																</div>
															{/if}
														{:else if tie.resolvedType === 'walkover'}
															<div class="tie-scoreline">
																<div class="tie-player" class:tie-winner={tie.winner?.playerId === lowPlayer.playerId}>
																	<span class="avatar avatar-{lowPlayer.tone}" aria-hidden="true"><span>{lowPlayer.initials}</span></span>
																	<strong>{lowPlayer.name}</strong>
																</div>
																<span class="versus">walkover</span>
																<div class="tie-player" class:tie-winner={tie.winner?.playerId === highPlayer.playerId}>
																	<span class="avatar avatar-{highPlayer.tone}" aria-hidden="true"><span>{highPlayer.initials}</span></span>
																	<strong>{highPlayer.name}</strong>
																</div>
															</div>
															<small class="tie-meta">Opponent withdrew — advances without a played result. Nothing was invented.</small>
														{:else}
															<div class="tie-scoreline">
																<div class="tie-player"><span class="avatar avatar-{lowPlayer.tone}" aria-hidden="true"><span>{lowPlayer.initials}</span></span><strong>{lowPlayer.name}</strong></div>
																<span class="versus">v</span>
																<div class="tie-player"><span class="avatar avatar-{highPlayer.tone}" aria-hidden="true"><span>{highPlayer.initials}</span></span><strong>{highPlayer.name}</strong></div>
															</div>
															<small class="tie-meta tie-meta-state">
																{#if tie.arrangement}
																	{arrangedLabel(tie.arrangement.date, tie.arrangement.time)}{#if tie.arrangement.note} · “{tie.arrangement.note}”{/if}
																{:else}
																	Not arranged yet
																{/if}
																{#if tie.nudgeCount > 0}
																	· nudged {#if tie.lastNudgeAt}· last {formatInstant(tie.lastNudgeAt)}{/if}
																{/if}
															</small>
															{#if tie.viewer.canRecord || tie.viewer.canArrange || tie.viewer.canNudge}
																<div class="tie-actions">
																	{#if tie.viewer.canRecord}
																		<a class="tie-action-link" href="/knockout/tie/{tie.tieId}/record">Record result</a>
																	{/if}
																	{#if tie.viewer.canNudge}
																		<form method="POST" action="?/nudge" class="tie-inline-form">
																			<input type="hidden" name="tieId" value={tie.tieId} />
																			<button class="tie-action-quiet" type="submit">Nudge</button>
																		</form>
																	{/if}
																</div>
															{/if}
															{#if tie.viewer.canArrange}
																<details class="arrange-form">
																	<summary>{tie.arrangement ? 'Change the date' : 'Arrange a date'}</summary>
																	<form method="POST" action="?/arrange">
																		<input type="hidden" name="tieId" value={tie.tieId} />
																		<label class="arrange-label"><span>Date</span><input type="date" name="date" min={data.today} value={tie.arrangement?.date ?? ''} required /></label>
																		<label class="arrange-label"><span>Time <small>(optional)</small></span><input type="time" name="time" value={tie.arrangement?.time ?? ''} /></label>
																		<label class="arrange-label"><span>Note <small>(optional)</small></span><input name="note" maxlength="200" placeholder="Venue, table, anything helpful" value={tie.arrangement?.note ?? ''} /></label>
																		<button class="quiet-button" type="submit">Save plan</button>
																	</form>
																	{#if tie.arrangement}
																		<form method="POST" action="?/cancelArrange" class="tie-inline-form">
																			<input type="hidden" name="tieId" value={tie.tieId} />
																			<button class="tie-action-quiet" type="submit">Cancel the plan</button>
																		</form>
																	{/if}
																</details>
															{:else if !tie.arrangement}
																<small class="tie-meta">Waiting on the players to arrange a date — there are no stage deadlines.</small>
															{/if}
														{/if}
													</article>
												{/if}
											{/each}
										</div>
										{#if stage.resolved && stage.advancing.length > 1}
											<p class="stage-footnote">
												<span aria-hidden="true">→</span>
												Through: {stage.advancing.map((player) => player.name).join(', ')} — the next pairings are drawn fresh, never pre-seeded.
											</p>
										{/if}
									</section>
								{/each}

								{#if competition.nextStageReady}
									{@const stage = lastStage(competition)}
									<div class="draw-action next-stage-action">
										<div>
											<strong>Stage {stage?.stageNumber} complete</strong>
											<span>{competition.livePlayers.map((player) => player.name).join(' and ')} {competition.livePlayers.length === 1 ? 'is' : 'are'} through. Draw the next stage fresh from the players still standing.</span>
										</div>
										<form method="POST" action="?/drawNext">
											<input type="hidden" name="competitionId" value={competition.competitionId} />
											<button class="draw-button" type="submit"><span class="draw-button-ball" aria-hidden="true">8</span> Draw stage {(stage?.stageNumber ?? 0) + 1}</button>
										</form>
									</div>
								{/if}

								{#if competition.canDropout && dropoutCandidates(competition).length}
									<details class="dropout-form">
										<summary>Record a dropout <span aria-hidden="true">↧</span></summary>
										<form method="POST" action="?/dropout">
											<input type="hidden" name="competitionId" value={competition.competitionId} />
											<div class="swap-fields">
												<label><span>Player withdrawing</span>
													<select name="playerId" required>
														<option value="">Choose a player</option>
														{#each dropoutCandidates(competition) as player (player.playerId)}
															<option value={player.playerId}>{player.name}</option>
														{/each}
													</select>
												</label>
												<label><span>Reason <small>(required, audited)</small></span><input name="reason" maxlength="300" required placeholder="Why are they out?" /></label>
											</div>
											<p class="dropout-hint">
												A paired dropout sends the opponent through on a walkover — no played result is invented. A
												bye-holder's bye is voided and the next stage is drawn afresh from the remaining players;
												the waiting list is never used as a replacement.
											</p>
											<button class="quiet-button" type="submit">Record dropout</button>
										</form>
									</details>
								{/if}

								{#if competition.dropouts.length}
									<details class="dropout-history">
										<summary>Recorded dropouts <span>{competition.dropouts.length}</span></summary>
										<ol>
											{#each competition.dropouts as dropout (dropout.player.playerId)}
												<li>
													<strong>{dropout.player.name}</strong> · stage {dropout.stageNumber} — {dropoutKindLabel(dropout.kind)} · recorded by {dropout.recordedByName} · “{dropout.reason}”
												</li>
											{/each}
										</ol>
									</details>
								{/if}

								{#if competition.history.length}
									<details class="audit-history">
										<summary>Competition history <span>{competition.history.length}</span></summary>
										<ol>
											{#each competition.history as entry, index (`${entry.at}-${index}`)}
												<li><strong>{entry.label}</strong> — {entry.actorName ?? 'System'} · {formatInstant(entry.at)}{#if entry.reason} · “{entry.reason}”{/if}</li>
											{/each}
										</ol>
									</details>
								{/if}
							{/if}
						{/if}
					</article>
				{/each}
			</div>
		{/if}
	</section>

	<p class="phase-boundary">Knockout entry, draws, results, dropouts and progression are live — every stage is drawn fresh and every change is audited. Knockout results never add league points or stats.</p>
</section>

<style>
	.knockout-page {
		width: min(100%, 980px);
		margin: 0 auto;
		padding: 18px 20px 110px;
		color: #e7f5ed;
	}

	.knockout-hero {
		position: relative;
		isolation: isolate;
		overflow: hidden;
		padding: 24px 30px 32px;
		margin: 0 0 22px;
		border: 1px solid rgba(163, 235, 196, 0.23);
		border-radius: 24px;
		background:
			radial-gradient(ellipse at 78% 24%, rgba(77, 212, 153, 0.18), transparent 33%),
			linear-gradient(130deg, rgba(9, 65, 49, 0.96), rgba(8, 42, 35, 0.96) 58%, rgba(9, 53, 41, 0.98));
		box-shadow: 0 22px 60px rgba(0, 13, 9, 0.26), inset 0 1px rgba(255, 255, 255, 0.08);
	}

	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		color: #a9d8be;
		font-size: 13px;
		font-weight: 650;
		text-decoration: none;
	}

	.back-link:hover { color: #f4fff8; }
	.back-link:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, a:focus-visible, summary:focus-visible {
		outline: 3px solid #d3f27e;
		outline-offset: 3px;
	}

	.hero-content {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 24px;
		padding: 22px 0 0;
	}

	.hero-copy { max-width: 670px; }

	.eyebrow, .section-label {
		margin: 0;
		color: #8bd9ac;
		font-size: 10px;
		font-weight: 800;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.eyebrow { display: flex; align-items: center; gap: 8px; }
	.cue-dot { width: 7px; height: 7px; border-radius: 50%; background: #c3eb62; box-shadow: 0 0 12px rgba(195, 235, 98, 0.7); }

	h1 {
		margin: 12px 0 10px;
		color: #f0fff6;
		font-size: clamp(32px, 6vw, 52px);
		line-height: 0.99;
		letter-spacing: -0.045em;
	}

	h1 span { color: #a9edc2; }
	.hero-intro { max-width: 610px; margin: 0; color: #c0d9ca; font-size: 15px; line-height: 1.55; }

	.hero-rules { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 21px; }
	.hero-rules span { padding: 8px 11px; border: 1px solid rgba(183, 232, 201, 0.2); border-radius: 999px; background: rgba(1, 28, 19, 0.2); color: #c3dece; font-size: 11px; }
	.hero-rules strong { color: #eefbd7; }

	.draw-mark { position: relative; flex: 0 0 164px; height: 164px; display: grid; place-items: center; }
	.draw-ring { position: absolute; border: 1px solid rgba(162, 229, 190, 0.23); border-radius: 50%; }
	.ring-one { width: 153px; height: 153px; }
	.ring-two { width: 122px; height: 122px; border-style: dashed; animation: turn 28s linear infinite; }
	.draw-ball { width: 74px; height: 74px; display: grid; place-items: center; border-radius: 50%; background: radial-gradient(circle at 30% 25%, #5f7c78, #192d35 68%); color: #f0e5ef; font-family: Georgia, serif; font-size: 29px; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.33), inset -8px -11px 18px rgba(0, 0, 0, 0.35), inset 5px 5px 10px rgba(255, 255, 255, 0.26); }
	.draw-spark { position: absolute; color: #d6f190; }
	.spark-one { top: 15px; right: 11px; font-size: 17px; }
	.spark-two { bottom: 20px; left: 9px; color: #94e8b4; font-size: 21px; }
	@keyframes turn { to { transform: rotate(360deg); } }

	.admin-panel, .competition-card, .empty-state {
		border: 1px solid rgba(197, 229, 205, 0.14);
		border-radius: 18px;
		background: linear-gradient(145deg, rgba(16, 65, 50, 0.78), rgba(9, 47, 37, 0.83));
		box-shadow: 0 12px 30px rgba(0, 15, 10, 0.14), inset 0 1px rgba(255, 255, 255, 0.025);
	}

	.announce-panel { padding: 23px 25px 25px; margin-bottom: 30px; }
	.panel-heading, .section-heading, .competition-topline, .stage-heading { display: flex; align-items: center; justify-content: space-between; gap: 15px; }
	.panel-heading h2, .section-heading h2 { margin: 6px 0 0; color: #f0fff6; font-size: 22px; letter-spacing: -0.025em; }
	.panel-orb { display: grid; place-items: center; width: 34px; height: 34px; border: 1px solid rgba(199, 236, 131, 0.33); border-radius: 50%; color: #d7ee83; background: rgba(173, 216, 89, 0.08); }
	.panel-copy { margin: 8px 0 18px; color: #abc9b7; font-size: 13px; line-height: 1.5; }

	.announce-form { display: grid; gap: 14px; }
	.form-row { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(220px, 0.9fr); gap: 13px; }
	.field { display: grid; align-content: start; gap: 7px; color: #dcece1; font-size: 12px; font-weight: 650; }
	.field-wide { min-width: 0; }
	.field label, .field > span { color: #dcece1; font-size: 12px; font-weight: 650; }
	.field label span, .field small { color: #90b39d; font-size: 11px; font-weight: 450; }
	.field input, .field select, .field textarea, .swap-fields select, .dropout-form select, .dropout-form input, .arrange-form input {
		width: 100%; min-height: 43px; padding: 10px 12px; border: 1px solid rgba(191, 222, 199, 0.2); border-radius: 10px;
		background: rgba(0, 27, 19, 0.42); color: #eefaf1; font: inherit; font-size: 13px;
		color-scheme: dark;
	}
	.field textarea { resize: vertical; min-height: 68px; }
	.field input::placeholder, .field textarea::placeholder, .dropout-form input::placeholder { color: #789988; }
	.field select option, .swap-fields select option, .dropout-form select option { background: #0b3b2c; color: #effaf2; }
	.field small { line-height: 1.4; }

	.primary-button, .quiet-button, .draw-button {
		display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 43px; padding: 10px 15px;
		border-radius: 10px; cursor: pointer; font: inherit; font-size: 13px; font-weight: 750; transition: transform 150ms ease, background 150ms ease, border-color 150ms ease;
	}
	.primary-button { border: 1px solid #b5e56e; background: linear-gradient(135deg, #c9eb79, #9fdd76); color: #153628; box-shadow: 0 8px 20px rgba(1, 25, 16, 0.17); }
	.primary-button:hover, .draw-button:hover { transform: translateY(-1px); }
	.quiet-button { border: 1px solid rgba(184, 226, 197, 0.3); background: rgba(180, 221, 193, 0.08); color: #e4f7e9; }
	.quiet-button:hover { background: rgba(180, 221, 193, 0.15); }
	.announce-form > .primary-button { justify-self: start; }

	.knockout-flash { margin: 0 0 20px; padding: 12px 15px; border: 1px solid rgba(161, 230, 166, 0.42); border-radius: 12px; background: rgba(30, 104, 66, 0.42); color: #e8ffdd; font-size: 13px; }
	.competition-section { margin-top: 29px; }
	.section-heading { margin: 0 2px 14px; }
	.section-heading h2 { font-size: 25px; }
	.section-count { color: #8eb79e; font-size: 12px; }
	.competition-list { display: grid; gap: 16px; }
	.competition-card { padding: 22px; }
	.competition-topline h3 { margin: 5px 0 0; color: #f1fff5; font-size: clamp(20px, 3vw, 25px); letter-spacing: -0.03em; }
	.status-pill { display: inline-flex; align-items: center; gap: 7px; flex: 0 0 auto; padding: 7px 10px; border-radius: 999px; border: 1px solid rgba(173, 221, 191, 0.18); color: #b4cbb9; background: rgba(1, 22, 16, 0.25); font-size: 10px; font-weight: 750; }
	.status-inviting { border-color: rgba(199, 232, 111, 0.34); color: #d8ec9e; background: rgba(176, 215, 91, 0.09); }
	.status-done { color: #b6e5c4; }
	.status-won { border-color: rgba(214, 241, 144, 0.4); color: #e4f2a6; background: rgba(176, 208, 75, 0.1); }
	.status-dot { width: 6px; height: 6px; border-radius: 50%; background: #71877b; }
	.status-inviting .status-dot { background: #d2eb78; box-shadow: 0 0 8px rgba(210, 235, 120, 0.58); }
	.status-won .status-dot { background: #d6f190; }
	.announcement-note { margin: 15px 0 0; padding-left: 12px; border-left: 2px solid rgba(172, 224, 126, 0.55); color: #bdd4c4; font-size: 13px; line-height: 1.45; }
	.competition-facts { display: flex; flex-wrap: wrap; gap: 9px; margin: 17px 0; }
	.competition-facts div { min-width: 115px; padding: 9px 11px; border: 1px solid rgba(182, 221, 195, 0.11); border-radius: 10px; background: rgba(0, 27, 19, 0.23); }
	.competition-facts dt { color: #82a58f; font-size: 9px; font-weight: 750; letter-spacing: 0.08em; text-transform: uppercase; }
	.competition-facts dd { margin: 4px 0 0; color: #e7f7eb; font-size: 12px; font-weight: 700; }

	.entry-panel { display: flex; align-items: center; justify-content: space-between; gap: 15px; padding: 14px 15px; border: 1px solid rgba(188, 225, 179, 0.2); border-radius: 13px; background: rgba(0, 26, 19, 0.24); }
	.entry-copy { display: grid; gap: 4px; }
	.entry-copy strong { color: #ecf7e7; font-size: 14px; }
	.entry-copy span, .locked-copy { margin: 0; color: #9fbdac; font-size: 12px; line-height: 1.45; }
	.response-form { flex: 0 0 auto; }
	.deadline-hint { margin: 12px 0 0; color: #97b5a2; font-size: 12px; }
	.player-chip-list, .entrant-list { list-style: none; margin: 14px 0 0; padding: 0; }
	.player-chip-list { display: flex; flex-wrap: wrap; gap: 8px; }
	.player-chip-list li { display: inline-flex; align-items: center; gap: 6px; padding: 5px 9px 5px 5px; border: 1px solid rgba(180, 226, 190, 0.12); border-radius: 999px; background: rgba(1, 25, 17, 0.23); color: #d7e9dc; font-size: 11px; }
	.player-chip-list :global(.avatar) { width: 23px; height: 23px; font-size: 9px; }
	.close-entry-form { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 17px; padding: 14px; border: 1px solid rgba(203, 230, 123, 0.22); border-radius: 12px; background: rgba(176, 208, 75, 0.06); }
	.close-entry-form > div, .abandoned-state > div, .swap-form-intro, .draw-action > div, .champion-banner > div { display: grid; gap: 4px; }
	.close-entry-form strong, .abandoned-state strong, .swap-form-intro strong, .draw-action strong, .champion-banner strong { color: #e8f4d4; font-size: 13px; }
	.close-entry-form span, .abandoned-state span, .swap-form-intro span, .draw-action span, .champion-banner span { color: #99b49f; font-size: 11px; line-height: 1.45; }
	.abandoned-state { display: flex; align-items: center; gap: 13px; padding: 16px; border: 1px solid rgba(232, 167, 106, 0.24); border-radius: 12px; background: rgba(136, 69, 36, 0.13); }
	.abandoned-mark { display: grid; place-items: center; flex: 0 0 34px; height: 34px; border-radius: 50%; background: rgba(233, 172, 113, 0.16); color: #efc394; font-size: 18px; }

	.entry-results { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 5px; }
	.entrant-column { min-width: 0; padding: 13px; border: 1px solid rgba(181, 220, 192, 0.14); border-radius: 13px; background: rgba(1, 25, 18, 0.23); }
	.waiting-column { background: rgba(1, 25, 18, 0.12); }
	.list-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
	.list-heading h4 { margin: 0; color: #d9eadd; font-size: 12px; }
	.list-heading > span { display: grid; place-items: center; min-width: 22px; height: 22px; padding: 0 5px; border-radius: 50%; background: rgba(187, 225, 156, 0.12); color: #cae89f; font-size: 10px; font-weight: 800; }
	.entrant-list { display: grid; gap: 9px; margin-top: 13px; }
	.entrant-list li { display: flex; align-items: center; gap: 8px; color: #dceae0; font-size: 12px; }
	.entrant-list :global(.avatar) { width: 29px; height: 29px; font-size: 10px; }
	.entrant-list small { margin-left: auto; color: #8ba894; font-size: 9px; }
	.no-waitlist { margin: 13px 0 2px; color: #8ea995; font-size: 11px; }
	.swap-history, .dropout-history, .audit-history { margin-top: 13px; border-top: 1px solid rgba(190, 222, 196, 0.11); padding-top: 11px; color: #b8d2c0; font-size: 11px; }
	.swap-history summary, .dropout-history summary, .audit-history summary, .dropout-form summary { cursor: pointer; font-weight: 700; }
	.swap-history summary span, .dropout-history summary span, .audit-history summary span { margin-left: 4px; color: #92b59e; }
	.swap-history ol, .dropout-history ol, .audit-history ol { display: grid; gap: 6px; margin: 10px 0 0; padding-left: 20px; color: #a6c4b2; line-height: 1.45; }
	.swap-form { display: grid; gap: 11px; margin-top: 14px; padding: 15px; border: 1px solid rgba(190, 223, 194, 0.17); border-radius: 12px; background: rgba(0, 24, 18, 0.2); }
	.swap-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 11px; }
	.swap-fields label { display: grid; gap: 6px; color: #d4e8d9; font-size: 11px; font-weight: 650; }
	.consent-check { display: flex; align-items: flex-start; gap: 9px; color: #c4dccb; font-size: 11px; line-height: 1.4; }
	.consent-check input { accent-color: #bce66d; }
	.swap-form .field { max-width: 440px; }
	.swap-form .field > span small { color: #88a995; font-size: 10px; font-weight: 450; }
	.draw-action { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 15px; padding: 14px; border: 1px solid rgba(188, 225, 173, 0.22); border-radius: 13px; background: rgba(133, 186, 83, 0.08); }
	.next-stage-action { border-color: rgba(214, 241, 144, 0.32); background: rgba(176, 208, 75, 0.1); }
	.draw-button { border: 1px solid rgba(206, 234, 131, 0.46); background: linear-gradient(135deg, #173d30, #225b40); color: #e8f3d8; white-space: nowrap; }
	.draw-button-ball { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: radial-gradient(circle at 35% 25%, #7d777f, #211d29 72%); color: #fff2ff; font-family: Georgia, serif; font-size: 12px; box-shadow: inset -3px -3px 5px rgba(0, 0, 0, 0.4), inset 2px 2px 3px rgba(255, 255, 255, 0.25); }

	.champion-banner { display: flex; align-items: center; gap: 13px; margin-top: 15px; padding: 16px; border: 1px solid rgba(214, 241, 144, 0.38); border-radius: 13px; background: linear-gradient(135deg, rgba(133, 186, 83, 0.16), rgba(87, 150, 82, 0.12)); }
	.champ-mark { display: grid; place-items: center; flex: 0 0 40px; height: 40px; border-radius: 50%; background: radial-gradient(circle at 35% 25%, #6d6773, #23202b 72%); color: #f0e7c8; font-size: 19px; box-shadow: inset -3px -4px 6px rgba(0, 0, 0, 0.4), inset 2px 2px 4px rgba(255, 255, 255, 0.22); }
	.champ-mark-void { color: #b9c9bd; }

	.draw-stage { margin-top: 16px; padding-top: 14px; border-top: 1px solid rgba(191, 224, 197, 0.13); }
	.stage-heading { align-items: end; margin-bottom: 12px; }
	.stage-heading h4 { margin: 4px 0 0; color: #ebf8ed; font-size: 16px; }
	.stage-heading > span { color: #89a893; font-size: 10px; text-align: right; }
	.tie-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
	.draw-tie { display: grid; grid-template-columns: 1fr; align-items: center; gap: 9px; min-width: 0; padding: 13px; border: 1px solid rgba(181, 223, 192, 0.15); border-radius: 13px; background: rgba(0, 26, 19, 0.24); animation: draw-reveal 460ms cubic-bezier(0.2, 0.75, 0.25, 1) both; }
	.draw-tie:nth-child(2) { animation-delay: 65ms; }
	.draw-tie:nth-child(3) { animation-delay: 130ms; }
	.draw-tie:nth-child(4) { animation-delay: 195ms; }
	.draw-tie:nth-child(5) { animation-delay: 260ms; }
	@keyframes draw-reveal { from { opacity: 0; transform: translateY(10px) scale(0.985); } to { opacity: 1; transform: translateY(0) scale(1); } }
	.tie-label { color: #88b59a; font-size: 9px; font-weight: 800; letter-spacing: 0.12em; }
	.tie-player { display: flex; align-items: center; gap: 7px; min-width: 0; }
	.tie-player strong { overflow: hidden; color: #e0efe4; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
	.tie-player :global(.avatar) { flex: 0 0 28px; width: 28px; height: 28px; font-size: 9px; }
	.tie-winner strong { color: #eaf7b0; }
	.tie-scoreline { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 9px; }
	.tie-frames { color: #d8f0a2; font-family: Georgia, serif; font-size: 17px; font-weight: 650; letter-spacing: 0.02em; text-align: center; }
	.versus { color: #93ad9b; font-family: Georgia, serif; font-size: 12px; text-align: center; }
	.frame-ribbon { display: flex; flex-wrap: wrap; gap: 5px; }
	.ribbon-dot { display: grid; place-items: center; width: 21px; height: 21px; border-radius: 50%; background: rgba(213, 68, 68, 0.24); border: 1px solid rgba(226, 122, 122, 0.5); color: #f6d9d9; font-size: 9px; font-weight: 750; }
	.ribbon-dot.dot-low { background: rgba(73, 69, 214, 0.26); border-color: rgba(129, 126, 235, 0.55); color: #dcdcf8; }
	.tie-meta { color: #8ca695; font-size: 9px; line-height: 1.5; }
	.tie-meta-state { color: #a7c4b1; font-size: 10px; }
	.tie-actions { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
	.tie-action-link { display: inline-flex; align-items: center; min-height: 34px; padding: 6px 12px; border: 1px solid rgba(181, 229, 110, 0.45); border-radius: 9px; background: linear-gradient(135deg, #c9eb79, #9fdd76); color: #153628; font-size: 11px; font-weight: 750; text-decoration: none; }
	.tie-action-link:hover { filter: brightness(1.05); }
	.tie-action-quiet { display: inline-flex; align-items: center; min-height: 34px; padding: 6px 12px; border: 1px solid rgba(184, 226, 197, 0.3); border-radius: 9px; background: rgba(180, 221, 193, 0.08); color: #e4f7e9; font: inherit; font-size: 11px; font-weight: 700; cursor: pointer; }
	.tie-action-quiet:hover { background: rgba(180, 221, 193, 0.16); }
	.tie-inline-form { display: contents; }
	.tie-done { border-color: rgba(202, 234, 123, 0.26); background: rgba(120, 158, 66, 0.08); }
	.tie-walkover { border-style: dashed; }
	.bye-tie { grid-template-columns: 1fr; border-color: rgba(202, 234, 123, 0.22); background: rgba(152, 188, 73, 0.07); }
	.bye-note { color: #bed78e; font-size: 10px; }
	.bye-note-void { color: #d8b48e; }
	.bye-void { border-color: rgba(232, 167, 106, 0.26); background: rgba(136, 69, 36, 0.1); }
	.stage-footnote { display: flex; align-items: baseline; gap: 8px; margin: 12px 0 0; color: #a9c9b3; font-size: 11px; line-height: 1.5; }
	.stage-footnote span { color: #cbe98f; }

	.arrange-form { border-top: 1px dashed rgba(190, 222, 196, 0.18); padding-top: 9px; }
	.arrange-form summary { color: #a9cdb6; font-size: 10px; font-weight: 700; cursor: pointer; }
	.arrange-form form { display: grid; gap: 9px; margin-top: 9px; }
	.arrange-label { display: grid; gap: 4px; color: #cbe3d3; font-size: 10px; font-weight: 700; }
	.arrange-label small { color: #88a995; font-weight: 450; }

	.dropout-form { margin-top: 14px; padding: 13px 15px; border: 1px solid rgba(232, 167, 106, 0.2); border-radius: 12px; background: rgba(136, 69, 36, 0.08); }
	.dropout-form form { display: grid; gap: 10px; margin-top: 11px; }
	.dropout-hint { margin: 0; color: #c9ad90; font-size: 10px; line-height: 1.5; }

	.empty-state { padding: 35px 20px; text-align: center; }
	.empty-state h3 { margin: 13px 0 6px; color: #e9f7ee; font-size: 18px; }
	.empty-state p { margin: 0 auto; max-width: 420px; color: #9dbba8; font-size: 13px; line-height: 1.5; }
	.empty-balls { display: flex; justify-content: center; gap: 7px; }
	.empty-balls span { width: 18px; height: 18px; border-radius: 50%; background: radial-gradient(circle at 33% 25%, #f1f0ec, #92968b 78%); box-shadow: inset -3px -3px 4px rgba(0, 0, 0, 0.28); }
	.empty-balls span:nth-child(2) { background: radial-gradient(circle at 33% 25%, #d9d789, #778243 78%); }
	.empty-balls span:nth-child(3) { background: radial-gradient(circle at 33% 25%, #e16f68, #8e2828 78%); }
	.phase-boundary { margin: 20px 4px 0; color: #789b85; font-size: 11px; line-height: 1.45; text-align: center; }

	@media (max-width: 680px) {
		.knockout-page { padding: 14px 14px 102px; }
		.knockout-hero { padding: 19px 18px 22px; border-radius: 19px; }
		.hero-content { padding-top: 19px; }
		.draw-mark { flex-basis: 76px; height: 90px; margin-right: -10px; }
		.ring-one { width: 80px; height: 80px; }
		.ring-two { width: 63px; height: 63px; }
		.draw-ball { width: 43px; height: 43px; font-size: 19px; }
		.spark-one { top: 1px; right: 0; font-size: 13px; }
		.spark-two { bottom: 4px; left: 0; font-size: 16px; }
		.hero-rules { gap: 6px; margin-top: 15px; }
		.hero-rules span { padding: 7px 9px; font-size: 10px; }
		.announce-panel, .competition-card { padding: 17px; }
		.form-row { grid-template-columns: 1fr; }
		.entry-panel, .close-entry-form, .draw-action, .champion-banner { align-items: stretch; flex-direction: column; }
		.response-form, .response-form button, .close-entry-form button, .draw-action form, .draw-button { width: 100%; }
		.entry-results, .swap-fields, .tie-grid { grid-template-columns: 1fr; }
		.competition-topline { align-items: flex-start; flex-direction: column; }
		.status-pill { align-self: flex-start; }
		.stage-heading { align-items: flex-start; flex-direction: column; }
		.stage-heading > span { text-align: left; }
		.draw-tie { gap: 7px; }
		.tie-scoreline { grid-template-columns: 1fr auto 1fr; gap: 6px; }
	}

	@media (prefers-reduced-motion: reduce) {
		.ring-two,
		.draw-tie { animation: none; }
	}
</style>
