<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import type { AIChatMessage, AIChatContext } from '$lib/types';

  export let context: AIChatContext = {
    totalPoints: 0,
    completedPoints: 0,
    remainingPoints: 0,
    hasRoute: false,
    isNavigating: false
  };

  const dispatch = createEventDispatcher();

  export let isOpen = false;
  let messages: AIChatMessage[] = [];
  let inputText = '';
  let isStreaming = false;
  let messagesContainer: HTMLElement;
  let inputElement: HTMLInputElement;

  const quickChips = [
    { label: 'สรุปวันนี้', text: 'สรุปสถานะเส้นทางวันนี้' },
    { label: 'ไปไหนก่อนดี?', text: 'ดูจุดแวะทั้งหมดแล้วแนะนำว่าควรไปจุดไหนก่อน' },
    { label: 'เส้นทางไหนดี?', text: 'แนะนำเส้นทางที่ดีที่สุดสำหรับจุดแวะปัจจุบัน' },
    { label: 'ประหยัดน้ำมัน', text: 'ให้คำแนะนำการขับขี่เพื่อประหยัดน้ำมัน' }
  ];

  function togglePanel() {
    isOpen = !isOpen;
    if (isOpen) {
      setTimeout(() => inputElement?.focus(), 100);
    }
  }

  function scrollToBottom() {
    if (messagesContainer) {
      setTimeout(() => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }, 10);
    }
  }

  async function sendMessage(text?: string) {
    const msg = text || inputText.trim();
    if (!msg || isStreaming) return;

    inputText = '';
    messages = [...messages, { role: 'user', content: msg }];
    scrollToBottom();

    isStreaming = true;
    // Add placeholder assistant message
    messages = [...messages, { role: 'assistant', content: '' }];
    scrollToBottom();

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages.slice(0, -1), // exclude empty placeholder
          context
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'ไม่สามารถเชื่อมต่อ AI ได้' }));
        messages = [...messages.slice(0, -1), { role: 'assistant', content: `ขออภัย: ${err.error || 'เกิดข้อผิดพลาด'}` }];
        isStreaming = false;
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        messages = [...messages.slice(0, -1), { role: 'assistant', content: 'ไม่สามารถรับข้อมูลได้' }];
        isStreaming = false;
        return;
      }

      let assistantContent = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              assistantContent += delta;
              messages = [...messages.slice(0, -1), { role: 'assistant', content: assistantContent }];
              scrollToBottom();
            }
          } catch {
            // skip unparseable chunks
          }
        }
      }

      if (!assistantContent) {
        messages = [...messages.slice(0, -1), { role: 'assistant', content: 'ไม่ได้รับคำตอบจาก AI' }];
      }
    } catch (err: any) {
      messages = [...messages.slice(0, -1), { role: 'assistant', content: `เกิดข้อผิดพลาด: ${err.message || 'ไม่ทราบสาเหตุ'}` }];
    } finally {
      isStreaming = false;
      scrollToBottom();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function clearChat() {
    messages = [];
  }
</script>

<!-- Floating toggle button -->
<button class="ai-chat-toggle" class:open={isOpen} on:click={togglePanel} title="AI ผู้ช่วย">
  {#if isOpen}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><path d="M6 18L18 6M6 6l12 12"/></svg>
  {:else}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="24" height="24">
      <path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/>
      <path d="M16 14H8a4 4 0 0 0-4 4v2h16v-2a4 4 0 0 0-4-4z"/>
      <circle cx="12" cy="5" r="1" fill="currentColor"/>
      <path d="M20 8l1 1-3 3-1-1 3-3z" fill="currentColor" stroke="none"/>
    </svg>
  {/if}
</button>

<!-- Chat Panel -->
{#if isOpen}
  <div class="ai-chat-panel">
    <div class="ai-chat-header">
      <div class="ai-chat-title">
        <div class="ai-chat-icon">AI</div>
        <div>
          <div class="ai-chat-name">ผู้ช่วยเส้นทาง</div>
          <div class="ai-chat-status">
            {#if isStreaming}
              <span class="ai-typing">กำลังพิมพ์...</span>
            {:else}
              <span>พร้อมช่วยเหลือ</span>
            {/if}
          </div>
        </div>
      </div>
      {#if messages.length > 0}
        <button class="ai-clear-btn" on:click={clearChat} title="ล้างแชท">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>
      {/if}
    </div>

    <div class="ai-chat-messages" bind:this={messagesContainer}>
      {#if messages.length === 0}
        <div class="ai-welcome">
          <div class="ai-welcome-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32">
              <path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/>
              <path d="M16 14H8a4 4 0 0 0-4 4v2h16v-2a4 4 0 0 0-4-4z"/>
            </svg>
          </div>
          <p>สวัสดี! ฉันเป็นผู้ช่วย AI</p>
          <p class="ai-welcome-sub">ถามอะไรก็ได้เกี่ยวกับเส้นทางจัดส่ง</p>
          <div class="ai-quick-chips">
            {#each quickChips as chip}
              <button class="ai-chip" on:click={() => sendMessage(chip.text)}>{chip.label}</button>
            {/each}
          </div>
        </div>
      {:else}
        {#each messages as msg}
          <div class="ai-msg" class:ai-msg-user={msg.role === 'user'} class:ai-msg-assistant={msg.role === 'assistant'}>
            {#if msg.role === 'assistant'}
              <div class="ai-msg-avatar">AI</div>
            {/if}
            <div class="ai-msg-bubble">
              {msg.content || '...'}
            </div>
          </div>
        {/each}
        <!-- Quick chips after messages -->
        {#if !isStreaming}
          <div class="ai-quick-chips ai-chips-inline">
            {#each quickChips.slice(0, 2) as chip}
              <button class="ai-chip" on:click={() => sendMessage(chip.text)}>{chip.label}</button>
            {/each}
          </div>
        {/if}
      {/if}
    </div>

    <div class="ai-chat-input">
      <input
        bind:this={inputElement}
        bind:value={inputText}
        on:keydown={handleKeydown}
        placeholder="ถาม AI ได้เลย..."
        disabled={isStreaming}
        autocomplete="off"
      />
      <button class="ai-send-btn" on:click={() => sendMessage()} disabled={isStreaming || !inputText.trim()}>
        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
      </button>
    </div>
  </div>
{/if}

<style>
.ai-chat-toggle {
  position: fixed;
  bottom: 40px;
  right: 16px;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: 1px solid rgba(0, 255, 136, 0.3);
  background: rgba(26, 26, 46, 0.85);
  color: #00ff88;
  cursor: pointer;
  z-index: 1500;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3), 0 0 12px rgba(0, 255, 136, 0.15);
  transition: all 0.3s;
}
.ai-chat-toggle:hover { transform: scale(1.08); background: rgba(0, 255, 136, 0.15); border-color: rgba(0, 255, 136, 0.5); color: #4ade80; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4), 0 0 20px rgba(0, 255, 136, 0.2); }
.ai-chat-toggle.open { background: rgba(0, 255, 136, 0.12); border-color: rgba(0, 255, 136, 0.4); color: #4ade80; }

.ai-chat-panel {
  position: fixed;
  bottom: 100px;
  right: 24px;
  width: 360px;
  height: 500px;
  background: rgba(26, 26, 46, 0.95);
  border: 1px solid rgba(0, 255, 136, 0.2);
  border-radius: 16px;
  z-index: 1500;
  display: flex;
  flex-direction: column;
  box-shadow: 0 16px 50px rgba(0, 0, 0, 0.4), 0 0 30px rgba(0, 255, 136, 0.06);
  animation: chatSlideUp 0.25s ease;
}

@keyframes chatSlideUp { from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

.ai-chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.ai-chat-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ai-chat-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: rgba(0, 255, 136, 0.15);
  border: 1px solid rgba(0, 255, 136, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 800;
  color: #00ff88;
}

.ai-chat-name {
  font-size: 14px;
  font-weight: 600;
  color: #e4e4e7;
}

.ai-chat-status {
  font-size: 11px;
  color: #71717a;
}

.ai-typing {
  color: #00ff88;
  animation: pulse 1.5s infinite;
}

@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

.ai-clear-btn {
  background: none;
  border: none;
  color: #71717a;
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  transition: all 0.2s;
}
.ai-clear-btn:hover { color: #ef4444; background: rgba(239,68,68,0.1); }

.ai-chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ai-welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  color: #a1a1aa;
}

.ai-welcome-icon {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: rgba(0, 255, 136, 0.1);
  border: 1px solid rgba(0, 255, 136, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #00ff88;
  margin-bottom: 12px;
}

.ai-welcome p { margin: 0; font-size: 14px; }
.ai-welcome .ai-welcome-sub { font-size: 12px; color: #71717a; margin-top: 4px; }

.ai-quick-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 16px;
  justify-content: center;
}

.ai-chips-inline {
  margin-top: 4px;
  justify-content: flex-start;
}

.ai-chip {
  padding: 6px 12px;
  background: rgba(0, 255, 136, 0.08);
  border: 1px solid rgba(0, 255, 136, 0.2);
  border-radius: 20px;
  color: #4ade80;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}
.ai-chip:hover { background: rgba(0, 255, 136, 0.15); border-color: rgba(0, 255, 136, 0.4); color: #00ff88; }

.ai-msg {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.ai-msg-user {
  flex-direction: row-reverse;
}

.ai-msg-avatar {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: rgba(0, 255, 136, 0.15);
  border: 1px solid rgba(0, 255, 136, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 800;
  color: #00ff88;
  flex-shrink: 0;
}

.ai-msg-bubble {
  max-width: 80%;
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.ai-msg-user .ai-msg-bubble {
  background: rgba(0, 255, 136, 0.15);
  border: 1px solid rgba(0, 255, 136, 0.25);
  color: #e4e4e7;
  border-bottom-right-radius: 4px;
}

.ai-msg-assistant .ai-msg-bubble {
  background: rgba(255, 255, 255, 0.06);
  color: #d4d4d8;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-bottom-left-radius: 4px;
}

.ai-chat-input {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.ai-chat-input input {
  flex: 1;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 13px;
  color: #e4e4e7;
  outline: none;
  transition: border-color 0.2s;
}
.ai-chat-input input:focus { border-color: rgba(0, 255, 136, 0.4); }
.ai-chat-input input::placeholder { color: #52525b; }

.ai-send-btn {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  border: 1px solid rgba(0, 255, 136, 0.3);
  background: rgba(0, 255, 136, 0.15);
  color: #00ff88;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  flex-shrink: 0;
}
.ai-send-btn:hover:not(:disabled) { filter: brightness(1.1); }
.ai-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

@media (max-width: 480px) {
  .ai-chat-panel {
    left: 8px;
    right: auto;
    bottom: 140px;
    width: calc(100vw - 16px);
    height: 60vh;
    border-radius: 12px;
  }
  .ai-chat-toggle {
    bottom: 80px;
    left: 16px;
    right: auto;
    width: 48px;
    height: 48px;
  }
}
</style>
