import type { ChatMessage } from '../../types';

export async function syncAiConversation(
    conversationId: string,
    getMessages: (id: string) => Promise<ChatMessage[]>,
    setMessages: (messages: ChatMessage[]) => void,
): Promise<void> {
    const messages = await getMessages(conversationId);
    setMessages(messages.map((message) => ({
        ...message,
        status: 'sent' as const,
    })));
}
