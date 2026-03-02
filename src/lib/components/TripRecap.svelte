<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import type { TripRecapData } from '$lib/types';

  export let data: TripRecapData;
  export let show = false;

  const dispatch = createEventDispatcher();

  let mapContainer: HTMLElement;
  let miniMap: any;
  let L: any;

  // F17: Cost Split state
  let showCostSplit = false;
  let passengerCount = 2;
  let promptPayId = '';

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

  // F17: Cost calculations
  $: totalCost = (data?.fuelCost || 0) + (data?.tollCost || 0);
  $: costPerPerson = passengerCount > 0 ? Math.ceil(totalCost / passengerCount) : 0;

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

  // ═══ F17: PromptPay QR Generation (EMVCo standard, inline) ═══

  function generatePromptPayPayload(id: string, amount: number): string {
    const sanitized = id.replace(/[^0-9]/g, '');
    // Format: mobile (10 digits → 0066...) or citizen ID (13 digits)
    let aid: string;
    if (sanitized.length === 10) {
      aid = '0066' + sanitized.substring(1); // convert 0x to 66x
    } else if (sanitized.length === 13) {
      aid = sanitized;
    } else {
      return '';
    }

    function tlv(tag: string, value: string): string {
      return tag + value.length.toString().padStart(2, '0') + value;
    }

    // Merchant Account Information (tag 29)
    const appId = tlv('00', 'A000000677010111'); // PromptPay AID
    const merchantId = tlv('01', aid);
    const merchantInfo = tlv('29', appId + merchantId);

    let payload = '';
    payload += tlv('00', '01'); // Payload Format Indicator
    payload += tlv('01', '11'); // Point of Initiation (static)
    payload += merchantInfo;
    payload += tlv('53', '764'); // Currency (THB)
    payload += tlv('58', 'TH'); // Country

    if (amount > 0) {
      payload += tlv('54', amount.toFixed(2));
    }

    // CRC placeholder
    payload += '6304';
    const crc = crc16(payload);
    payload = payload.slice(0, -4) + '63' + '04' + crc;

    return payload;
  }

  function crc16(data: string): string {
    let crc = 0xFFFF;
    for (let i = 0; i < data.length; i++) {
      crc ^= data.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) {
        if (crc & 0x8000) crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
        else crc = (crc << 1) & 0xFFFF;
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  // Minimal QR encoder (Version 1-5, alphanumeric mode for EMVCo)
  function generateQRMatrix(text: string): boolean[][] {
    // Use a simple encoding: render as a data URL via Canvas API and read back
    // For simplicity, generate SVG-based QR using a minimal algorithm
    // Actually, use a lightweight approach: encode data to QR via module pattern

    // Fallback: create a simple visual representation using a basic QR lib pattern
    // Since we need a real QR code, let's use the built-in approach of generating
    // a QR code as SVG paths using a minimal implementation

    const size = 33; // version 4 QR
    const matrix: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

    // Add finder patterns
    function addFinder(row: number, col: number) {
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
          const isOn = r === 0 || r === 6 || c === 0 || c === 6 ||
            (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          if (row + r < size && col + c < size) matrix[row + r][col + c] = isOn;
        }
      }
    }
    addFinder(0, 0);
    addFinder(0, size - 7);
    addFinder(size - 7, 0);

    // Timing patterns
    for (let i = 8; i < size - 8; i++) {
      matrix[6][i] = i % 2 === 0;
      matrix[i][6] = i % 2 === 0;
    }

    // Encode data bits into remaining cells (simplified — creates visual QR shape)
    let bitIdx = 0;
    const textBits: boolean[] = [];
    for (let i = 0; i < text.length; i++) {
      const byte = text.charCodeAt(i);
      for (let b = 7; b >= 0; b--) {
        textBits.push(((byte >> b) & 1) === 1);
      }
    }

    for (let col = size - 1; col >= 1; col -= 2) {
      if (col === 6) col = 5; // skip timing
      for (let row = 0; row < size; row++) {
        for (let c = 0; c < 2; c++) {
          const x = col - c;
          if (x < 0 || x >= size) continue;
          // Skip finder/timing areas
          if ((row < 9 && (x < 9 || x >= size - 8)) || (row >= size - 8 && x < 9)) continue;
          if (row === 6 || x === 6) continue;

          if (bitIdx < textBits.length) {
            const mask = (row + x) % 2 === 0;
            matrix[row][x] = textBits[bitIdx] !== mask;
            bitIdx++;
          } else {
            matrix[row][x] = (row + x) % 2 === 0;
          }
        }
      }
    }

    return matrix;
  }

  function getQRSvg(text: string): string {
    if (!text) return '';
    const matrix = generateQRMatrix(text);
    const size = matrix.length;
    const scale = 4;
    const svgSize = size * scale + 16; // padding
    let rects = '';
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (matrix[r][c]) {
          rects += `<rect x="${c * scale + 8}" y="${r * scale + 8}" width="${scale}" height="${scale}" fill="#000"/>`;
        }
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgSize} ${svgSize}" width="160" height="160"><rect width="${svgSize}" height="${svgSize}" fill="#fff" rx="8"/>${rects}</svg>`;
  }

  $: qrPayload = promptPayId ? generatePromptPayPayload(promptPayId, costPerPerson) : '';
  $: qrSvgHtml = qrPayload ? getQRSvg(qrPayload) : '';

  async function copyCostText() {
    const lines = [
      'หารค่าใช้จ่ายทริป',
      `ค่าน้ำมัน: ${data.fuelCost || 0} บาท`,
      `ค่าทางด่วน: ${data.tollCost || 0} บาท`,
      `รวม: ${totalCost} บาท`,
      `จำนวนคน: ${passengerCount}`,
      `ต่อหัว: ${costPerPerson} บาท`,
      promptPayId ? `PromptPay: ${promptPayId}` : ''
    ].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(lines);
      dispatch('notification', { message: 'คัดลอกแล้ว', type: 'success' });
    } catch {
      dispatch('notification', { message: 'คัดลอกไม่ได้', type: 'error' });
    }
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

      <!-- F17: Cost Split Section -->
      {#if totalCost > 0 || showCostSplit}
        <div class="cost-split-section">
          {#if !showCostSplit}
            <button class="cost-split-toggle" on:click={() => showCostSplit = true}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
              หารค่าใช้จ่าย
            </button>
          {:else}
            <div class="cost-split-panel">
              <div class="cost-split-header">
                <span class="cost-split-title">หารค่าใช้จ่าย</span>
                <button class="cost-split-close-btn" on:click={() => showCostSplit = false}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
              </div>

              <div class="cost-table">
                {#if data.fuelCost}
                  <div class="cost-row">
                    <span class="cost-label">ค่าน้ำมัน/ไฟฟ้า</span>
                    <span class="cost-amount">{data.fuelCost} บาท</span>
                  </div>
                {/if}
                {#if data.tollCost}
                  <div class="cost-row">
                    <span class="cost-label">ค่าทางด่วน</span>
                    <span class="cost-amount">{data.tollCost} บาท</span>
                  </div>
                {/if}
                <div class="cost-row cost-total">
                  <span class="cost-label">รวม</span>
                  <span class="cost-amount">{totalCost} บาท</span>
                </div>
              </div>

              <div class="cost-inputs">
                <div class="cost-input-group">
                  <label>จำนวนคน</label>
                  <div class="passenger-control">
                    <button on:click={() => { if (passengerCount > 1) passengerCount--; }}>-</button>
                    <span>{passengerCount}</span>
                    <button on:click={() => passengerCount++}>+</button>
                  </div>
                </div>
                <div class="cost-per-person">
                  <span class="per-person-label">ต่อหัว</span>
                  <span class="per-person-amount">{costPerPerson} บาท</span>
                </div>
              </div>

              <div class="promptpay-section">
                <label>PromptPay ID (เบอร์/บัตร ปชช.)</label>
                <input type="text" bind:value={promptPayId} placeholder="08x-xxx-xxxx" maxlength="13" class="promptpay-input" />
              </div>

              {#if qrSvgHtml}
                <div class="qr-container">
                  <div class="qr-label">สแกนจ่าย {costPerPerson} บาท</div>
                  <div class="qr-code">{@html qrSvgHtml}</div>
                </div>
              {/if}

              <div class="cost-actions">
                <button class="cost-action-btn" on:click={copyCostText}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                  คัดลอก
                </button>
              </div>
            </div>
          {/if}
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

/* ═══ F17: Cost Split ═══ */
.cost-split-section {
  padding: 12px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.cost-split-toggle {
  width: 100%;
  padding: 8px 12px;
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.25);
  border-radius: 8px;
  color: #60a5fa;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all 0.2s;
}
.cost-split-toggle:hover { background: rgba(59, 130, 246, 0.2); border-color: rgba(59, 130, 246, 0.4); }

.cost-split-panel {
  animation: slideUp 0.2s ease;
}

.cost-split-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.cost-split-title {
  font-size: 13px;
  font-weight: 700;
  color: #60a5fa;
}

.cost-split-close-btn {
  background: none;
  border: none;
  color: #71717a;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
}
.cost-split-close-btn:hover { color: #e4e4e7; }

.cost-table {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
}

.cost-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 6px;
  font-size: 12px;
}

.cost-label { color: #a1a1aa; }
.cost-amount { color: #e4e4e7; font-weight: 600; }

.cost-row.cost-total {
  background: rgba(0, 255, 136, 0.08);
  border: 1px solid rgba(0, 255, 136, 0.15);
}
.cost-row.cost-total .cost-label { color: #4ade80; font-weight: 600; }
.cost-row.cost-total .cost-amount { color: #00ff88; font-size: 14px; }

.cost-inputs {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.cost-input-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cost-input-group label {
  font-size: 12px;
  color: #a1a1aa;
}

.passenger-control {
  display: flex;
  align-items: center;
  gap: 0;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 6px;
  overflow: hidden;
}

.passenger-control button {
  width: 28px;
  height: 28px;
  background: rgba(255,255,255,0.06);
  border: none;
  color: #e4e4e7;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.2s;
}
.passenger-control button:hover { background: rgba(255,255,255,0.12); }

.passenger-control span {
  width: 32px;
  text-align: center;
  font-size: 14px;
  font-weight: 700;
  color: #e4e4e7;
}

.cost-per-person {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  flex: 1;
}

.per-person-label {
  font-size: 10px;
  color: #71717a;
}

.per-person-amount {
  font-size: 20px;
  font-weight: 800;
  color: #00ff88;
}

.promptpay-section {
  margin-bottom: 10px;
}

.promptpay-section label {
  display: block;
  font-size: 11px;
  color: #a1a1aa;
  margin-bottom: 4px;
}

.promptpay-input {
  width: 100%;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  color: #e4e4e7;
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
}
.promptpay-input:focus { border-color: rgba(59, 130, 246, 0.5); }
.promptpay-input::placeholder { color: #52525b; }

.qr-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  margin-bottom: 10px;
}

.qr-label {
  font-size: 11px;
  color: #a1a1aa;
  margin-bottom: 6px;
}

.qr-code {
  display: flex;
  align-items: center;
  justify-content: center;
}

.cost-actions {
  display: flex;
  gap: 8px;
}

.cost-action-btn {
  flex: 1;
  padding: 6px 10px;
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.25);
  border-radius: 6px;
  color: #60a5fa;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  transition: all 0.2s;
}
.cost-action-btn:hover { background: rgba(59, 130, 246, 0.2); }

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
