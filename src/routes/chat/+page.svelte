<script lang="ts">
	import ChatComposer from '$lib/components/ChatComposer.svelte';
	import ChatStream from '$lib/components/ChatStream.svelte';
	import type { PageData } from './$types';

	let {
		data,
		form
	}: {
		data: PageData;
		form: { message?: string; reported?: boolean; duplicate?: boolean; posted?: boolean } | null;
	} = $props();

	const channel = $derived(data.channel);
	const earliestId = $derived(channel && channel.messages.length > 0 ? channel.messages[0].id : null);
</script>

<svelte:head>
	<title>Minsnooks · Chat</title>
</svelte:head>

<section class="chat-page" aria-labelledby="chat-title">
	<header class="chat-header">
		<p class="flow-kicker">LEAGUE · CLUB NOTICEBOARD</p>
		<h1 id="chat-title">Chat</h1>
		<p class="flow-intro">
			A quiet channel for the whole league, plus private one-to-one messages. Nothing said here
			touches the table, the fixtures or anyone's stats.
		</p>
	</header>

	{#if data.signedOut || !channel}
		<div class="placeholder-card">
			<strong>Chat needs a signed-in league player.</strong>
			{data.gate.reason ?? 'Sign in to read and post.'}
		</div>
	{:else}
		<nav class="chat-tabs" aria-label="Chat sections">
			<a class="chat-tab chat-tab-active" href="/chat" aria-current="page">League channel</a>
			<a class="chat-tab" href="/chat/direct">
				Direct messages{#if data.badge.direct > 0}
					<span class="tab-count">{data.badge.direct}</span>
					<span class="visually-hidden"> unread</span>{/if}
			</a>
		</nav>

		<section class="channel-card" aria-labelledby="channel-title">
			<div class="channel-heading">
				<h2 id="channel-title">{channel.channelName}</h2>
				<p class="channel-note">Everyone in the league can read and post here.</p>
			</div>

			{#if data.before !== null}
				<p class="older-row">
					<span>Showing earlier messages.</span>
					<a class="older-link" href="/chat">Jump to the latest</a>
				</p>
			{/if}

			{#if form?.reported}
				<p class="status-note" role="status">
					{form.duplicate
						? 'You have already reported this message — an admin will see it.'
						: 'Thanks — an admin will review that message.'}
				</p>
			{/if}

			<ChatStream
				messages={channel.messages}
				timezone={data.timezone}
				todayKey={data.todayKey}
				scopeLabel="the league channel"
				feedUrl="/chat/feed?scope=channel"
				deleteAction="?/delete"
				reportAction="?/report"
				hasEarlier={channel.hasEarlier}
				earlierHref={earliestId ? `/chat?before=${earliestId}` : null}
			/>

			<ChatComposer
				action="?/post"
				label="league channel"
				placeholder="Say something to the league…"
				serverMessage={form?.message ?? null}
			/>
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

	.tab-count {
		min-width: 20px;
		height: 20px;
		padding: 0 6px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		background: #d9f2a0;
		color: #0a2e20;
		font-size: 11px;
		font-weight: 800;
	}

	.channel-card {
		padding: 16px;
		border: 1px solid rgba(163, 235, 196, 0.2);
		border-radius: 18px;
		background: rgba(4, 40, 29, 0.55);
	}

	.channel-heading h2 {
		margin: 0;
		font: 750 19px 'Manrope', sans-serif;
		color: #eefadb;
	}

	.channel-note {
		margin: 4px 0 12px;
		color: #a8c8b1;
		font-size: 12.5px;
	}

	.older-row {
		margin: 0 0 10px;
		display: flex;
		gap: 10px;
		align-items: baseline;
		color: #a8c8b1;
		font-size: 12.5px;
	}

	.older-link {
		color: #c9e883;
		font-weight: 650;
	}

	.status-note {
		margin: 0 0 10px;
		padding: 10px 12px;
		border: 1px solid rgba(201, 232, 131, 0.35);
		border-radius: 12px;
		background: rgba(20, 70, 45, 0.4);
		color: #e6f5d8;
		font-size: 13px;
	}
</style>
