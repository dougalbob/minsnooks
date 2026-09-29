<script lang="ts">
	import AdminRoleBanner from '$lib/components/AdminRoleBanner.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Minsnooks · Withdrawals & awards</title>
</svelte:head>

<section class="lifecycle-page award-admin-page" aria-labelledby="awards-title">
	<a class="back-link" href="/admin"><span aria-hidden="true">←</span> Admin</a>
	<header class="lifecycle-header">
		<p class="flow-kicker">LEAGUE CONTROL · PHASE 7</p>
		<h1 id="awards-title">Withdrawals & awards</h1>
		<p class="flow-intro">
			Withdraw a player without erasing their results or earned points. Their remaining unplayed fixtures
			are resolved with table-points-only awards: a genuine confirmed result against the same opponent
			comes first; otherwise the server saves one equal-odds 0–3 draw.
		</p>
		<p class="preview-warning">
			Phase 8 active: role gates enforced server-side. Withdrawals and awards review require administrator privileges.
		</p>
	</header>

	<nav class="admin-nav" aria-label="League control sections">
		<a class="admin-nav-link" href="/admin/rounds">Round lifecycle</a>
		<a class="admin-nav-link" href="/admin/results">Result queue</a>
		<a class="admin-nav-link admin-nav-active" href="/admin/awards" aria-current="page">Withdrawals & awards</a>
	</nav>

	<AdminRoleBanner
		viewer={data.viewer}
		isAdmin={data.isAdmin}
		isSuperAdmin={data.isSuperAdmin}
		canManage={data.canWithdraw}
		manageReason={data.withdrawReason}
	/>

	{#if form?.message}
		<p class="lifecycle-flash" role="status" aria-live="polite">{form.message}</p>
	{/if}
	{#if form?.reveals?.length}
		<section class="award-reveal" aria-labelledby="award-reveal-title" aria-live="polite">
			<p class="section-label">SAVED OUTCOMES · NO REROLLS</p>
			<h2 id="award-reveal-title">The awards are in</h2>
			<p class="panel-copy">Each displayed value was written to the award ledger before this reveal. A reveal never generates another number.</p>
			<div class="award-reveal-grid">
				{#each form.reveals as reveal (reveal.awardId)}
					<article class="reveal-card" class:draw-card={reveal.sourceType === 'random_draw'}>
						<span class="reveal-recipient">{reveal.opponentName}</span>
						<strong class="reveal-points">{reveal.tablePoints}<span> table {reveal.tablePoints === 1 ? 'point' : 'points'}</span></strong>
						<span class="reveal-source">
							{#if reveal.sourceType === 'random_draw'}
								Random draw · {reveal.drawValue} of 0–3
							{:else}
								Round {reveal.sourceRound} result · same opponent
							{/if}
						</span>
					</article>
				{/each}
			</div>
		</section>
	{/if}

	{#if !data.isAdmin}
		<p class="lifecycle-flash award-error" role="status">
			{#if data.viewer}This account is not an admin. The controls below are read-only.{:else}Switch to an admin in the DEV PREVIEW identity chooser to try these journeys.{/if}
		</p>
	{/if}

	<section class="lifecycle-grid" aria-label="Withdrawal controls">
		<article class="admin-panel" aria-labelledby="withdraw-title">
			<p class="section-label">ROSTER PRESERVATION · CURRENT ROUND RESOLUTION</p>
			<h2 id="withdraw-title">Withdraw a player</h2>
			{#if data.season && data.eligiblePlayers.length}
				<form method="GET" action="/admin/awards" class="admin-form withdrawal-preview-form">
					<label class="field-label" for="withdraw-player">Player</label>
					<select class="flow-input" id="withdraw-player" name="playerId">
						{#each data.eligiblePlayers as player (player.id)}
							<option value={player.id} selected={player.id === data.selectedPlayer?.id}>{player.name}</option>
						{/each}
					</select>
					<button class="small-secondary" type="submit">Preview impact</button>
				</form>

				{#if data.selectedPlayer}
					<p class="panel-copy withdrawal-preview-copy">
						{#if data.activeRound}
							Round {data.activeRound.number} is open. {data.selectedPlayer.name} stays in this round’s history, but will be excluded from future round rosters.
						{:else}
							No round is currently open. The withdrawal takes effect from the next round; earned history and points remain.
						{/if}
					</p>
					{#if data.withdrawalPreview.length}
						<h3 class="preview-list-title">Unplayed fixtures resolved on withdrawal</h3>
						<ul class="withdrawal-preview-list">
							{#each data.withdrawalPreview as item (item.fixtureId)}
								<li>
									<strong>{item.opponentName}</strong>
									{#if item.sourceResultId !== null}
										<span>{item.tablePoints} table {item.tablePoints === 1 ? 'point' : 'points'} from their confirmed Round {item.sourceRound} result</span>
									{:else}
										<span>One server-side, equal-odds random draw from 0–3 table points</span>
									{/if}
								</li>
							{/each}
						</ul>
					{:else}
						<p class="panel-copy">There are no still-unplayed fixtures against this player in the open round. A submission awaiting confirmation is not treated as unplayed.</p>
					{/if}
					<form method="POST" action="?/withdrawPlayer" class="admin-form award-submit-form">
						<input type="hidden" name="playerId" value={data.selectedPlayer.id} />
						<label class="field-label" for="withdraw-reason">Reason for the audit record</label>
						<textarea class="flow-input" id="withdraw-reason" name="reason" rows="2" maxlength="240" minlength="3" required></textarea>
						<button class="small-primary" type="submit" disabled={!data.isAdmin}>Withdraw and resolve fixtures</button>
					</form>
				{/if}
			{:else}
				<p class="panel-copy">Seed the fictional league or add an active player before testing a withdrawal.</p>
			{/if}
		</article>

		<article class="admin-panel" aria-labelledby="withdrawn-title">
			<p class="section-label">AUDITABLE MEMBERSHIP</p>
			<h2 id="withdrawn-title">Withdrawn from future rounds</h2>
			{#if data.withdrawals.length}
				<ul class="withdrawal-list">
					{#each data.withdrawals as withdrawal (`${withdrawal.player_name}-${withdrawal.season_label}`)}
						<li><strong>{withdrawal.player_name}</strong><span>From Round {withdrawal.effective_from_round} · {withdrawal.season_label}</span>{#if withdrawal.reason}<small>{withdrawal.reason}</small>{/if}</li>
					{/each}
				</ul>
			{:else}
				<p class="panel-copy">No players are withdrawn in this fictional league.</p>
			{/if}
			<p class="panel-copy champion-note">A withdrawal never removes past scores: a withdrawn player can still finish as champion on points already earned.</p>
		</article>
	</section>

	<section class="admin-panel award-review-panel" aria-labelledby="review-awards-title">
		<div class="panel-heading">
			<div>
				<p class="section-label">CORRECTION FOLLOW-UP · NO SILENT REWRITES</p>
				<h2 id="review-awards-title">Awards needing review</h2>
			</div>
			<span class="lifecycle-status" class:status-open={data.awardReviewQueue.length > 0}>{data.awardReviewQueue.length} pending</span>
		</div>
		<p class="panel-copy">When an admin corrects a result used as an award source, this queue asks an admin to either apply the corrected score to the award or explicitly retain the saved value. The table never changes on its own.</p>
		{#if data.awardReviewQueue.length}
			<div class="award-review-list">
				{#each data.awardReviewQueue as item (item.awardId)}
					<article class="award-review-card">
						<div class="award-review-summary">
							<p class="section-label">ROUND {item.roundNumber} AWARD · SOURCE REVISION {item.sourceRevision}</p>
							<h3>{item.playerName} v {item.opponentName}</h3>
							<p>Saved award: <strong>{item.currentAwardPoints}</strong> table points · corrected source now gives {item.updatedSourcePoints} points.</p>
							<p class="panel-copy"><a href="/fixtures/{item.resultFixtureId}">Inspect corrected source result</a> · Flagged {new Date(item.flaggedAt).toLocaleString('en-GB')}</p>
						</div>
						{#if data.isAdmin}
							<form method="POST" action="?/reviewAward" class="admin-form review-award-form">
								<input type="hidden" name="awardId" value={item.awardId} />
								<label class="field-label" for="award-review-reason-{item.awardId}">Review reason</label>
								<textarea class="flow-input" id="award-review-reason-{item.awardId}" name="reason" rows="2" minlength="3" maxlength="240" required></textarea>
								<div class="review-award-buttons">
									<button class="small-primary" type="submit" name="decision" value="apply_source">Apply corrected source ({item.updatedSourcePoints})</button>
									<button class="small-secondary" type="submit" name="decision" value="keep">Keep current award</button>
								</div>
							</form>
						{/if}
					</article>
				{/each}
			</div>
		{:else}
			<p class="panel-copy">No corrected source results are waiting on an award decision.</p>
		{/if}
	</section>

	<section class="admin-panel" aria-labelledby="award-ledger-title">
		<div class="panel-heading">
			<div>
				<p class="section-label">TABLE POINTS ONLY · AUDITABLE SOURCE</p>
				<h2 id="award-ledger-title">Award ledger · {data.season?.label ?? 'all seasons'}</h2>
			</div>
			<span class="lifecycle-status">{data.awardLedger.length} award{data.awardLedger.length === 1 ? '' : 's'}</span>
		</div>
		{#if data.awardLedger.length}
			<div class="standings-scroll">
				<table>
					<caption class="visually-hidden">Administrative table-point awards by fixture, source and value.</caption>
					<thead><tr><th scope="col">Round</th><th scope="col">Fixture</th><th scope="col">Recipient</th><th scope="col">Points</th><th scope="col">Source</th><th scope="col">Reason</th></tr></thead>
					<tbody>
						{#each data.awardLedger as item (item.awardId)}
							<tr>
								<th scope="row">{item.roundNumber}</th>
								<td><a href="/fixtures/{item.fixtureId}">{item.playerName} v {item.opponentName}</a></td>
								<td>{item.playerName}</td>
								<td>{item.tablePoints}</td>
								<td>{#if item.sourceType === 'previous_round_result' && item.sourceFixtureId}<a href="/fixtures/{item.sourceFixtureId}/correct">Previous-round result #{item.sourceResultId}</a>{:else if item.sourceType === 'random_draw'}Random draw · {item.drawValue}{:else if item.sourceType === 'previous_round_result'}Previous-round result #{item.sourceResultId}{:else}Manual{/if}</td>
								<td>{item.reason ?? '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="panel-copy">No administrative awards have been issued this season.</p>
		{/if}
		<p class="panel-copy">Awards create no result and add no frames, frame difference, wins or losses. Only the recorded table points can affect standings.</p>
	</section>
</section>

<style>
	.award-error { border-color: rgba(235, 138, 120, 0.45); }
	.withdrawal-preview-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 10px; }
	.withdrawal-preview-form label { grid-column: 1 / -1; }
	.withdrawal-preview-copy { margin: 16px 0 10px; }
	.preview-list-title { margin: 17px 0 8px; color: #e8f2e0; font-size: 14px; }
	.withdrawal-preview-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
	.withdrawal-preview-list li { display: grid; gap: 3px; padding: 10px 12px; border: 1px solid rgba(212, 236, 199, 0.13); border-radius: 10px; background: rgba(5, 31, 23, 0.4); }
	.withdrawal-preview-list strong { color: #f4e8c5; }
	.withdrawal-preview-list span { color: #b9cdb1; font-size: 12px; line-height: 1.45; }
	.award-submit-form { margin-top: 16px; }
	.champion-note { margin-top: 16px; }
	.award-review-panel h2 { margin-bottom: 0; }
	.award-review-list { display: grid; gap: 13px; margin-top: 18px; }
	.award-review-card { display: grid; grid-template-columns: minmax(0, 1fr) minmax(240px, 0.8fr); gap: 18px; padding: 16px; border: 1px solid rgba(225, 188, 108, 0.24); border-radius: 13px; background: rgba(34, 33, 18, 0.28); }
	.award-review-summary h3 { margin: 5px 0 9px; color: #f2e6c7; }
	.award-review-summary p { margin: 5px 0; color: #c3d3ba; font-size: 13px; line-height: 1.5; }
	.award-review-summary strong { color: #f4d981; }
	.award-review-summary a { color: #d6eeaa; }
	.review-award-form { align-self: center; }
	.review-award-buttons { display: flex; flex-wrap: wrap; gap: 8px; }
	.review-award-buttons button { min-height: 42px; }
	.award-reveal { margin: 14px 0 20px; padding: 20px; border: 1px solid rgba(235, 207, 128, 0.32); border-radius: 16px; background: linear-gradient(135deg, rgba(21, 65, 43, 0.8), rgba(53, 48, 24, 0.54)); }
	.award-reveal h2 { margin: 4px 0 7px; color: #f5e6b8; }
	.award-reveal .panel-copy { margin: 0; }
	.award-reveal-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin-top: 16px; }
	.reveal-card { display: grid; gap: 5px; padding: 15px; border: 1px solid rgba(212, 236, 199, 0.18); border-radius: 13px; background: rgba(3, 27, 19, 0.62); animation: award-reveal 480ms cubic-bezier(.2,.8,.2,1) both; }
	.draw-card { border-color: rgba(236, 206, 119, 0.46); }
	.reveal-recipient { color: #d8e9cf; font-size: 13px; font-weight: 700; }
	.reveal-points { color: #f4d981; font-size: 28px; letter-spacing: -0.04em; }
	.reveal-points span { color: #d4dfc7; font-size: 12px; letter-spacing: 0; }
	.reveal-source { color: #b8c9a7; font-size: 11px; line-height: 1.4; }
	@keyframes award-reveal { from { opacity: 0; transform: translateY(8px) scale(.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
	@media (max-width: 680px) { .award-review-card { grid-template-columns: minmax(0, 1fr); } }
	@media (prefers-reduced-motion: reduce) { .reveal-card { animation: none; } }
</style>
