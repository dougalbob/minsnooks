<script lang="ts">
	import ChatComposer from '$lib/components/ChatComposer.svelte';
	import ChatStream from '$lib/components/ChatStream.svelte';
	import type { PageData } from './$types';

	let {
		data,
		form
	}: {
		data: PageData;
		form: { message?: string; reported?: boolean; duplicate?: boolean; deleted?: boolean } | null;
	} = $props();

	const thread = $derived(data.thread);
	const earliestId = $derived(thread && thread.messages.length > 0 ? thread.messages[0].id : null);
</script>

<svelte:head>
	<title>Minsnooks · Direct message</title>
</svelte:head>

<section class="chat-page" aria-labelledby="thread-title">
	<p class="back-line">
		<a class="back-link" href="/chat/direct"><span aria-hidden="true">←</span> Direct messages</a>
	</p>

	{#if !thread}
		<div class="placeholder-card">
			<strong>Direct messages need a signed-in league player.</strong>
			{data.gate.reason ?? 'Sign in to read and send messages.'}
		</div>
	{:else}
		<header class="thread-header">
			<span class="avatar avatar-{thread.partner.tone} thread-avatar" aria-hidden="true"
				>{thread.partner.initials}</span
			>
			<div>
				<h1 id="thread-title">{thread.partner.name}</h1>
				<p class="thread-note">
					Private conversation between you and {thread.partner.name}. Nobody else can read it.
				</p>
			</div>
		</header>

		{#if form?.reported}
			<p class="status-note" role="status">
				{form.duplicate
					? 'You have already reported this message — an admin will see it.'
					: 'Thanks — an admin will review that message.'}
			</p>
		{/if}

		{#if data.before !== null}
			<p class="older-row">
				<span>Showing earlier messages.</span>
				<a class="older-link" href="/chat/direct/{thread.threadId}">Jump to the latest</a>
			</p>
		{/if}

		<ChatStream
			messages={thread.messages}
			timezone={data.timezone}
			todayKey={data.todayKey}
			scopeLabel={`your conversation with ${thread.partner.name}`}
			feedUrl="/chat/feed?scope=thread&threadId={thread.threadId}"
			deleteAction="?/delete"
			reportAction="?/report"
			hasEarlier={thread.hasEarlier}
			earlierHref={earliestId ? `/chat/direct/${thread.threadId}?before=${earliestId}` : null}
		/>

		<ChatComposer
			action="?/post"
			label="direct message"
			placeholder={`Message ${thread.partner.name}…`}
			serverMessage={form?.message ?? null}
		/>
	{/if}
</section>

<style>
	.chat-page {
		max-width: 760px;
		margin: 0 auto;
		padding: 10px 18px 40px;
	}

	.back-line {
		margin: 0 0 10px;
	}

	.thread-header {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 14px;
	}

	.thread-header h1 {
		margin: 0;
		font: 800 24px 'Manrope', sans-serif;
		color: var(--text);
	}

	.thread-note {
		margin: 4px 0 0;
		color: #a8c8b1;
		font-size: 12.5px;
	}

	.thread-avatar {
		flex: 0 0 auto;
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
