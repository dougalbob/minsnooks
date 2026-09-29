<script lang="ts">
	/**
	 * The chat composer (Phase 13, docs/spec/chat.md §4 G).
	 *
	 * Progressive enhancement first: this is a plain form posting to a server
	 * action, so chat works with JavaScript disabled. The live counter and the
	 * inline error come from the same pure rules the server enforces
	 * (`$lib/chat`), and a failed send always keeps the typed text.
	 */
	import { enhance } from '$app/forms';
	import { CHAT_MAX_LENGTH, normaliseChatBody } from '$lib/chat';

	interface Props {
		action: string;
		label: string;
		placeholder?: string;
		disabled?: boolean;
		disabledReason?: string | null;
		serverMessage?: string | null;
	}

	let {
		action,
		label,
		placeholder = 'Write a message…',
		disabled = false,
		disabledReason = null,
		serverMessage = null
	}: Props = $props();

	let body = $state('');
	let pending = $state(false);
	let attempted = $state(false);

	const liveCheck = $derived(attempted ? normaliseChatBody(body) : null);
	const clientError = $derived(
		liveCheck && !liveCheck.ok ? liveCheck.error : attempted && body.trim().length === 0 ? 'Write a message before sending.' : null
	);
	const remaining = $derived(CHAT_MAX_LENGTH - body.length);
</script>

{#if disabled}
	<p class="composer-disabled">{disabledReason ?? 'You cannot post here right now.'}</p>
{:else}
	<div class="composer-wrap">
		{#if serverMessage}
			<p class="form-error" role="alert">{serverMessage}</p>
		{:else if clientError}
			<p class="form-error" role="alert">{clientError}</p>
		{/if}

		<form
			method="POST"
			{action}
			class="composer"
			use:enhance={() => {
				pending = true;
				attempted = true;
				return async ({ result, update }) => {
					pending = false;
					if (result.type === 'success') {
						body = '';
						attempted = false;
					}
					await update();
				};
			}}
		>
			<label class="visually-hidden" for="chat-composer-{label}">{label}</label>
			<textarea
				id="chat-composer-{label}"
				name="body"
				class="composer-input"
				rows="2"
				{placeholder}
				bind:value={body}
				spellcheck="true"
				aria-describedby="chat-composer-count-{label}"
			></textarea>
			<div class="composer-row">
				<span
					id="chat-composer-count-{label}"
					class="composer-count"
					class:count-over={remaining < 0}
				>
					{#if remaining < 0}
						{-remaining} characters over the limit
					{:else}
						{remaining} characters left
					{/if}
				</span>
				<button class="composer-send" type="submit" disabled={pending}>
					{pending ? 'Sending…' : 'Send'}
				</button>
			</div>
		</form>
	</div>
{/if}

<style>
	.composer-wrap {
		margin-top: 14px;
	}

	.composer {
		display: grid;
		gap: 8px;
		padding: 12px;
		border: 1px solid rgba(163, 235, 196, 0.22);
		border-radius: 16px;
		background: rgba(0, 27, 19, 0.45);
	}

	.composer-input {
		width: 100%;
		min-height: 52px;
		max-height: 180px;
		resize: vertical;
		border: 1px solid rgba(163, 235, 196, 0.24);
		border-radius: 12px;
		background: rgba(3, 42, 30, 0.8);
		color: var(--text);
		font: 400 15px 'DM Sans', sans-serif;
		padding: 10px 12px;
	}

	.composer-input:focus-visible {
		outline: 2px solid var(--lime);
		outline-offset: 2px;
	}

	.composer-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.composer-count {
		color: #9fc0aa;
		font-size: 12px;
	}

	.composer-count.count-over {
		color: #f0b48a;
		font-weight: 700;
	}

	.composer-send {
		min-height: 44px;
		padding: 0 22px;
		border: 0;
		border-radius: 999px;
		background: linear-gradient(180deg, #d9f2a0, #a9d977);
		color: #08281c;
		font: 700 14px 'Manrope', sans-serif;
		cursor: pointer;
	}

	.composer-send:disabled {
		opacity: 0.65;
		cursor: progress;
	}

	.composer-send:focus-visible {
		outline: 2px solid var(--text);
		outline-offset: 2px;
	}

	.composer-disabled {
		margin: 14px 0 0;
		padding: 12px 14px;
		border: 1px dashed rgba(163, 235, 196, 0.28);
		border-radius: 14px;
		color: #bcd6c2;
		font-size: 13px;
	}

	.form-error {
		margin: 0 0 8px;
		padding: 10px 12px;
		border: 1px solid rgba(240, 180, 138, 0.45);
		border-radius: 12px;
		background: rgba(90, 42, 20, 0.35);
		color: #f7d8bd;
		font-size: 13px;
	}
</style>
