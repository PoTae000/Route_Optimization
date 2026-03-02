<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import type { TripRecapData } from '$lib/types';

  export let data: TripRecapData;
  export let show = false;

  const dispatch = createEventDispatcher();

  let mapContainer: HTMLElement;
  let miniMap: any;
  let L: any;

  onMount(async () => {
    if (!show || !data) return;
    await initMap();
  });

  onDestroy(() => {
    if (miniMap) {
      try { miniMap.off(); miniMap.remove(); } catch (e) {}
      miniMap = null;
    }
  });

  $: if (show && data && mapContainer) {
    initMap();
  }

  async function initMap() {
    if (!mapContainer || !data?.coords?.length) return;
    if (miniMap) return; // already initialized

    try {
      L = (window as any).L;
      if (!L) return;

      miniMap = L.map(mapContainer, {
        zoomControl: false,
        dragging: false,
        scrollWheelZoom: false,
        touchZoom: false,
        doubleClickZoom: false,
        attributionControl: false
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(miniMap);

      if (data.coords.length > 1) {
        const polyline = L.polyline(data.coords, {
          color: '#00ff88',
          weight: 3,
          opacity: 0.8
        }).addTo(miniMap);

        // Start marker
        L.circleMarker(data.coords[0], {
          radius: 5, fillColor: '#4ade80', fillOpacity: 1, color: '#fff', weight: 2
        }).addTo(miniMap);

        // End marker
        L.circleMarker(data.coords[data.coords.length - 1], {
          radius: 5, fillColor: '#ef4444', fillOpacity: 1, color: '#fff', weight: 2
        }).addTo(miniMap);

        miniMap.fitBounds(polyline.getBounds(), { padding: [20, 20] });
      }
    } catch (e) {
      console.warn('TripRecap map error:', e);
    }
  }

  function formatDuration(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    if (hours > 0) return `${hours} ชม. ${minutes} นาที`;
    return `${minutes} นาที`;
  }

  function formatDistance(meters: number): string {
    if (meters >= 1000) return `${(meters / 1000).toFixed(1)} กม.`;
    return `${Math.round(meters)} ม.`;
  }

  async function shareRecap() {
    const text = [
      'สรุปทริป',
      `ระยะทาง: ${formatDistance(data.distance)}`,
      `เวลา: ${formatDuration(data.duration)}`,
      `ความเร็วเฉลี่ย: ${data.avgSpeed.toFixed(0)} กม./ชม.`,
      `ความเร็วสูงสุด: ${data.maxSpeed.toFixed(0)} กม./ชม.`,
      data.deliveriesSuccess > 0 ? `ส่งสำเร็จ: ${data.deliveriesSuccess} จุด` : '',
      data.aiSummary ? `\nAI สรุป: ${data.aiSummary}` : ''
    ].filter(Boolean).join('\n');

    if (navigator.share) {
      try {
        await navigator.share({ title: 'สรุปทริป', text });
        return;
      } catch (e) {}
    }

    try {
      await navigator.clipboard.writeText(text);
      dispatch('notification', { message: 'คัดลอกสรุปทริปแล้ว', type: 'success' });
    } catch (e) {
      dispatch('notification', { message: 'ไม่สามารถแชร์ได้', type: 'error' });
    }
  }

  function close() {
    if (miniMap) {
      try { miniMap.off(); miniMap.remove(); } catch (e) {}
      miniMap = null;
    }
    show = false;
    dispatch('close');
  }
</script>

{#if show && data}
  <div class="trip-recap-overlay" on:click|self={close}>
    <div class="trip-recap-card">
      <div class="trip-recap-header">
        <span class="trip-recap-title">สรุปทริป</span>
        <button class="trip-recap-close" on:click={close}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>

      <div class="trip-recap-map" bind:this={mapContainer}></div>

      <div class="trip-recap-stats">
        <div class="stat-item">
          <div class="stat-value">{formatDistance(data.distance)}</div>
          <div class="stat-label">ระยะทาง</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">{formatDuration(data.duration)}</div>
          <div class="stat-label">เวลา</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">{data.avgSpeed.toFixed(0)}</div>
          <div class="stat-label">เฉลี่ย กม./ชม.</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">{data.maxSpeed.toFixed(0)}</div>
          <div class="stat-label">สูงสุด กม./ชม.</div>
        </div>
        {#if data.stopsCount > 0}
          <div class="stat-item">
            <div class="stat-value">{data.stopsCount}</div>
            <div class="stat-label">จุดแวะ</div>
          </div>
        {/if}
        {#if data.deliveriesSuccess > 0}
          <div class="stat-item">
            <div class="stat-value">{data.deliveriesSuccess}</div>
            <div class="stat-label">ส่งสำเร็จ</div>
          </div>
        {/if}
      </div>

      {#if data.aiSummary}
        <div class="trip-recap-ai">
          <div class="trip-recap-ai-label">AI สรุป</div>
          <div class="trip-recap-ai-text">{data.aiSummary}</div>
        </div>
      {/if}

      <div class="trip-recap-actions">
        <button class="trip-recap-btn share-btn" on:click={shareRecap}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>
          แชร์
        </button>
        <button class="trip-recap-btn close-btn" on:click={close}>ปิด</button>
      </div>
    </div>
  </div>
{/if}

<style>
.trip-recap-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

.trip-recap-card {
  width: 340px;
  max-width: 90vw;
  max-height: 85vh;
  background: rgba(26, 26, 46, 0.97);
  border: 1px solid rgba(0, 255, 136, 0.2);
  border-radius: 16px;
  overflow-y: auto;
  box-shadow: 0 16px 50px rgba(0, 0, 0, 0.5);
  animation: slideUp 0.25s ease;
}

@keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

.trip-recap-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.trip-recap-title {
  font-size: 15px;
  font-weight: 700;
  color: #e4e4e7;
}

.trip-recap-close {
  background: none;
  border: none;
  color: #71717a;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  transition: all 0.2s;
}
.trip-recap-close:hover { color: #e4e4e7; background: rgba(255,255,255,0.08); }

.trip-recap-map {
  height: 160px;
  background: rgba(0, 0, 0, 0.3);
}

.trip-recap-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: rgba(255, 255, 255, 0.06);
  padding: 12px;
}

.stat-item {
  text-align: center;
  padding: 8px 4px;
}

.stat-value {
  font-size: 18px;
  font-weight: 700;
  color: #00ff88;
}

.stat-label {
  font-size: 11px;
  color: #71717a;
  margin-top: 2px;
}

.trip-recap-ai {
  padding: 12px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.trip-recap-ai-label {
  font-size: 11px;
  font-weight: 600;
  color: #4ade80;
  margin-bottom: 4px;
}

.trip-recap-ai-text {
  font-size: 13px;
  color: #d4d4d8;
  line-height: 1.5;
}

.trip-recap-actions {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.trip-recap-btn {
  flex: 1;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all 0.2s;
}

.share-btn {
  background: rgba(0, 255, 136, 0.15);
  border: 1px solid rgba(0, 255, 136, 0.3);
  color: #4ade80;
}
.share-btn:hover { background: rgba(0, 255, 136, 0.25); }

.close-btn {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #a1a1aa;
}
.close-btn:hover { background: rgba(255, 255, 255, 0.1); color: #e4e4e7; }
</style>
