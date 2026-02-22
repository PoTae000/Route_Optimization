<script>
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();

  export let show = false;
  export let alerts = [];

  function clearAlerts() {
    dispatch('clearAlerts');
  }

  function dismissAlert(id) {
    dispatch('dismissAlert', { id });
  }
</script>

{#if show}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="alerts-backdrop" on:click={() => show = false} role="presentation"></div>
  <div class="alerts-panel">
    <div class="alerts-header">
      <div class="alerts-title-row">
        <div class="alerts-bell">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/></svg>
        </div>
        <h3>การแจ้งเตือน</h3>
        {#if alerts.length > 0}
          <span class="alerts-count">{alerts.length}</span>
        {/if}
      </div>
      <div class="alerts-actions">
        <button class="alerts-clear-btn" on:click={clearAlerts}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          ล้าง
        </button>
        <button class="alerts-close-btn" on:click={() => show = false}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
    </div>
    <div class="alerts-list">
      {#if alerts.length === 0}
        <div class="empty-alerts">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0" stroke-linecap="round"/><path d="M2 2l20 20" stroke-linecap="round"/></svg>
          <span>ไม่มีการแจ้งเตือน</span>
        </div>
      {:else}
        {#each alerts as alert, i}
          <div class="alert-item" class:alert-emergency={alert.type === 'emergency'} style="--delay:{i * 0.05}s">
            <div class="alert-icon-wrap" class:icon-delivery={alert.type === 'delivery'} class:icon-navigation={alert.type === 'navigation'} class:icon-break={alert.type === 'break'} class:icon-emergency={alert.type === 'emergency'}>
              {#if alert.type === 'delivery'}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>
              {:else if alert.type === 'navigation'}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
              {:else if alert.type === 'break'}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 8h1a4 4 0 110 8h-1M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8zM6 2v4M10 2v4M14 2v4"/></svg>
              {:else if alert.type === 'emergency'}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01"/></svg>
              {:else}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
              {/if}
            </div>
            <div class="alert-content">
              <div class="alert-message">{alert.message}</div>
              <div class="alert-time">{alert.time.toLocaleTimeString('th-TH')}</div>
            </div>
            <button class="alert-dismiss" on:click={() => dismissAlert(alert.id)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        {/each}
      {/if}
    </div>
  </div>
{/if}

<style>
  .alerts-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); z-index: 1999; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); animation: alertBackdropIn 0.3s ease; }
  @keyframes alertBackdropIn { from { opacity: 0; } to { opacity: 1; } }
  .alerts-panel {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: 440px; max-width: calc(100% - 32px); max-height: 520px; z-index: 2000;
    overflow: hidden; display: flex; flex-direction: column;
    background: rgba(12, 12, 20, 0.95); backdrop-filter: blur(30px) saturate(1.4);
    -webkit-backdrop-filter: blur(30px) saturate(1.4);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 20px;
    box-shadow: 0 25px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.03), 0 0 80px rgba(0, 255, 136, 0.05);
    animation: alertPanelIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  @keyframes alertPanelIn { from { opacity: 0; transform: translate(-50%, -50%) scale(0.9) translateY(20px); } to { opacity: 1; transform: translate(-50%, -50%) scale(1) translateY(0); } }
  .alerts-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 20px 20px 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    background: linear-gradient(180deg, rgba(255,255,255,0.03) 0%, transparent 100%);
  }
  .alerts-title-row { display: flex; align-items: center; gap: 10px; }
  .alerts-bell {
    width: 36px; height: 36px; border-radius: 10px;
    background: rgba(0, 255, 136, 0.12); display: flex; align-items: center; justify-content: center;
    animation: bellSwing 2s ease-in-out infinite;
  }
  .alerts-bell svg { width: 18px; height: 18px; color: #00ff88; }
  @keyframes bellSwing { 0%,100% { transform: rotate(0); } 15% { transform: rotate(10deg); } 30% { transform: rotate(-8deg); } 45% { transform: rotate(5deg); } 60% { transform: rotate(0); } }
  .alerts-header h3 { font-size: 16px; font-weight: 600; color: #e4e4e7; }
  .alerts-count {
    min-width: 22px; height: 22px; padding: 0 6px;
    background: linear-gradient(135deg, #00ff88, #00cc6a); color: #0a0a0f;
    border-radius: 11px; font-size: 11px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
    animation: countPop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  @keyframes countPop { from { transform: scale(0); } to { transform: scale(1); } }
  .alerts-actions { display: flex; gap: 8px; align-items: center; }
  .alerts-clear-btn {
    display: flex; align-items: center; gap: 4px; padding: 6px 12px;
    background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px; color: #a1a1aa; font-size: 12px; font-family: 'Kanit';
    cursor: pointer; transition: all 0.2s;
  }
  .alerts-clear-btn:hover { background: rgba(255, 107, 107, 0.15); color: #ff6b6b; border-color: rgba(255, 107, 107, 0.3); }
  .alerts-clear-btn svg { width: 14px; height: 14px; }
  .alerts-close-btn {
    width: 32px; height: 32px; border-radius: 8px;
    background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08);
    color: #71717a; cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: all 0.2s;
  }
  .alerts-close-btn:hover { background: rgba(255,255,255,0.1); color: #e4e4e7; }
  .alerts-close-btn svg { width: 16px; height: 16px; }
  .alerts-list { flex: 1; overflow-y: auto; padding: 12px; }
  .alerts-list::-webkit-scrollbar { width: 4px; }
  .alerts-list::-webkit-scrollbar-track { background: transparent; }
  .alerts-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
  .empty-alerts {
    text-align: center; padding: 48px 24px; color: #3f3f46;
    display: flex; flex-direction: column; align-items: center; gap: 12px;
  }
  .empty-alerts svg { width: 48px; height: 48px; opacity: 0.3; }
  .empty-alerts span { font-size: 14px; }
  .alert-item {
    display: flex; gap: 12px; padding: 14px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.04);
    border-radius: 14px; margin-bottom: 8px; align-items: flex-start;
    transition: all 0.2s; cursor: default;
    animation: alertItemIn 0.35s calc(var(--delay, 0s)) cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }
  @keyframes alertItemIn { from { opacity: 0; transform: translateX(-12px) scale(0.95); } to { opacity: 1; transform: translateX(0) scale(1); } }
  .alert-item:hover { background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.08); }
  .alert-item.alert-emergency {
    background: rgba(255, 107, 107, 0.08); border: 1px solid rgba(255, 107, 107, 0.2);
    animation: alertItemIn 0.35s calc(var(--delay, 0s)) cubic-bezier(0.34, 1.56, 0.64, 1) both, emergencyPulse 2s ease-in-out infinite;
  }
  @keyframes emergencyPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(255, 107, 107, 0); } 50% { box-shadow: 0 0 16px rgba(255, 107, 107, 0.15); } }
  .alert-icon-wrap {
    width: 36px; height: 36px; flex-shrink: 0; border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    background: rgba(255,255,255,0.05);
  }
  .alert-icon-wrap svg { width: 18px; height: 18px; }
  .alert-icon-wrap.icon-delivery { background: rgba(59, 130, 246, 0.15); color: #3b82f6; }
  .alert-icon-wrap.icon-navigation { background: rgba(0, 255, 136, 0.15); color: #00ff88; }
  .alert-icon-wrap.icon-break { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
  .alert-icon-wrap.icon-emergency { background: rgba(255, 107, 107, 0.15); color: #ff6b6b; }
  .alert-content { flex: 1; min-width: 0; }
  .alert-message { font-size: 13px; color: #d4d4d8; line-height: 1.4; }
  .alert-time { font-size: 11px; color: #52525b; margin-top: 4px; }
  .alert-dismiss {
    width: 28px; height: 28px; flex-shrink: 0; border-radius: 8px;
    background: none; border: 1px solid transparent;
    color: #52525b; cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: all 0.2s;
  }
  .alert-dismiss:hover { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1); color: #a1a1aa; }
  .alert-dismiss svg { width: 14px; height: 14px; }
</style>
