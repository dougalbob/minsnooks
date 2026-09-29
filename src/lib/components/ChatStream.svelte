<script lang="ts">
	/**
	 * The message stream for the league channel and DM threads (Phase 13).
	 *
	 * Rendered from server data, then refreshed quietly: an open view re-reads
	 * the newest messages every few seconds and when the window regains focus,
	 * without stealing the reader's scroll position and without optimistic
	 * sends (docs/spec/chat.md §4 H). Nothing here can edit a message — the only
	 * controls are the author's own delete and a report on somebody else's
	 * message, both ordinary server-action forms so they work without
	 * JavaScript.
	 */
	import { enhance } from '$app/forms';
	import {
		CHAT_POLL_INTERVAL_MS,
		chatMessageText,
		chatTimeLabel,
		groupMessagesByDay
	} from '$lib/chat';
	import type { ChatMessageView } from '$lib/chat-view';

	interface Props {
		messages: ChatMessageView[];
		timezone: string;
		todayKey: string;
		scopeLabel: string;
		feedUrl: string;
		deleteAction: string;
		reportAction: string;
		hasEarlier?: boolean;
		earlierHref?: string | null;
		listId?: string;
	}

	let {
		messages,
		timezone,
		todayKey,
		scopeLabel,
		feedUrl,
		deleteAction,
		reportAction,
		hasEarlier = false,
		earlierHref = null,
		listId = 'chat-stream'
	}: Props = $props();

	let rows = $state<ChatMessageView[]>([]);
	let announcement = $state('');
	let refreshing = false;

	// Server data is the truth: adopt it whenever the page revalidates.
	$effect(() => {
		rows = messages;
	});

	const groups = $derived(groupMessagesByDay(rows, timezone, todayKey));

	function nearBottom(): boolean {
		if (typeof window === 'undefined') return false;
		const doc = document.documentElement;
		return doc.scrollHeight - doc.scrollTop - window.innerHeight < 160;
	}

	async function refresh(): Promise<void> {
		if (refreshing || typeof document === 'undefined' || document.hidden) return;
		refreshing = true;
		try {
			const latest = rows.length > 0 ? rows[rows.length - 1].id : 0;
			const joiner = feedUrl.includes('?') ? '&' : '?';
			const response = await fetch(`${feedUrl}${joiner}after=${latest}`, {
				headers: { accept: 'application/json' }
			});
			if (!response.ok) return;
			const payload = (await response.json()) as { messages?: ChatMessageView[] };
			const incoming = payload.messages ?? [];
			const known = new Set(rows.map((message) => message.id));
			const added = incoming.filter((message) => !known.has(message.id));
			if (added.length === 0) return;
			const stickToBottom = nearBottom();
			rows = [...rows, ...added].sort((a, b) => a.id - b.id);
			announcement = added.length === 1 ? '1 new message' : `${added.length} new messages`;
			if (stickToBottom) {
				await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
				window.scrollTo({ top: document.documentElement.scrollHeight });
			}
		} catch {
			/* A dropped poll is not an error state: the next one will catch up. */
		} finally {
			refreshing = false;
		}
	}

	$effect(() => {
		if (typeof window === 'undefined') return;
		const tick = () => void refresh();
		const timer = window.setInterval(tick, CHAT_POLL_INTERVAL_MS);
		const onFocus = () => tick();
		const onVisibility = () => {
			if (!document.hidden) tick();
		};
		window.addEventListener('focus', onFocus);
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			window.clearInterval(timer);
			window.removeEventListener('focus', onFocus);
			document.removeEventListener('visibilitychange', onVisibility);
		};
	});
</script>

