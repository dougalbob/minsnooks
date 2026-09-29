/**
 * Shared view types for chat (Phase 13).
 *
 * Client-safe (types only) so Svelte components and the server module describe
 * a message, thread or report the same way. The runtime rules live in
 * `$lib/chat`; the database paths live in `$lib/server/chat`.
 */
import type { ChatMessageState } from './chat';

export interface ChatMessageView {
	id: number;
	authorPlayerId: number;
	authorName: string;
	authorInitials: string;
	authorTone: string;
	createdAt: string;
	state: ChatMessageState;
	/** Null whenever there is nothing to read (deleted or admin-hidden). */
	body: string | null;
	isOwn: boolean;
	canDelete: boolean;
	canReport: boolean;
}

export interface ChatThreadPartner {
	playerId: number;
	name: string;
	initials: string;
	tone: string;
}

export interface ChatThreadSummary {
	threadId: number;
	partner: ChatThreadPartner;
	unread: number;
	lastMessage: {
		id: number;
		createdAt: string;
		authorIsMe: boolean;
		state: ChatMessageState;
		preview: string;
	} | null;
}

export interface ChatChannelView {
	channelId: number;
	channelName: string;
	messages: ChatMessageView[];
	hasEarlier: boolean;
	latestId: number;
}

export interface ChatThreadView {
	threadId: number;
	partner: ChatThreadPartner;
	messages: ChatMessageView[];
	hasEarlier: boolean;
	latestId: number;
}

export interface ChatBadgeSummary {
	league: number;
	direct: number;
	total: number;
}

export interface ChatCandidate extends ChatThreadPartner {
	threadId: number | null;
}

export interface ChatReportView {
	id: number;
	messageId: number;
	messageBody: string;
	messageState: ChatMessageState;
	messageAuthorName: string;
	messageCreatedAt: string;
	destination: 'channel' | 'thread';
	reporterName: string;
	reporterPlayerId: number;
	reason: string;
	createdAt: string;
	status: 'open' | 'resolved';
	resolution: 'hidden' | 'kept' | null;
	reviewedByName: string | null;
	reviewedAt: string | null;
	reviewNote: string | null;
}
