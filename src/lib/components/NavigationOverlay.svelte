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

  // Callback props
  export let onAutoReroute = () => {};
  export let onToggleMapFollow = () => {};
  export let onMarkDeliverySuccess = () => {};
  export let onSkipToNextPoint = () => {};
  export let onToggleVoice = () => {};
  export let onShareETA = () => {};
  export let onStopNavigation = () => {};
</script>

{#if isNavigating}
  <div class="gmaps-nav-overlay">

    <!-- ===== TURN BAR (top, full-width green) ===== -->
    <div class="gmaps-turn-bar" class:gmaps-off-route={isOffRoute}>
      {#if isOffRoute}
        <div class="gmaps-turn-row">
          <span class="gmaps-turn-icon">⚠️</span>
          <div class="gmaps-turn-content">
            <div class="gmaps-turn-dist">ออกนอกเส้นทาง</div>
            <div class="gmaps-turn-text">ห่าง {Math.round(offRouteDistance)} ม. — {autoRerouteEnabled ? 'กำลังคำนวณใหม่...' : ''}</div>
          </div>
          {#if !autoRerouteEnabled}
            <button class="gmaps-reroute-btn" on:click={onAutoReroute}>🔄</button>
          {/if}
        </div>
      {:else}
        <div class="gmaps-turn-row">
          <span class="gmaps-turn-icon">{nextTurnIcon}</span>
          <div class="gmaps-turn-content">
            <div class="gmaps-turn-dist">อีก {formatDistance(nextTurnDistance)}</div>
            <div class="gmaps-turn-text">{nextTurnInstruction}</div>
          </div>
        </div>
      {/if}
    </div>

    <!-- ===== TARGET STRIP (below turn bar) ===== -->
    <div class="gmaps-target-strip">
      <div class="gmaps-target-left">
        <span class="gmaps-target-label">มุ่งหน้าไป</span>
        <span class="gmaps-target-name">
          {#if currentTargetIndex < optimizedRoute?.optimized_order?.length}
            {optimizedRoute.optimized_order[currentTargetIndex].name}
          {:else}
            ถึงจุดหมายแล้ว
          {/if}
        </span>
      </div>
      <div class="gmaps-target-right">
        <span class="gmaps-target-dist">{formatDistance(distanceToNextPoint)}</span>
        <span class="gmaps-target-eta">{formatETA(estimatedArrivalTime)}</span>
      </div>
    </div>

    <!-- ===== CURVE WARNING (below target strip) ===== -->
    {#if curveWarning?.active}
      <div class="gmaps-curve-warning" class:sharp={curveWarning.severity === 'sharp'} class:hairpin={curveWarning.severity === 'hairpin'}>
        <span class="gmaps-curve-icon">{curveWarning.direction === 'left' ? '↰' : '↱'}</span>
        <div class="gmaps-curve-info">
          <div class="gmaps-curve-text">
            {curveWarning.severity === 'hairpin' ? '⚠️ โค้งหักศอก!' : curveWarning.severity === 'sharp' ? 'โค้งแรง' : 'ทางโค้ง'}
            {curveWarning.direction === 'left' ? 'ซ้าย' : 'ขวา'}
          </div>
          <div class="gmaps-curve-dist">อีก {curveWarning.distance} ม.</div>
        </div>
      </div>
    {/if}

    <!-- ===== LANE GUIDANCE (below target strip, right side) ===== -->
    {#if laneGuidance?.show}
      <div class="gmaps-lane-guidance">
        <div class="gmaps-lane-visual">
          <div class="gmaps-lane" class:active={laneGuidance.lane === 'left'}></div>
          <div class="gmaps-lane" class:active={laneGuidance.lane === 'center'}></div>
          <div class="gmaps-lane" class:active={laneGuidance.lane === 'right'}></div>
        </div>
        <div class="gmaps-lane-text">{laneGuidance.instruction}</div>
      </div>
    {/if}

    <!-- ===== SPEED CIRCLE (bottom-left) ===== -->
    <div class="gmaps-speed-circle">
      <div class="gmaps-speed-value">{Math.round(currentSpeed)}</div>
      <div class="gmaps-speed-unit">km/h</div>
      <div class="gmaps-speed-dir">{compassDir}</div>
    </div>

    <!-- ===== RIGHT FABs (compass + recenter) ===== -->
    <div class="gmaps-right-fabs">
      <div class="gmaps-compass-fab" title="เข็มทิศ">
        <svg class="gmaps-compass-needle" viewBox="0 0 40 40" width="28" height="28" style="transform: rotate({-compassHeading}deg)">
          <polygon points="20,4 16,20 20,17 24,20" fill="#ff4444"/>
          <polygon points="20,36 16,20 20,23 24,20" fill="#666"/>
        </svg>
      </div>
      <button class="gmaps-recenter-fab" class:active={isMapFollowing} on:click={onToggleMapFollow} title="กลับตำแหน่ง">
        {#if isMapFollowing}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22">
            <circle cx="12" cy="12" r="3"/>
            <path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22">
            <circle cx="12" cy="12" r="3"/>
            <path d="M12 2v4m0 12v4M2 12h4m12 0h4" opacity="0.4"/>
          </svg>
        {/if}
      </button>
    </div>

    <!-- ===== DELIVERY ACTIONS ROW (above ETA bar) ===== -->
    <div class="gmaps-actions-row">
      <button class="gmaps-action-btn gmaps-action-arrive" on:click={onMarkDeliverySuccess} disabled={isProcessingDelivery}>
        {#if isProcessingDelivery}
          <div class="gmaps-spinner"></div>
        {:else}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>
        {/if}
        <span>ถึงจุดหมาย</span>
      </button>
      <button class="gmaps-action-btn gmaps-action-skip" on:click={onSkipToNextPoint} disabled={isProcessingDelivery}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 5l7 7-7 7M5 5l7 7-7 7"/></svg>
        <span>ข้าม</span>
      </button>
      <button class="gmaps-action-btn gmaps-action-icon" class:active={voiceEnabled} on:click={onToggleVoice} title="เสียง">
        {#if voiceEnabled}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/></svg>
        {:else}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M23 9l-6 6M17 9l6 6"/></svg>
        {/if}
      </button>
      <button class="gmaps-action-btn gmaps-action-icon" on:click={onShareETA} title="แชร์เวลาถึง">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
      </button>
    </div>

    <!-- ===== ETA BAR (bottom, full-width) ===== -->
    <div class="gmaps-eta-bar">
      <div class="gmaps-eta-left">
        <div class="gmaps-eta-time">{formatETA(estimatedArrivalTime)} ถึง</div>
        <div class="gmaps-eta-details">{formatTime(remainingTime)} · {formatDistance(remainingDistance)} · {successCount}/{successCount + remainingPointsCount}</div>
      </div>
      <button class="gmaps-stop-btn" on:click={onStopNavigation}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
        <span>หยุด</span>
      </button>
    </div>

  </div>
{/if}

<style>
  /* ===== OVERLAY CONTAINER ===== */
  .gmaps-nav-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 1000;
    font-family: 'Kanit', sans-serif;
  }
  .gmaps-nav-overlay > * { pointer-events: auto; }

  /* ===== TURN BAR ===== */
  .gmaps-turn-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    padding: calc(env(safe-area-inset-top, 0px) + 14px) 16px 14px;
    background: rgba(30, 120, 70, 0.92);
    z-index: 1060;
  }
  .gmaps-turn-bar.gmaps-off-route {
    background: rgba(180, 50, 50, 0.92);
  }
  .gmaps-turn-row {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .gmaps-turn-icon {
    font-size: 28px;
    flex-shrink: 0;
    width: 44px;
    text-align: center;
  }
  .gmaps-turn-content {
    flex: 1;
    min-width: 0;
  }
  .gmaps-turn-dist {
    font-size: 20px;
    font-weight: 700;
    color: #ffffff;
    font-family: 'JetBrains Mono', 'Kanit', monospace;
  }
  .gmaps-turn-text {
    font-size: 14px;
    color: rgba(255, 255, 255, 0.85);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .gmaps-reroute-btn {
    padding: 8px 14px;
    background: rgba(255, 255, 255, 0.15);
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 8px;
    color: #fff;
    font-size: 18px;
    cursor: pointer;
    flex-shrink: 0;
  }

  /* ===== TARGET STRIP ===== */
  .gmaps-target-strip {
    position: absolute;
    top: calc(env(safe-area-inset-top, 0px) + 74px);
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    background: rgba(12, 12, 20, 0.88);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    z-index: 1055;
  }
  .gmaps-target-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }
  .gmaps-target-label {
    font-size: 11px;
    color: #71717a;
    flex-shrink: 0;
  }
  .gmaps-target-name {
    font-size: 14px;
    font-weight: 600;
    color: #e4e4e7;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .gmaps-target-right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
    margin-left: 12px;
  }
  .gmaps-target-dist {
    font-size: 13px;
    font-weight: 600;
    color: #00ff88;
    font-family: 'JetBrains Mono', monospace;
  }
  .gmaps-target-eta {
    font-size: 13px;
    color: #a1a1aa;
  }

  /* ===== CURVE WARNING ===== */
  .gmaps-curve-warning {
    position: absolute;
    top: calc(env(safe-area-inset-top, 0px) + 112px);
    left: 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    background: rgba(12, 12, 20, 0.85);
    border: 1px solid rgba(245, 158, 11, 0.3);
    border-radius: 12px;
    z-index: 1050;
  }
  .gmaps-curve-warning.sharp { border-color: rgba(255, 107, 107, 0.4); }
  .gmaps-curve-warning.hairpin { border-color: rgba(255, 107, 107, 0.6); background: rgba(255, 60, 60, 0.15); }
  .gmaps-curve-icon { font-size: 22px; color: #f59e0b; }
  .gmaps-curve-warning.sharp .gmaps-curve-icon,
  .gmaps-curve-warning.hairpin .gmaps-curve-icon { color: #ff6b6b; }
  .gmaps-curve-text { font-size: 13px; font-weight: 600; color: #e4e4e7; }
  .gmaps-curve-dist { font-size: 11px; color: #71717a; }

  /* ===== LANE GUIDANCE ===== */
  .gmaps-lane-guidance {
    position: absolute;
    top: calc(env(safe-area-inset-top, 0px) + 112px);
    right: 12px;
    padding: 8px 14px;
    background: rgba(12, 12, 20, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    z-index: 1050;
  }
  .gmaps-lane-visual { display: flex; gap: 4px; margin-bottom: 4px; }
  .gmaps-lane { width: 20px; height: 36px; border-radius: 4px; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.12); }
  .gmaps-lane.active { background: rgba(0, 255, 136, 0.3); border-color: #00ff88; }
  .gmaps-lane-text { font-size: 11px; color: #a1a1aa; text-align: center; }

  /* ===== SPEED CIRCLE (bottom-left) ===== */
  .gmaps-speed-circle {
    position: absolute;
    bottom: 168px;
    left: 14px;
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: rgba(12, 12, 20, 0.92);
    border: 2px solid rgba(0, 255, 136, 0.25);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 1050;
  }
  .gmaps-speed-value {
    font-size: 24px;
    font-weight: 700;
    color: #00ff88;
    font-family: 'JetBrains Mono', monospace;
    line-height: 1;
  }
  .gmaps-speed-unit {
    font-size: 8px;
    color: #71717a;
    line-height: 1;
    margin-top: 1px;
  }
  .gmaps-speed-dir {
    font-size: 9px;
    color: #a1a1aa;
    font-weight: 600;
    line-height: 1;
  }

  /* ===== RIGHT FABs ===== */
  .gmaps-right-fabs {
    position: absolute;
    right: 14px;
    bottom: 168px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    z-index: 1050;
  }
  .gmaps-compass-fab {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: rgba(12, 12, 20, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .gmaps-compass-needle {
    transition: transform 0.3s ease-out;
  }
  .gmaps-recenter-fab {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: rgba(12, 12, 20, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: #71717a;
    transition: color 0.2s, border-color 0.2s, background 0.2s;
  }
  .gmaps-recenter-fab.active {
    color: #00ff88;
    border-color: rgba(0, 255, 136, 0.3);
    background: rgba(0, 255, 136, 0.08);
  }

  /* ===== DELIVERY ACTIONS ROW ===== */
  .gmaps-actions-row {
    position: absolute;
    bottom: 100px;
    left: 12px;
    right: 12px;
    display: flex;
    gap: 8px;
    justify-content: center;
    z-index: 1055;
  }
  .gmaps-action-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 16px;
    border-radius: 24px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(12, 12, 20, 0.85);
    color: #e4e4e7;
    font-family: 'Kanit', sans-serif;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s, transform 0.15s;
    white-space: nowrap;
  }
  .gmaps-action-btn:active { transform: scale(0.96); }
  .gmaps-action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .gmaps-action-btn svg { width: 18px; height: 18px; flex-shrink: 0; }

  .gmaps-action-arrive {
    background: rgba(0, 255, 136, 0.15);
    border-color: rgba(0, 255, 136, 0.3);
    color: #00ff88;
  }
  .gmaps-action-arrive:hover:not(:disabled) { background: rgba(0, 255, 136, 0.25); }

  .gmaps-action-skip {
    background: rgba(245, 158, 11, 0.15);
    border-color: rgba(245, 158, 11, 0.3);
    color: #f59e0b;
  }
  .gmaps-action-skip:hover:not(:disabled) { background: rgba(245, 158, 11, 0.25); }

  .gmaps-action-icon {
    padding: 10px;
    width: 42px;
    height: 42px;
    justify-content: center;
  }
  .gmaps-action-icon.active {
    color: #00ff88;
    border-color: rgba(0, 255, 136, 0.3);
  }

  /* ===== ETA BAR (bottom) ===== */
  .gmaps-eta-bar {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px calc(env(safe-area-inset-bottom, 0px) + 12px);
    background: rgba(12, 12, 20, 0.95);
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    z-index: 1060;
  }
  .gmaps-eta-left { flex: 1; min-width: 0; }
  .gmaps-eta-time {
    font-size: 18px;
    font-weight: 700;
    color: #00ff88;
    font-family: 'JetBrains Mono', 'Kanit', monospace;
  }
  .gmaps-eta-details {
    font-size: 12px;
    color: #a1a1aa;
    margin-top: 2px;
  }
  .gmaps-stop-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 20px;
    border-radius: 24px;
    background: rgba(255, 107, 107, 0.15);
    border: 1px solid rgba(255, 107, 107, 0.3);
    color: #ff6b6b;
    font-family: 'Kanit', sans-serif;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s;
    flex-shrink: 0;
  }
  .gmaps-stop-btn:hover { background: rgba(255, 107, 107, 0.25); }
  .gmaps-stop-btn svg { width: 18px; height: 18px; }

  /* ===== SPINNER ===== */
  .gmaps-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-top-color: #00ff88;
    border-radius: 50%;
    animation: gmaps-spin 0.8s linear infinite;
  }
  @keyframes gmaps-spin { to { transform: rotate(360deg); } }

  /* ===== RESPONSIVE: Tablet ===== */
  @media (max-width: 1024px) {
    .gmaps-turn-dist { font-size: 18px; }
    .gmaps-turn-text { font-size: 13px; }
    .gmaps-eta-time { font-size: 16px; }
  }

  /* ===== RESPONSIVE: Mobile ===== */
  @media (max-width: 768px) {
    .gmaps-turn-bar { padding: calc(env(safe-area-inset-top, 0px) + 10px) 12px 10px; }
    .gmaps-turn-icon { font-size: 24px; width: 36px; }
    .gmaps-turn-dist { font-size: 17px; }
    .gmaps-turn-text { font-size: 12px; }

    .gmaps-target-strip { top: calc(env(safe-area-inset-top, 0px) + 64px); padding: 6px 12px; }
    .gmaps-target-name { font-size: 12px; }
    .gmaps-target-dist { font-size: 12px; }
    .gmaps-target-eta { font-size: 11px; }

    .gmaps-speed-circle { width: 56px; height: 56px; bottom: 148px; left: 10px; }
    .gmaps-speed-value { font-size: 20px; }

    .gmaps-right-fabs { right: 10px; bottom: 148px; gap: 8px; }
    .gmaps-compass-fab, .gmaps-recenter-fab { width: 40px; height: 40px; }

    .gmaps-actions-row { bottom: 86px; left: 8px; right: 8px; gap: 6px; }
    .gmaps-action-btn { padding: 8px 12px; font-size: 11px; border-radius: 20px; }
    .gmaps-action-btn svg { width: 16px; height: 16px; }
    .gmaps-action-icon { width: 38px; height: 38px; padding: 8px; }

    .gmaps-eta-bar { padding: 10px 12px calc(env(safe-area-inset-bottom, 0px) + 10px); }
    .gmaps-eta-time { font-size: 16px; }
    .gmaps-eta-details { font-size: 11px; }
    .gmaps-stop-btn { padding: 8px 16px; font-size: 12px; }

    .gmaps-curve-warning { top: calc(env(safe-area-inset-top, 0px) + 98px); left: 8px; padding: 6px 10px; }
    .gmaps-lane-guidance { top: calc(env(safe-area-inset-top, 0px) + 98px); right: 8px; }
  }

  /* ===== RESPONSIVE: Small Mobile ===== */
  @media (max-width: 480px) {
    .gmaps-turn-bar { padding: calc(env(safe-area-inset-top, 0px) + 8px) 10px 8px; }
    .gmaps-turn-icon { font-size: 20px; width: 30px; }
    .gmaps-turn-dist { font-size: 15px; }
    .gmaps-turn-text { font-size: 11px; }

    .gmaps-target-strip { top: calc(env(safe-area-inset-top, 0px) + 56px); padding: 5px 10px; }
    .gmaps-target-label { font-size: 9px; }
    .gmaps-target-name { font-size: 11px; }

    .gmaps-speed-circle { width: 50px; height: 50px; bottom: 138px; left: 8px; }
    .gmaps-speed-value { font-size: 18px; }
    .gmaps-speed-unit { font-size: 7px; }
    .gmaps-speed-dir { font-size: 8px; }

    .gmaps-right-fabs { right: 8px; bottom: 138px; }
    .gmaps-compass-fab, .gmaps-recenter-fab { width: 36px; height: 36px; }
    .gmaps-compass-needle { width: 22px; height: 22px; }

    .gmaps-actions-row { bottom: 78px; gap: 4px; left: 6px; right: 6px; }
    .gmaps-action-btn { padding: 7px 10px; font-size: 10px; gap: 4px; }
    .gmaps-action-icon { width: 34px; height: 34px; padding: 7px; }
    .gmaps-action-btn svg { width: 14px; height: 14px; }

    .gmaps-eta-bar { padding: 8px 10px calc(env(safe-area-inset-bottom, 0px) + 8px); }
    .gmaps-eta-time { font-size: 14px; }
    .gmaps-eta-details { font-size: 10px; }
    .gmaps-stop-btn { padding: 7px 14px; font-size: 11px; }
  }

  /* ===== RESPONSIVE: Landscape ===== */
  @media (max-height: 500px) and (orientation: landscape) {
    .gmaps-speed-circle { bottom: 100px; width: 50px; height: 50px; }
    .gmaps-speed-value { font-size: 18px; }
    .gmaps-right-fabs { bottom: 100px; }
    .gmaps-actions-row { bottom: 56px; }
    .gmaps-eta-bar { padding: 8px 12px; }
    .gmaps-eta-time { font-size: 14px; }
    .gmaps-turn-bar { padding: 8px 12px; }
    .gmaps-turn-dist { font-size: 16px; }
    .gmaps-target-strip { top: 52px; }
  }
</style>