<div class="chat-stream" id={listId}>
	<p class="visually-hidden" aria-live="polite">{announcement}</p>

	{#if hasEarlier && earlierHref}
		<p class="earlier-row">
			<a class="earlier-link" href={earlierHref}>Show earlier messages</a>
		</p>
	{/if}

	{#if rows.length === 0}
		<p class="stream-empty">
			No messages yet in {scopeLabel}. Say hello — a short note is enough.
		</p>
	{:else}
		{#each groups as group (group.dayKey)}
			<section class="chat-day" aria-labelledby="chat-day-{group.dayKey}">
				<h3 class="chat-day-heading" id="chat-day-{group.dayKey}">{group.label}</h3>
				<ol class="chat-list">
					{#each group.messages as message (message.id)}
						<li class="chat-message" class:message-own={message.isOwn}>
							<article
								class="bubble"
								class:bubble-own={message.isOwn}
								class:bubble-placeholder={message.state !== 'visible'}
							>
								<span class="avatar avatar-{message.authorTone} bubble-avatar" aria-hidden="true"
									>{message.authorInitials}</span
								>
								<div class="bubble-body">
									<p class="bubble-meta">
										<strong>{message.isOwn ? 'You' : message.authorName}</strong>
										<time datetime={message.createdAt}
											>{chatTimeLabel(message.createdAt, timezone)}</time
										>
									</p>
									<p class="bubble-text">{chatMessageText(message)}</p>

									{#if message.canDelete}
										<form method="POST" action={deleteAction} class="bubble-actions" use:enhance>
											<input type="hidden" name="messageId" value={message.id} />
											<button class="mini-action" type="submit">
												Delete<span class="visually-hidden"> your message at {chatTimeLabel(
														message.createdAt,
														timezone
													)}</span
												>
											</button>
										</form>
									{:else if message.canReport}
										<details class="bubble-actions report-details">
											<summary class="mini-action">
												Report<span class="visually-hidden">
													the message from {message.authorName} at {chatTimeLabel(
														message.createdAt,
														timezone
													)}</span
												>
											</summary>
											<form method="POST" action={reportAction} class="report-form" use:enhance>
												<input type="hidden" name="messageId" value={message.id} />
												<label for="report-reason-{message.id}">Why are you reporting this?</label>
												<input
													id="report-reason-{message.id}"
													name="reason"
													type="text"
													maxlength="500"
													required
													placeholder="A short reason for an admin"
												/>
												<button class="mini-action" type="submit">Send report</button>
											</form>
										</details>
									{/if}
								</div>
							</article>
						</li>
					{/each}
				</ol>
			</section>
		{/each}
	{/if}
</div>

<style>
	.chat-stream {
		margin-top: 6px;
	}

	.earlier-row {
		margin: 0 0 10px;
		text-align: center;
	}

	.earlier-link {
		color: #c9e883;
		font-size: 13px;
		font-weight: 600;
	}

	.stream-empty {
		margin: 0;
		padding: 18px 16px;
		border: 1px dashed rgba(163, 235, 196, 0.26);
		border-radius: 14px;
		color: #bcd6c2;
		font-size: 13px;
	}

	.chat-day + .chat-day {
		margin-top: 18px;
	}

	.chat-day-heading {
		margin: 0 0 8px;
		color: #9fc0aa;
		font: 700 11px 'Manrope', sans-serif;
		letter-spacing: 0.13em;
		text-transform: uppercase;
		text-align: center;
	}

	.chat-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 10px;
	}

	.chat-message {
		display: flex;
	}

	.chat-message.message-own {
		justify-content: flex-end;
	}

	.bubble {
		display: flex;
		gap: 10px;
		max-width: min(94%, 560px);
		padding: 10px 12px;
		border: 1px solid rgba(163, 235, 196, 0.18);
		border-radius: 16px 16px 16px 6px;
		background: rgba(4, 48, 34, 0.72);
	}

	.bubble-own {
		border-radius: 16px 16px 6px 16px;
		background: rgba(12, 105, 66, 0.5);
		border-color: rgba(201, 232, 131, 0.28);
		flex-direction: row-reverse;
	}

	.bubble-placeholder .bubble-text {
		color: #9fc0aa;
		font-style: italic;
	}

	.bubble-avatar {
		flex: 0 0 auto;
	}

	.bubble-body {
		min-width: 0;
	}

	.bubble-own .bubble-body {
		text-align: right;
	}

	.bubble-meta {
		margin: 0 0 3px;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 6px;
		color: #a8c8b1;
		font-size: 11px;
	}

	.bubble-own .bubble-meta {
		justify-content: flex-end;
	}

	.bubble-meta strong {
		color: #e9f6e4;
		font: 700 12px 'Manrope', sans-serif;
	}

	.bubble-text {
		margin: 0;
		color: #f3f8ec;
		font-size: 14.5px;
		line-height: 1.45;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		text-align: left;
	}

	.bubble-actions {
		margin: 6px 0 0;
		display: flex;
		justify-content: flex-start;
		gap: 8px;
	}

	.bubble-own .bubble-actions {
		justify-content: flex-end;
	}

	.mini-action {
		min-height: 32px;
		padding: 4px 10px;
		border: 1px solid rgba(163, 235, 196, 0.3);
		border-radius: 999px;
		background: transparent;
		color: #cfe6cf;
		font: 600 11px 'DM Sans', sans-serif;
		cursor: pointer;
	}

	.mini-action:focus-visible {
		outline: 2px solid var(--lime);
		outline-offset: 2px;
	}

	.report-details summary {
		display: inline-flex;
		align-items: center;
		list-style: none;
	}

	.report-details summary::-webkit-details-marker {
		display: none;
	}

	.report-details[open] summary {
		margin-bottom: 6px;
	}

	.report-form {
		display: grid;
		gap: 6px;
		padding: 10px;
		border: 1px solid rgba(163, 235, 196, 0.22);
		border-radius: 12px;
		background: rgba(0, 27, 19, 0.5);
		text-align: left;
	}

	.report-form label {
		color: #cfe6cf;
		font-size: 12px;
		font-weight: 600;
	}

	.report-form input {
		width: 100%;
		min-height: 40px;
		border: 1px solid rgba(163, 235, 196, 0.24);
		border-radius: 10px;
		background: rgba(3, 42, 30, 0.85);
		color: var(--text);
		font: 400 13px 'DM Sans', sans-serif;
		padding: 8px 10px;
	}

	@media (prefers-reduced-motion: reduce) {
		.chat-stream {
			scroll-behavior: auto;
		}
	}
</style>
