import { describe, expect, it, vi } from 'vitest';
import { syncAiConversation } from './aiConversationSync';

describe('syncAiConversation', () => {
    it('reloads persisted messages and replaces the current AI conversation', async () => {
        const getMessages = vi.fn().mockResolvedValue([
            {
                message_id: 'ai-1',
                sender: { id: 'ai', name: 'AI', role: 'ai' },
                content: 'durable reply',
            },
        ]);
        const setMessages = vi.fn();

        await syncAiConversation('conv-1', getMessages, setMessages);

        expect(getMessages).toHaveBeenCalledWith('conv-1');
        expect(setMessages).toHaveBeenCalledWith([
            expect.objectContaining({ message_id: 'ai-1', status: 'sent' }),
        ]);
    });
});
