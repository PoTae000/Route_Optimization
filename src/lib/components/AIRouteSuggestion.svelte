<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { AIRouteSuggestionData } from '$lib/types';

  export let suggestion: AIRouteSuggestionData;
  export let points: any[] = [];
  export let isLoading = false;

  const dispatch = createEventDispatcher();

  function applySuggestion() {
    dispatch('apply', { order: suggestion.suggestedOrder });
  }

  function dismiss() {
    dispatch('dismiss');
  }

  function getPointName(index: number): string {
    const point = points[index - 1];
    return point?.name || `จุดที่ ${index}`;
  }

  function getPriorityColor(index: number): string {
    const point = points[index - 1];
    if (!point) return '#a1a1aa';
    const p = point.priority;
    if (p <= 1) return '#ef4444';
    if (p <= 2) return '#f97316';
    if (p <= 3) return '#eab308';
    if (p <= 4) return '#22c55e';
    return '#3b82f6';
  }
</script>

<div class="ai-suggestion-backdrop" on:click|self={dismiss}>
  <div class="ai-suggestion-modal">
    <div class="ai-suggestion-header">
      <div class="ai-header-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22">
          <path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/>
          <path d="M16 14H8a4 4 0 0 0-4 4v2h16v-2a4 4 0 0 0-4-4z"/>
          <circle cx="12" cy="5" r="1" fill="currentColor"/>
        </svg>
      </div>
      <h3>AI วางแผนเส้นทาง</h3>
      <button class="ai-close-btn" on:click={dismiss}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>

    {#if isLoading}
      <div class="ai-loading">
        <div class="ai-loading-spinner"></div>
        <p>AI กำลังวิเคราะห์จุดส่ง...</p>
        <p class="ai-loading-sub">ใช้เวลาประมาณ 5-10 วินาที</p>
      </div>
    {:else if suggestion}
      <div class="ai-suggestion-body">
        <!-- Reasoning -->
        <div class="ai-section">
          <div class="ai-section-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
            เหตุผล
          </div>
          <p class="ai-reasoning">{suggestion.reasoning}</p>
        </div>

        <!-- Suggested Order -->
        <div class="ai-section">
          <div class="ai-section-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
            ลำดับแนะนำ
          </div>
          <div class="ai-order-list">
            {#each suggestion.suggestedOrder as pointIdx, i}
              <div class="ai-order-item">
                <span class="ai-order-num">{i + 1}</span>
                <span class="ai-order-name">{getPointName(pointIdx)}</span>
                <span class="ai-order-priority" style="background: {getPriorityColor(pointIdx)}20; color: {getPriorityColor(pointIdx)}; border: 1px solid {getPriorityColor(pointIdx)}40">
                  P{points[pointIdx - 1]?.priority || '?'}
                </span>
              </div>
            {/each}
          </div>
        </div>

        <!-- Clusters -->
        {#if suggestion.clusters && suggestion.clusters.length > 0}
          <div class="ai-section">
            <div class="ai-section-label">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="3"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/></svg>
              กลุ่มพื้นที่
            </div>
            <div class="ai-clusters">
              {#each suggestion.clusters as cluster}
                <div class="ai-cluster-chip">
                  <span class="ai-cluster-name">{cluster.name}</span>
                  <span class="ai-cluster-count">{cluster.points.length} จุด</span>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Tips -->
        {#if suggestion.tips && suggestion.tips.length > 0}
          <div class="ai-section">
            <div class="ai-section-label">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              เคล็ดลับ
            </div>
            <ul class="ai-tips">
              {#each suggestion.tips as tip}
                <li>{tip}</li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>

      <div class="ai-suggestion-footer">
        <button class="ai-btn ai-btn-apply" on:click={applySuggestion}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M5 13l4 4L19 7"/></svg>
          ใช้ลำดับนี้
        </button>
        <button class="ai-btn ai-btn-dismiss" on:click={dismiss}>
          ไม่ใช้
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
.ai-suggestion-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

.ai-suggestion-modal {
  background: #1a1a2e;
  border: 1px solid rgba(139, 92, 246, 0.3);
  border-radius: 16px;
  width: 100%;
  max-width: 440px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 0 40px rgba(139, 92, 246, 0.1);
  animation: slideUp 0.3s ease;
}

@keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

.ai-suggestion-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.ai-header-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: linear-gradient(135deg, #8b5cf6, #6366f1);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  flex-shrink: 0;
}

.ai-suggestion-header h3 {
  flex: 1;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #e4e4e7;
}

.ai-close-btn {
  background: none;
  border: none;
  color: #71717a;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  transition: all 0.2s;
}
.ai-close-btn:hover { color: #e4e4e7; background: rgba(255,255,255,0.1); }

.ai-loading {
  padding: 48px 20px;
  text-align: center;
  color: #a1a1aa;
}

.ai-loading p { margin: 12px 0 0; font-size: 14px; }
.ai-loading .ai-loading-sub { font-size: 12px; color: #71717a; margin-top: 6px; }

.ai-loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(139, 92, 246, 0.2);
  border-top-color: #8b5cf6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto;
}

@keyframes spin { to { transform: rotate(360deg); } }

.ai-suggestion-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.ai-section {
  margin-bottom: 16px;
}
.ai-section:last-child { margin-bottom: 0; }

.ai-section-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #8b5cf6;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.ai-reasoning {
  font-size: 13px;
  line-height: 1.6;
  color: #d4d4d8;
  margin: 0;
  padding: 10px 12px;
  background: rgba(139, 92, 246, 0.08);
  border-radius: 8px;
  border-left: 3px solid #8b5cf6;
}

.ai-order-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ai-order-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  transition: background 0.2s;
}
.ai-order-item:hover { background: rgba(255, 255, 255, 0.06); }

.ai-order-num {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: linear-gradient(135deg, #8b5cf6, #6366f1);
  color: white;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.ai-order-name {
  flex: 1;
  font-size: 13px;
  color: #e4e4e7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-order-priority {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  flex-shrink: 0;
}

.ai-clusters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ai-cluster-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: rgba(99, 102, 241, 0.12);
  border: 1px solid rgba(99, 102, 241, 0.25);
  border-radius: 20px;
  font-size: 12px;
  color: #a5b4fc;
}

.ai-cluster-count {
  font-size: 11px;
  opacity: 0.7;
}

.ai-tips {
  margin: 0;
  padding: 0 0 0 18px;
  list-style: none;
}
.ai-tips li {
  position: relative;
  font-size: 13px;
  color: #a1a1aa;
  line-height: 1.6;
  padding: 2px 0;
}
.ai-tips li::before {
  content: '💡';
  position: absolute;
  left: -18px;
  font-size: 11px;
}

.ai-suggestion-footer {
  display: flex;
  gap: 10px;
  padding: 16px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.ai-btn {
  flex: 1;
  padding: 10px 16px;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all 0.2s;
}

.ai-btn-apply {
  background: linear-gradient(135deg, #8b5cf6, #6366f1);
  color: white;
}
.ai-btn-apply:hover { filter: brightness(1.1); transform: translateY(-1px); }

.ai-btn-dismiss {
  background: rgba(255, 255, 255, 0.06);
  color: #a1a1aa;
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.ai-btn-dismiss:hover { background: rgba(255, 255, 255, 0.1); color: #e4e4e7; }

@media (max-width: 480px) {
  .ai-suggestion-modal { max-height: 85vh; border-radius: 12px; }
  .ai-suggestion-header { padding: 12px 16px; }
  .ai-suggestion-body { padding: 12px 16px; }
  .ai-suggestion-footer { padding: 12px 16px; }
}
</style>
