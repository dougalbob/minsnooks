<script lang="ts">
	import { chatDayKey, chatDayLabel, chatTimeLabel } from '$lib/chat';
	import type { PageData } from './$types';

	let {
		data,
		form
	}: {
		data: PageData;
		form: { message?: string; reported?: boolean } | null;
	} = $props();

	function dayLabel(instant: string): string {
		return chatDayLabel(chatDayKey(instant, data.timezone), data.todayKey);
	}
</script>

<svelte:head>
	<title>Minsnooks · Direct messages</title>
</svelte:head>

<section class="chat-page" aria-labelledby="dm-title">
	<header class="chat-header">
		<p class="flow-kicker">LEAGUE · PRIVATE MESSAGES</p>
		<h1 id="dm-title">Direct messages</h1>
		<p class="flow-intro">
			One-to-one conversations between league players. Nobody else can read them — not even an
			admin — unless a message is reported.
		</p>
	</header>

	<nav class="chat-tabs" aria-label="Chat sections">
		<a class="chat-tab" href="/chat">League channel</a>
		<a class="chat-tab chat-tab-active" href="/chat/direct" aria-current="page">Direct messages</a>
	</nav>

	{#if data.signedOut}
		<div class="placeholder-card">
			<strong>Direct messages need a signed-in league player.</strong>
			{data.gate.reason ?? 'Sign in to read and send messages.'}
		</div>
	{:else}
		{#if form?.message}
			<p class="form-error" role="alert">{form.message}</p>
		{/if}

		<section class="thread-panel" aria-labelledby="threads-title">
			<h2 id="threads-title" class="panel-title">Your conversations</h2>
			{#if data.threads.length === 0}
				<p class="panel-copy">
					No conversations yet. Start one below — a message about a fixture, a date or a
					well-earned win.
				</p>
			{:else}
				<ul class="thread-list">
					{#each data.threads as thread (thread.threadId)}
						<li>
							<a class="thread-row" href="/chat/direct/{thread.threadId}">
								<span class="avatar avatar-{thread.partner.tone} thread-avatar" aria-hidden="true"
									>{thread.partner.initials}</span
								>
								<span class="thread-main">
									<span class="thread-name">{thread.partner.name}</span>
									<span class="thread-preview">
										{#if thread.lastMessage}
											{thread.lastMessage.authorIsMe ? 'You: ' : ''}{thread.lastMessage.preview}
										{:else}
											No messages yet
										{/if}
									</span>
								</span>
								<span class="thread-meta">
									{#if thread.unread > 0}
										<span class="thread-unread"
											>{thread.unread}<span class="visually-hidden"> unread</span></span
										>
									{/if}
									{#if thread.lastMessage}
										<span class="thread-time">
											{dayLabel(thread.lastMessage.createdAt)}
											· {chatTimeLabel(thread.lastMessage.createdAt, data.timezone)}
										</span>
									{/if}
								</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="thread-panel" aria-labelledby="start-title">
			<h2 id="start-title" class="panel-title">Start a conversation</h2>
			<p class="panel-copy">
				Pick a league player. If you already have a conversation together, this opens it.
			</p>
			<form method="POST" action="?/start" class="start-form">
				<label class="visually-hidden" for="dm-player">Player</label>
				<select class="start-select" id="dm-player" name="playerId" required>
					<option value="">Choose a league player…</option>
					{#each data.candidates as candidate (candidate.playerId)}
						<option value={candidate.playerId}>
							{candidate.name}{candidate.threadId ? ' · conversation started' : ''}
						</option>
					{/each}
				</select>
				<button class="start-button" type="submit">Open conversation</button>
			</form>
		</section>
	{/if}
</section>

<style>
	.chat-page {
		max-width: 760px;
		margin: 0 auto;
		padding: 10px 18px 40px;
	}

	.chat-header {
		margin-bottom: 14px;
	}

	.chat-header h1 {
		margin: 4px 0 8px;
		font: 800 30px 'Manrope', sans-serif;
		color: var(--text);
	}

	.chat-tabs {
		display: flex;
		gap: 8px;
		margin-bottom: 14px;
	}

	.chat-tab {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		min-height: 44px;
		padding: 0 16px;
		border: 1px solid rgba(163, 235, 196, 0.24);
		border-radius: 999px;
		color: #cfe6cf;
		font: 600 13px 'Manrope', sans-serif;
		text-decoration: none;
	}

	.chat-tab-active {
		background: rgba(201, 232, 131, 0.16);
		border-color: rgba(201, 232, 131, 0.5);
		color: #eefadb;
	}

	.chat-tab:focus-visible {
		outline: 2px solid var(--lime);
		outline-offset: 2px;
	}

	.thread-panel {
		margin-bottom: 16px;
		padding: 16px;
		border: 1px solid rgba(163, 235, 196, 0.2);
		border-radius: 18px;
		background: rgba(4, 40, 29, 0.55);
	}

	.panel-title {
		margin: 0 0 10px;
		font: 750 18px 'Manrope', sans-serif;
		color: #eefadb;
	}

	.panel-copy {
		margin: 0 0 12px;
		color: #bcd6c2;
		font-size: 13.5px;
	}

	.thread-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}

	.thread-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		border: 1px solid rgba(163, 235, 196, 0.18);
		border-radius: 14px;
		background: rgba(0, 27, 19, 0.4);
		color: var(--text);
		text-decoration: none;
	}

	.thread-row:hover,
	.thread-row:focus-visible {
		border-color: rgba(201, 232, 131, 0.5);
	}

	.thread-avatar {
		flex: 0 0 auto;
	}

	.thread-main {
		display: grid;
		gap: 2px;
		min-width: 0;
		flex: 1 1 auto;
	}

	.thread-name {
		font: 700 14px 'Manrope', sans-serif;
		color: #eefadb;
	}

	.thread-preview {
		color: #a8c8b1;
		font-size: 12.5px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.thread-meta {
		display: grid;
		justify-items: end;
		gap: 4px;
		flex: 0 0 auto;
	}

	.thread-unread {
		min-width: 22px;
		height: 22px;
		padding: 0 7px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		background: #d9f2a0;
		color: #0a2e20;
		font-size: 11px;
		font-weight: 800;
	}

	.thread-time {
		color: #8fb69c;
		font-size: 11px;
	}

	.start-form {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}

	.start-select {
		flex: 1 1 240px;
		min-height: 46px;
		border: 1px solid rgba(163, 235, 196, 0.24);
		border-radius: 12px;
		background: rgba(3, 42, 30, 0.85);
		color: var(--text);
		font: 400 14px 'DM Sans', sans-serif;
		padding: 0 12px;
	}

	.start-button {
		min-height: 46px;
		padding: 0 20px;
		border: 0;
		border-radius: 999px;
		background: linear-gradient(180deg, #d9f2a0, #a9d977);
		color: #08281c;
		font: 700 14px 'Manrope', sans-serif;
		cursor: pointer;
	}

	.start-button:focus-visible,
	.start-select:focus-visible {
		outline: 2px solid var(--lime);
		outline-offset: 2px;
	}
</style>
