<script>
  import { formatDistance, formatTime, formatETA } from '$lib/utils/geo';

  // Props
  export let isNavigating = false;
  export let isOffRoute = false;
  export let offRouteDistance = 0;
  export let autoRerouteEnabled = true;
  export let nextTurnIcon = '';
  export let nextTurnInstruction = '';
  export let nextTurnDistance = 0;
  export let currentTargetIndex = 0;
  export let optimizedRoute = null;
  export let distanceToNextPoint = 0;
  export let estimatedArrivalTime = null;
  export let curveWarning = null;
  export let laneGuidance = null;
  export let currentSpeed = 0;
  export let compassHeading = 0;
  export let compassDir = 'N';
  export let isMapFollowing = true;
  export let remainingDistance = 0;
  export let remainingTime = 0;
  export let isProcessingDelivery = false;
  export let voiceEnabled = true;
  export let successCount = 0;
  export let remainingPointsCount = 0;

  // Callback props (Svelte 5 compatible)
  export let onAutoReroute = () => {};
  export let onToggleMapFollow = () => {};
  export let onMarkDeliverySuccess = () => {};
  export let onSkipToNextPoint = () => {};
  export let onToggleVoice = () => {};
  export let onShareETA = () => {};
  export let onStopNavigation = () => {};
</script>

