<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import type { AIChatMessage, AIChatContext } from '$lib/types';
  import { renderMarkdown } from '$lib/utils/markdown';

  export let context: AIChatContext = {
    totalPoints: 0,
    completedPoints: 0,
    remainingPoints: 0,
    hasRoute: false,
    isNavigating: false
  };

  export let userId: string | number = 'guest';

  const dispatch = createEventDispatcher();

  export let isOpen = false;
  let messages: AIChatMessage[] = [];
  let inputText = '';
  let isStreaming = false;
  let messagesContainer: HTMLElement;
  let inputElement: HTMLInputElement;

  // Track actions per message index
  let messageActions: Record<number, { type: string; params: Record<string, string> }[]> = {};
  let executedActions: Set<string> = new Set();

  // ═══ Feature 3: Chat history persistence ═══

  function getChatKey(): string {
    return `aiChat_${userId}`;
  }

  function saveMessages() {
    try {
      const capped = messages.slice(-100);
      const data = {
        messages: capped,
        messageActions,
        executedActions: Array.from(executedActions)
      };
      localStorage.setItem(getChatKey(), JSON.stringify(data));
    } catch {
      // localStorage full or unavailable
    }
  }

  function loadMessages() {
    try {
      const raw = localStorage.getItem(getChatKey());
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.messages && Array.isArray(data.messages)) {
        messages = data.messages;
      }
      if (data.messageActions) {
        messageActions = data.messageActions;
      }
      if (data.executedActions && Array.isArray(data.executedActions)) {
        executedActions = new Set(data.executedActions);
      }
    } catch {
      // corrupted data, ignore
    }
  }

  onMount(() => {
    loadMessages();
    if (messages.length > 0) {
      scrollToBottom();
    }
  });

  // ═══ Feature 6: Context window management ═══

  function summarizeOlderMessages(msgs: AIChatMessage[]): string {
    const places: string[] = [];
    const actionTypes = new Set<string>();
    const userQuestions: string[] = [];

    for (const msg of msgs) {
      if (msg.role === 'user') {
        userQuestions.push(msg.content.slice(0, 60));
      }
      if (msg.role === 'assistant') {
        const actions = parseActions(msg.content);
        for (const a of actions) {
          actionTypes.add(a.type);
          const place = a.params.query || a.params.name || a.params.keyword;
          if (place) places.push(place);
        }
      }
    }

    const parts: string[] = ['[สรุปบทสนทนาก่อนหน้า]'];
    if (places.length > 0) {
      parts.push(`สถานที่ที่พูดถึง: ${[...new Set(places)].join(', ')}`);
    }
    if (actionTypes.size > 0) {
      parts.push(`การกระทำที่ใช้: ${Array.from(actionTypes).join(', ')}`);
    }
    if (userQuestions.length > 0) {
      const recent = userQuestions.slice(-5);
      parts.push(`คำถามล่าสุด: ${recent.join(' | ')}`);
    }
    return parts.join('\n');
  }

  function buildContextMessages(): AIChatMessage[] {
    // Exclude the last message (empty placeholder) — caller handles that
    const allMsgs = messages.slice(0, -1);
    if (allMsgs.length <= 12) {
      return allMsgs;
    }
    const olderMsgs = allMsgs.slice(0, -10);
    const recentMsgs = allMsgs.slice(-10);
    const summary = summarizeOlderMessages(olderMsgs);
    return [
      { role: 'assistant', content: summary },
      ...recentMsgs
    ];
  }

  const quickChips = [
    { label: 'เซเว่นใกล้ฉัน', text: 'หาเซเว่นใกล้ฉันหน่อย' },
    { label: 'ปั๊มน้ำมัน', text: 'หาปั๊มน้ำมันใกล้ๆ' },
    { label: 'คาเฟ่ใกล้ๆ', text: 'หาคาเฟ่ใกล้ฉันหน่อย' },
    { label: 'ร้านอาหาร', text: 'หาร้านอาหารใกล้ฉัน' },
    { label: 'สรุปวันนี้', text: 'สรุปสถานะเส้นทางวันนี้' },
    { label: 'คำนวณเส้นทาง', text: 'คำนวณเส้นทางให้หน่อย' },
    { label: 'เริ่มนำทาง', text: 'เริ่มนำทางเลย' },
    { label: 'ประหยัดน้ำมัน', text: 'ให้คำแนะนำการขับขี่เพื่อประหยัดน้ำมัน' },
    { label: 'โรงพยาบาล', text: 'หาโรงพยาบาลใกล้ฉัน' },
    { label: 'ที่จอดรถ', text: 'หาที่จอดรถใกล้ฉัน' },
  ];

  // ═══ Action parsing utilities ═══

  function stripActions(content: string): string {
    return content.replace(/<<ACTION:[^>]+>>/g, '').trim();
  }

  function parseActions(content: string): { type: string; params: Record<string, string> }[] {
    const actions: { type: string; params: Record<string, string> }[] = [];
    const pattern = new RegExp('<<ACTION:(\\w+)(\\|[^>]+)?>>','g');
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const type = match[1];
      const params: Record<string, string> = {};
      if (match[2]) {
        const paramStr = match[2].startsWith('|') ? match[2].slice(1) : match[2];
        for (const pair of paramStr.split('|')) {
          const eqIdx = pair.indexOf('=');
          if (eqIdx > 0) {
            params[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
          }
        }
      }
      actions.push({ type, params });
    }
    return actions;
  }

  function getActionIcon(type: string): string {
    const icons: Record<string, string> = {
      searchAndAdd: '+',
      addPoint: '+',
      searchNearby: '📍',
      navigate: '>',
      stopNav: '||',
      calcRoute: '~',
      clearRoute: 'x',
      centerMap: '@',
      deletePoint: '-',
      deleteAll: '-',
      vehicle: 'V',
      shareETA: 'S',
      carMode: 'C',
      clearNearby: 'x',
      toggleTraffic: 'T',
      toggleVoice: 'V',
      zoomIn: '+',
      zoomOut: '-',
      openGoogleMaps: 'G',
      routePreference: 'R',
      myLocation: 'L',
      summary: 'i'
    };
    return icons[type] || '*';
  }

  function getActionLabel(action: { type: string; params: Record<string, string> }): string {
    const labels: Record<string, string> = {
      searchAndAdd: `ค้นหาและเพิ่ม "${action.params.query || ''}"`,
      addPoint: `เพิ่มจุด "${action.params.name || ''}"`,
      searchNearby: `ค้นหา ${action.params.keyword || action.params.type || 'สถานที่'} ใกล้เคียง`,
      navigate: 'เริ่มนำทาง',
      stopNav: 'หยุดนำทาง',
      calcRoute: 'คำนวณเส้นทาง',
      clearRoute: 'ล้างเส้นทาง',
      centerMap: 'เลื่อนแผนที่',
      deletePoint: `ลบจุด "${action.params.name || ''}"`,
      deleteAll: 'ลบจุดทั้งหมด',
      vehicle: `เปลี่ยนเป็น${action.params.type === 'ev' ? 'รถไฟฟ้า' : 'รถน้ำมัน'}`,
      shareETA: 'แชร์เวลาถึง',
      carMode: 'โหมดรถยนต์',
      clearNearby: 'ล้างผลค้นหา',
      toggleTraffic: 'เปิด/ปิดจราจร',
      toggleVoice: 'เปิด/ปิดเสียง',
      zoomIn: 'ซูมเข้า',
      zoomOut: 'ซูมออก',
      openGoogleMaps: 'เปิด Google Maps',
      routePreference: `เปลี่ยนเส้นทาง ${action.params.pref || ''}`.trim(),
      myLocation: 'ตำแหน่งปัจจุบัน',
      summary: 'สรุปสถานะ'
    };
    return labels[action.type] || action.type;
  }

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
          messages: buildContextMessages(),
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

      // Parse and execute actions from the last assistant message
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.role === 'assistant' && lastMsg.content) {
        const actions = parseActions(lastMsg.content);
        if (actions.length > 0) {
          const msgIdx = messages.length - 1;
          messageActions = { ...messageActions, [msgIdx]: actions };
          for (const action of actions) {
            const actionKey = `${msgIdx}-${action.type}-${JSON.stringify(action.params)}`;
            if (!executedActions.has(actionKey)) {
              executedActions.add(actionKey);
              executedActions = executedActions; // trigger reactivity
              dispatch('action', { type: action.type, params: action.params });
            }
          }
        }
      }

      saveMessages();
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
    messageActions = {};
    executedActions = new Set();
    localStorage.removeItem(getChatKey());
  }

  // Public: inject nearby search results as assistant message
  export function injectNearbyResults(resultLines: string) {
    const content = `พบสถานที่ใกล้เคียง:\n${resultLines}\n\nบอกได้เลยว่าอยากเพิ่มจุดไหน เช่น "เพิ่มจุดที่ 1"`;
    messages = [...messages, { role: 'assistant', content }];
    saveMessages();
    scrollToBottom();
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
              <span class="ai-typing">กำลังพิมพ์<span class="ai-dot">.</span><span class="ai-dot">.</span><span class="ai-dot">.</span></span>
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
          <p class="ai-welcome-sub">ถามได้ทุกเรื่อง! หาร้านใกล้ๆ, วางแผนเส้นทาง, ความรู้ทั่วไป</p>
          <div class="ai-quick-chips">
            {#each quickChips as chip}
              <button class="ai-chip" on:click={() => sendMessage(chip.text)}>{chip.label}</button>
            {/each}
          </div>
        </div>
      {:else}
        {#each messages as msg, i}
          <div class="ai-msg" class:ai-msg-user={msg.role === 'user'} class:ai-msg-assistant={msg.role === 'assistant'}>
            {#if msg.role === 'assistant'}
              <div class="ai-msg-avatar">AI</div>
            {/if}
            <div class="ai-msg-content">
              <div class="ai-msg-bubble">
                {#if msg.role === 'assistant'}
                  {@html renderMarkdown(stripActions(msg.content)) || '...'}{#if isStreaming && i === messages.length - 1}<span class="ai-cursor"></span>{/if}
                {:else}
                  {msg.content}
                {/if}
              </div>
              {#if msg.role === 'assistant' && messageActions[i]}
                <div class="ai-action-cards">
                  {#each messageActions[i] as action}
                    <div class="ai-action-card">
                      <span class="ai-action-icon">{getActionIcon(action.type)}</span>
                      <span class="ai-action-label">{getActionLabel(action)}</span>
                      <span class="ai-action-check">OK</span>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        {/each}
        <!-- Quick chips after messages -->
        {#if !isStreaming}
          <div class="ai-quick-chips ai-chips-inline">
            {#each quickChips.slice(0, 6) as chip}
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
        placeholder="ถามอะไรก็ได้... หาร้าน, ความรู้, สั่งนำทาง"
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
}

.ai-dot {
  display: inline-block;
  animation: dotPulse 1.4s infinite;
}
.ai-dot:nth-child(1) { animation-delay: 0s; }
.ai-dot:nth-child(2) { animation-delay: 0.2s; }
.ai-dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes dotPulse {
  0%, 60%, 100% { opacity: 0.2; }
  30% { opacity: 1; }
}

/* Feature 5: Blinking cursor during streaming */
.ai-cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  background: #00ff88;
  margin-left: 2px;
  vertical-align: text-bottom;
  animation: cursorBlink 0.8s infinite;
}

@keyframes cursorBlink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

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

.ai-msg-content {
  max-width: 80%;
  display: flex;
  flex-direction: column;
  gap: 4px;
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
  white-space: normal;
}

/* Feature 4: Markdown styles inside assistant bubbles */
.ai-msg-assistant .ai-msg-bubble :global(strong) {
  color: #e4e4e7;
  font-weight: 700;
}
.ai-msg-assistant .ai-msg-bubble :global(em) {
  font-style: italic;
  color: #a1a1aa;
}
.ai-msg-assistant .ai-msg-bubble :global(code) {
  background: rgba(0, 255, 136, 0.1);
  padding: 1px 5px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
  color: #4ade80;
}
.ai-msg-assistant .ai-msg-bubble :global(pre) {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 8px 10px;
  margin: 6px 0;
  overflow-x: auto;
}
.ai-msg-assistant .ai-msg-bubble :global(pre code) {
  background: none;
  padding: 0;
  font-size: 12px;
  color: #d4d4d8;
  white-space: pre;
}
.ai-msg-assistant .ai-msg-bubble :global(ul),
.ai-msg-assistant .ai-msg-bubble :global(ol) {
  margin: 4px 0;
  padding-left: 20px;
}
.ai-msg-assistant .ai-msg-bubble :global(li) {
  margin: 2px 0;
}
.ai-msg-assistant .ai-msg-bubble :global(a) {
  color: #00ff88;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.ai-msg-assistant .ai-msg-bubble :global(a:hover) {
  color: #4ade80;
}

/* Action cards */
.ai-action-cards {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.ai-action-card {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: rgba(0, 255, 136, 0.06);
  border: 1px solid rgba(0, 255, 136, 0.15);
  border-radius: 8px;
  font-size: 11px;
}

.ai-action-icon {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  background: rgba(0, 255, 136, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  color: #00ff88;
  flex-shrink: 0;
}

.ai-action-label {
  flex: 1;
  color: #a1a1aa;
}

.ai-action-check {
  color: #22c55e;
  font-size: 10px;
  font-weight: 700;
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
    bottom: 110px;
    width: calc(100vw - 16px);
    height: 60vh;
    border-radius: 12px;
  }
  .ai-chat-toggle {
    bottom: 50px;
    right: 16px;
    left: auto;
    width: 48px;
    height: 48px;
  }
}
</style>