{#if isNavigating}
  <div class="nav-overlay">
    <!-- Turn-by-Turn Navigation Display -->
    <div class="turn-by-turn-panel glass-card" class:off-route={isOffRoute}>
      {#if isOffRoute}
        <div class="off-route-warning">
          <span class="off-route-icon">⚠️</span>
          <div class="off-route-text">
            <div class="off-route-title">ออกนอกเส้นทาง!</div>
            <div class="off-route-detail">ห่าง {Math.round(offRouteDistance)} ม. - {autoRerouteEnabled ? 'กำลังคำนวณใหม่...' : 'กดปุ่มเพื่อคำนวณใหม่'}</div>
          </div>
          {#if !autoRerouteEnabled}
            <button class="reroute-btn" on:click={onAutoReroute}>🔄 คำนวณใหม่</button>
          {/if}
        </div>
      {:else}
        <div class="turn-instruction">
          <div class="turn-icon-wrap">
            <span class="turn-icon">{nextTurnIcon}</span>
          </div>
          <div class="turn-info">
            <div class="turn-text">{nextTurnInstruction}</div>
            <div class="turn-distance">อีก {formatDistance(nextTurnDistance)}</div>
          </div>
        </div>
      {/if}
    </div>

    <div class="nav-top-bar glass-card">
      <div class="nav-target-info">
        <div class="nav-target-label">มุ่งหน้าไป</div>
        <div class="nav-target-name">
          {#if currentTargetIndex < optimizedRoute?.optimized_order?.length}
            {optimizedRoute.optimized_order[currentTargetIndex].name}
          {:else}
            ถึงจุดหมายแล้ว
          {/if}
        </div>
        <div class="nav-eta">{formatDistance(distanceToNextPoint)} · {formatETA(estimatedArrivalTime)}</div>
      </div>
    </div>

    <!-- Curve Warning -->
    {#if curveWarning?.active}
      <div class="curve-warning glass-card" class:sharp={curveWarning.severity === 'sharp'} class:hairpin={curveWarning.severity === 'hairpin'}>
        <div class="curve-icon">
          {#if curveWarning.direction === 'left'}↰{:else}↱{/if}
        </div>
        <div class="curve-info">
          <div class="curve-text">
            {curveWarning.severity === 'hairpin' ? '⚠️ โค้งหักศอก!' : curveWarning.severity === 'sharp' ? 'โค้งแรง' : 'ทางโค้ง'}
            {curveWarning.direction === 'left' ? 'ซ้าย' : 'ขวา'}
          </div>
          <div class="curve-distance">อีก {curveWarning.distance} ม.</div>
        </div>
      </div>
    {/if}

    <!-- Lane Guidance -->
    {#if laneGuidance?.show}
      <div class="lane-guidance glass-card">
        <div class="lane-visual">
          <div class="lane" class:active={laneGuidance.lane === 'left'}></div>
          <div class="lane" class:active={laneGuidance.lane === 'center'}></div>
          <div class="lane" class:active={laneGuidance.lane === 'right'}></div>
        </div>
        <div class="lane-text">{laneGuidance.instruction}</div>
      </div>
    {/if}

    <!-- Right side: Speed + Compass + Lock -->
    <div class="nav-right-cluster">
      <div class="speed-display glass-card">
        <div class="speed-value">{Math.round(currentSpeed)}</div>
        <div class="speed-unit">km/h</div>
      </div>
      <div class="compass-widget glass-card" title="เข็มทิศ">
        <div class="compass-ring" style="transform: rotate({-compassHeading}deg)">
          <div class="compass-n">N</div>
          <div class="compass-e">E</div>
          <div class="compass-s">S</div>
          <div class="compass-w">W</div>
          <svg class="compass-needle" viewBox="0 0 40 40" width="40" height="40">
            <polygon points="20,4 16,22 20,19 24,22" fill="#ff4444"/>
            <polygon points="20,36 16,22 20,25 24,22" fill="#a0a0a0"/>
          </svg>
        </div>
        <div class="compass-heading-text">{Math.round(compassHeading)}° {compassDir}</div>
      </div>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <button class="lock-btn glass-card" class:locked={isMapFollowing} on:click={onToggleMapFollow}>
        {#if isMapFollowing}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="12" cy="16" r="1" fill="currentColor"/></svg>
        {:else}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/><circle cx="12" cy="16" r="1" fill="currentColor"/></svg>
        {/if}
      </button>
    </div>

    <div class="nav-bottom-panel glass-card">
      <div class="nav-stats">
        <div class="nav-stat">
          <div class="nav-stat-content"><div class="nav-stat-value">{formatDistance(remainingDistance)}</div><div class="nav-stat-label">เหลือ</div></div>
        </div>
        <div class="nav-stat">
          <div class="nav-stat-content"><div class="nav-stat-value">{formatTime(remainingTime)}</div><div class="nav-stat-label">เวลา</div></div>
        </div>
        <div class="nav-stat">
          <div class="nav-stat-content"><div class="nav-stat-value">{formatETA(estimatedArrivalTime)}</div><div class="nav-stat-label">ถึงเวลา</div></div>
        </div>
        <div class="nav-stat">
          <div class="nav-stat-content"><div class="nav-stat-value">{successCount}/{successCount + remainingPointsCount}</div><div class="nav-stat-label">เป้าหมาย</div></div>
        </div>
      </div>

      <div class="nav-actions">
        <button class="nav-btn nav-btn-success" on:click={onMarkDeliverySuccess} disabled={isProcessingDelivery}>
          {#if isProcessingDelivery}<div class="spinner-small"></div>{:else}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>{/if}
          ถึงจุดหมาย
        </button>
        <button class="nav-btn nav-btn-skip" on:click={onSkipToNextPoint} disabled={isProcessingDelivery}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 5l7 7-7 7M5 5l7 7-7 7"/></svg>
          ข้าม
        </button>
        <button class="nav-btn nav-btn-voice" class:active={voiceEnabled} on:click={onToggleVoice}>
          {#if voiceEnabled}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/></svg>{:else}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6"/></svg>{/if}
        </button>
        <button class="nav-btn nav-btn-share" on:click={onShareETA} title="แชร์เวลาถึง">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        </button>
        <button class="nav-btn nav-btn-stop" on:click={onStopNavigation}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
          หยุด
        </button>
      </div>
    </div>

  </div>
{/if}

<style>
  .nav-overlay { position: absolute; inset: 0; pointer-events: none; z-index: 1000; }
  .nav-overlay > * { pointer-events: auto; }

  /* Turn-by-Turn Panel */
  .turn-by-turn-panel { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); width: 90%; max-width: 500px; padding: 12px 16px; z-index: 1050; }
  .turn-by-turn-panel.off-route { border-color: rgba(255, 107, 107, 0.4); background: rgba(255, 107, 107, 0.15); }
  .off-route-warning { display: flex; align-items: center; gap: 12px; }
  .off-route-icon { font-size: 28px; }
  .off-route-text { flex: 1; }
  .off-route-title { font-size: 14px; font-weight: 600; color: #ff6b6b; }
  .off-route-detail { font-size: 12px; color: #a1a1aa; }
  .reroute-btn { padding: 8px 16px; background: rgba(255, 107, 107, 0.2); border: 1px solid rgba(255, 107, 107, 0.4); border-radius: 8px; color: #ff6b6b; font-family: 'Kanit', sans-serif; cursor: pointer; }
  .turn-instruction { display: flex; align-items: center; gap: 12px; }
  .turn-icon-wrap { width: 44px; height: 44px; border-radius: 12px; background: rgba(0, 255, 136, 0.15); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .turn-icon { font-size: 24px; }
  .turn-info { flex: 1; }
  .turn-text { font-size: 15px; font-weight: 600; color: #e4e4e7; }
  .turn-distance { font-size: 13px; color: #71717a; }

  /* Nav Top Bar */
  .nav-top-bar { position: absolute; top: 80px; left: 50%; transform: translateX(-50%); width: 85%; max-width: 420px; padding: 10px 16px; z-index: 1040; }
  .nav-target-label { font-size: 10px; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px; }
  .nav-target-name { font-size: 14px; font-weight: 600; color: #e4e4e7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nav-eta { font-size: 12px; color: #00ff88; margin-top: 2px; }

  /* Curve Warning */
  .curve-warning { position: absolute; top: 150px; left: 20px; padding: 8px 14px; display: flex; align-items: center; gap: 10px; z-index: 1040; border-color: rgba(245, 158, 11, 0.3); }
  .curve-warning.sharp { border-color: rgba(255, 107, 107, 0.4); }
  .curve-warning.hairpin { border-color: rgba(255, 107, 107, 0.6); background: rgba(255, 107, 107, 0.15); }
  .curve-icon { font-size: 24px; color: #f59e0b; }
  .curve-warning.sharp .curve-icon, .curve-warning.hairpin .curve-icon { color: #ff6b6b; }
  .curve-text { font-size: 13px; font-weight: 600; color: #e4e4e7; }
  .curve-distance { font-size: 11px; color: #71717a; }

  /* Lane Guidance */
  .lane-guidance { position: absolute; top: 150px; right: 20px; padding: 8px 14px; z-index: 1040; }
  .lane-visual { display: flex; gap: 4px; margin-bottom: 4px; }
  .lane { width: 20px; height: 40px; border-radius: 4px; background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.15); }
  .lane.active { background: rgba(0, 255, 136, 0.3); border-color: #00ff88; }
  .lane-text { font-size: 11px; color: #a1a1aa; text-align: center; }

  /* Right Cluster */
  .nav-right-cluster { position: absolute; right: 20px; bottom: 260px; display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none; z-index: 1050; }
  .nav-right-cluster > * { pointer-events: auto; }
  .speed-display { width: 100px; height: 100px; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; position: relative; }
  .speed-value { font-size: 36px; font-weight: 700; color: #00ff88; font-family: 'JetBrains Mono', monospace; line-height: 1; }
  .speed-unit { font-size: 12px; color: #71717a; }

  /* Compass */
  .compass-widget { width: 72px; height: 72px; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; position: relative; overflow: hidden; }
  .compass-ring { position: absolute; inset: 0; transition: transform 0.3s ease-out; }
  .compass-n, .compass-e, .compass-s, .compass-w { position: absolute; font-size: 9px; font-weight: 700; color: #71717a; }
  .compass-n { top: 4px; left: 50%; transform: translateX(-50%); color: #ff4444; }
  .compass-e { right: 4px; top: 50%; transform: translateY(-50%); }
  .compass-s { bottom: 4px; left: 50%; transform: translateX(-50%); }
  .compass-w { left: 4px; top: 50%; transform: translateY(-50%); }
  .compass-needle { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); }
  .compass-heading-text { position: relative; z-index: 1; font-size: 10px; color: #a1a1aa; font-weight: 600; margin-top: 18px; }

  /* Lock Button */
  .lock-btn { width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; border: none; color: #71717a; background: rgba(12, 12, 20, 0.8); border: 1px solid rgba(255, 255, 255, 0.08); }
  .lock-btn svg { width: 20px; height: 20px; }
  .lock-btn.locked { color: #00ff88; border-color: rgba(0, 255, 136, 0.3); }

  /* Bottom Panel */
  .nav-bottom-panel { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); width: 95%; max-width: 600px; padding: 12px; z-index: 1050; }
  .nav-stats { display: flex; justify-content: space-around; margin-bottom: 12px; }
  .nav-stat { text-align: center; }
  .nav-stat-value { font-size: 16px; font-weight: 700; color: #e4e4e7; font-family: 'JetBrains Mono', monospace; }
  .nav-stat-label { font-size: 10px; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px; }

  /* Nav Actions */
  .nav-actions { display: flex; gap: 8px; justify-content: center; }
  .nav-btn { display: flex; align-items: center; gap: 6px; padding: 10px 16px; border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.1); background: rgba(255, 255, 255, 0.05); color: #e4e4e7; font-family: 'Kanit', sans-serif; font-size: 13px; cursor: pointer; transition: all 0.2s; }
  .nav-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .nav-btn svg { width: 18px; height: 18px; }
  .nav-btn-success { background: rgba(0, 255, 136, 0.15); border-color: rgba(0, 255, 136, 0.3); color: #00ff88; }
  .nav-btn-success:hover:not(:disabled) { background: rgba(0, 255, 136, 0.25); }
  .nav-btn-skip { background: rgba(245, 158, 11, 0.15); border-color: rgba(245, 158, 11, 0.3); color: #f59e0b; }
  .nav-btn-skip:hover:not(:disabled) { background: rgba(245, 158, 11, 0.25); }
  .nav-btn-voice { padding: 10px; }
  .nav-btn-voice.active { color: #00ff88; border-color: rgba(0, 255, 136, 0.3); }
  .nav-btn-share { padding: 10px; }
  .nav-btn-stop { background: rgba(255, 107, 107, 0.15); border-color: rgba(255, 107, 107, 0.3); color: #ff6b6b; }
  .nav-btn-stop:hover { background: rgba(255, 107, 107, 0.25); }

  .spinner-small { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.2); border-top-color: #00ff88; border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Glass Card base (scoped for nav overlay) */
  :global(.glass-card) {
    background: rgba(12, 12, 20, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
  }

  /* Mobile responsive */
  @media (max-width: 768px) {
    .turn-by-turn-panel { width: 95%; top: 6px; padding: 8px 12px; }
    .nav-top-bar { width: 90%; top: 68px; padding: 8px 12px; }
    .nav-right-cluster { right: 10px; bottom: 240px; }
    .speed-display { width: 72px; height: 72px; }
    .speed-value { font-size: 26px; }
    .compass-widget { width: 56px; height: 56px; }
    .lock-btn { width: 36px; height: 36px; }
    .nav-bottom-panel { width: 97%; bottom: 10px; padding: 10px; }
    .nav-stat-value { font-size: 14px; }
    .nav-btn { padding: 8px 12px; font-size: 12px; }
    .curve-warning { top: 130px; left: 10px; }
    .lane-guidance { top: 130px; right: 10px; }
  }

  @media (max-width: 480px) {
    .speed-display { width: 60px; height: 60px; }
    .speed-value { font-size: 22px; }
    .compass-widget { width: 48px; height: 48px; }
    .nav-actions { flex-wrap: wrap; }
    .nav-btn { padding: 7px 10px; font-size: 11px; }
  }
</style>
