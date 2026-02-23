<script>
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();

  // Props
  export let show = false;
  export let userInfo = { name: '', avatar: '', role: '' };
  export let vehicleType = 'fuel';
  export let voiceEnabled = false;
  export let nightMode = true;
  export let KM_PER_LITER = 12;
  export let ELECTRICITY_PRICE_PER_KWH = 4.2;
  export let KWH_PER_100KM = 15;
  export let evCurrentCharge = 80;
  export let evRemainingRange = 0;
  export let evCurrentConsumptionRate = 0;
  export let currentFuelPrice = 36;
  export let oilPriceData = null;
  export let isLoadingOilPrice = false;
  export let selectedStation = 'ptt';
  export let selectedFuelType = 'gasohol_95';
  export let showChargingStations = false;
  export let isLoadingStations = false;
  export let chargingStations = [];
  export let optimizedRoute = null;
  export let getUserKey = (key) => key;

  // Local state
  let activeTab = 'vehicle';

  // Local data
  const stationOptions = [
    { value: 'ptt', label: 'ปตท.' },
    { value: 'bcp', label: 'บางจาก' },
    { value: 'shell', label: 'Shell' },
    { value: 'esso', label: 'Esso' },
    { value: 'caltex', label: 'Caltex' },
    { value: 'pt', label: 'PT' },
    { value: 'susco', label: 'Susco' },
    { value: 'pure', label: 'Pure' }
  ];

  const fuelTypeOptions = [
    { value: 'gasohol_95', label: 'แก๊สโซฮอล์ 95' },
    { value: 'gasohol_91', label: 'แก๊สโซฮอล์ 91' },
    { value: 'gasohol_e20', label: 'แก๊สโซฮอล์ E20' },
    { value: 'gasohol_e85', label: 'แก๊สโซฮอล์ E85' },
    { value: 'diesel_b7', label: 'ดีเซล B7' },
    { value: 'diesel', label: 'ดีเซล' },
    { value: 'premium_diesel', label: 'ดีเซลพรีเมียม' },
    { value: 'gasoline_95', label: 'เบนซิน 95' }
  ];

  function getEVBatteryColor() {
    if (evCurrentCharge > 50) return '#00ff88';
    if (evCurrentCharge > 20) return '#ffa502';
    return '#ff6b6b';
  }

  function getAvailableFuelTypes() {
    if (!oilPriceData?.stations || !oilPriceData.stations[selectedStation]) {
      return fuelTypeOptions.map(f => ({ ...f, price: '-' }));
    }
    const station = oilPriceData.stations[selectedStation];
    return fuelTypeOptions
      .filter(f => station[f.value])
      .map(f => ({ ...f, price: station[f.value]?.price || '-' }));
  }

  function getAllStationPrices() {
    if (!oilPriceData?.stations) return [];
    return stationOptions
      .filter(s => oilPriceData.stations[s.value]?.[selectedFuelType])
      .map(s => ({ station: s.value, label: s.label, price: oilPriceData.stations[s.value][selectedFuelType].price }))
      .sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
  }

  function getSelectedFuelName() {
    const fuel = fuelTypeOptions.find(f => f.value === selectedFuelType);
    return fuel?.label || 'แก๊สโซฮอล์ 95';
  }

  function saveVehicleSettings() { dispatch('saveVehicleSettings'); }
  function toggleVoice() { dispatch('toggleVoice'); }
  function fetchOilPrices() { dispatch('fetchOilPrices'); }
  function updateCurrentFuelPrice() { dispatch('updateFuelPrice'); }
  function toggleChargingStations() { dispatch('toggleChargingStations'); }
  function loadNearbyChargingStations() { dispatch('loadNearbyChargingStations'); }
  function searchEVAlongRoute() { dispatch('searchEVAlongRoute'); }
  function searchGasAlongRoute() { dispatch('searchGasAlongRoute'); }
  function clearChargingStations() { dispatch('clearChargingStations'); }
  function exportRouteData() { dispatch('exportRouteData'); }
  function openLogoutConfirm() { show = false; dispatch('logout'); }
</script>

{#if show}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="settings-overlay" on:click={() => show = false}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_interactive_supports_focus -->
    <div class="settings-modal" on:click|stopPropagation role="dialog">
      <!-- Header -->
      <div class="modal-header">
        <div class="header-left">
          <div class="avatar">{userInfo.avatar}</div>
          <div class="header-info">
            <span class="header-name">{userInfo.name}</span>
            <span class="header-role">ตั้งค่าระบบ</span>
          </div>
        </div>
        <button class="close-btn" on:click={() => show = false}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>

      <!-- Tab Navigation -->
      <div class="tab-nav">
        <button class="tab-btn" class:active={activeTab === 'vehicle'} on:click={() => activeTab = 'vehicle'}>
          {vehicleType === 'fuel' ? '🚗' : '⚡'} ยานพาหนะ
        </button>
        <button class="tab-btn" class:active={activeTab === 'fuel'} on:click={() => activeTab = 'fuel'}>
          {vehicleType === 'fuel' ? '⛽' : '🔋'} {vehicleType === 'fuel' ? 'เชื้อเพลิง' : 'การชาร์จ'}
        </button>
        <button class="tab-btn" class:active={activeTab === 'preferences'} on:click={() => activeTab = 'preferences'}>
          ⚙️ ทั่วไป
        </button>
      </div>

      <!-- Tab Content -->
      <div class="modal-body">
        {#if activeTab === 'vehicle'}
          <!-- Vehicle Type Selection -->
          <div class="section">
            <div class="section-title">ประเภทยานพาหนะ</div>
            <div class="vtype-switch">
              <button class="vtype-btn" class:active={vehicleType === 'fuel'} on:click={() => { vehicleType = 'fuel'; saveVehicleSettings(); }}>
                <span class="vtype-icon">🚗</span>
                <span>น้ำมัน</span>
              </button>
              <button class="vtype-btn" class:active={vehicleType === 'ev'} on:click={() => { vehicleType = 'ev'; saveVehicleSettings(); }}>
                <span class="vtype-icon">⚡</span>
                <span>EV</span>
              </button>
            </div>
          </div>

          <!-- Vehicle Config -->
          {#if vehicleType === 'fuel'}
            <div class="section">
              <div class="section-title">อัตราสิ้นเปลือง</div>
              <div class="slider-card">
                <div class="slider-header">
                  <span class="slider-label">⛽ กม./ลิตร</span>
                  <span class="slider-value fuel">{KM_PER_LITER}</span>
                </div>
                <input type="range" min="5" max="30" step="0.5" bind:value={KM_PER_LITER} on:change={saveVehicleSettings} class="range fuel-range" />
                <div class="range-hint"><span>5</span><span>30</span></div>
              </div>
            </div>
          {:else}
            <div class="section">
              <div class="section-title">สถานะแบตเตอรี่</div>
              <div class="ev-stats-row">
                <div class="ev-stat">
                  <span class="ev-stat-val" style="color: {getEVBatteryColor()}">{evCurrentCharge}%</span>
                  <span class="ev-stat-label">แบตเตอรี่</span>
                </div>
                <div class="ev-stat">
                  <span class="ev-stat-val" style="color: {getEVBatteryColor()}">{evRemainingRange.toFixed(0)}</span>
                  <span class="ev-stat-label">กม. เหลือ</span>
                </div>
                <div class="ev-stat">
                  <span class="ev-stat-val" style="color: {evCurrentConsumptionRate > KWH_PER_100KM * 1.3 ? '#ff6b6b' : evCurrentConsumptionRate < KWH_PER_100KM * 0.9 ? '#00ff88' : '#60a5fa'}">{evCurrentConsumptionRate.toFixed(1)}</span>
                  <span class="ev-stat-label">kWh/100กม.</span>
                </div>
              </div>
            </div>
            <div class="section">
              <div class="section-title">ตั้งค่า EV</div>
              <div class="ev-sliders">
                <div class="slider-card">
                  <div class="slider-header">
                    <span class="slider-label">🔌 ค่าไฟฟ้า</span>
                    <span class="slider-value ev">{ELECTRICITY_PRICE_PER_KWH} <small>฿/kWh</small></span>
                  </div>
                  <input type="range" min="1" max="10" step="0.1" bind:value={ELECTRICITY_PRICE_PER_KWH} on:change={saveVehicleSettings} class="range ev-range" />
                </div>
                <div class="slider-card">
                  <div class="slider-header">
                    <span class="slider-label">🔋 แบตเตอรี่</span>
                    <span class="slider-value ev">{evCurrentCharge}<small>%</small></span>
                  </div>
                  <input type="range" min="0" max="100" bind:value={evCurrentCharge} on:change={saveVehicleSettings} class="range battery-range" style="--battery-color: {getEVBatteryColor()}" />
                </div>
                <div class="slider-card full">
                  <div class="slider-header">
                    <span class="slider-label">📊 กินไฟ @60km/h</span>
                    <span class="slider-value ev">{KWH_PER_100KM} <small>kWh/100กม.</small></span>
                  </div>
                  <input type="range" min="8" max="30" step="0.5" bind:value={KWH_PER_100KM} on:change={saveVehicleSettings} class="range ev-range" />
                </div>
              </div>
            </div>
          {/if}

        {:else if activeTab === 'fuel'}
          {#if vehicleType === 'fuel'}
            <!-- Fuel Prices -->
            <div class="section">
              <div class="section-title-row">
                <span>ราคาน้ำมันวันนี้</span>
                <button class="icon-btn" on:click={fetchOilPrices} disabled={isLoadingOilPrice}>
                  {#if isLoadingOilPrice}<div class="spinner-sm"></div>{:else}🔄{/if}
                </button>
              </div>
              {#if oilPriceData}<div class="date-badge">📅 {oilPriceData.date}</div>{/if}
              <div class="fuel-selects">
                <div class="select-wrap">
                  <label>สถานี</label>
                  <select bind:value={selectedStation} on:change={updateCurrentFuelPrice}>
                    {#each stationOptions as station}<option value={station.value}>{station.label}</option>{/each}
                  </select>
                </div>
                <div class="select-wrap">
                  <label>ชนิดเชื้อเพลิง</label>
                  <select bind:value={selectedFuelType} on:change={updateCurrentFuelPrice}>
                    {#each getAvailableFuelTypes() as fuel}<option value={fuel.value}>{fuel.label} - ฿{fuel.price}</option>{/each}
                  </select>
                </div>
              </div>
              <div class="price-display">
                <span>ราคาที่ใช้</span>
                <span class="price-val">฿{currentFuelPrice.toFixed(2)}<small>/ลิตร</small></span>
              </div>
              {#if getAllStationPrices().length > 1}
                <div class="price-compare">
                  <div class="compare-title">เปรียบเทียบราคา {getSelectedFuelName()}</div>
                  {#each getAllStationPrices().slice(0, 5) as priceInfo, i}
                    <div class="compare-row" class:cheapest={i === 0} class:selected={priceInfo.station === selectedStation}>
                      <span class="compare-name">{priceInfo.label}</span>
                      <span class="compare-price">฿{priceInfo.price}{#if i === 0} <small>ถูกสุด</small>{/if}</span>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}

          <!-- Charging Stations / Gas Stations -->
          <div class="section">
            <div class="section-title-row">
              <span>{vehicleType === 'fuel' ? '⛽ ปั๊มน้ำมัน' : '⚡ สถานีชาร์จ EV'}</span>
              <button class="toggle-switch" class:active={showChargingStations} on:click={toggleChargingStations}>
                <div class="toggle-dot"></div>
              </button>
            </div>
            <div class="ev-actions">
              {#if vehicleType === 'fuel'}
                <button class="action-btn ev" on:click={searchGasAlongRoute} disabled={isLoadingStations || !optimizedRoute}>
                  {#if isLoadingStations}<div class="spinner-sm"></div>{:else}🔍{/if} ค้นหาปั๊มบนเส้นทาง
                </button>
              {:else}
                <button class="action-btn ev" on:click={loadNearbyChargingStations} disabled={isLoadingStations}>
                  {#if isLoadingStations}<div class="spinner-sm"></div>{:else}🔍{/if} ค้นหาใกล้เคียง 100กม.
                </button>
                <button class="action-btn ev" on:click={searchEVAlongRoute} disabled={isLoadingStations || !optimizedRoute}>
                  🛣️ ค้นหาตามเส้นทาง
                </button>
              {/if}
              {#if chargingStations.length > 0}
                <button class="action-btn danger" on:click={clearChargingStations}>
                  🗑️ ล้าง{vehicleType === 'fuel' ? 'ปั๊ม' : 'สถานี'} ({chargingStations.length})
                </button>
              {/if}
            </div>
          </div>

        {:else if activeTab === 'preferences'}
          <!-- General Settings -->
          <div class="section">
            <div class="section-title">การแสดงผล</div>
            <div class="pref-list">
              <div class="pref-item">
                <div class="pref-info">
                  <span class="pref-icon">{nightMode ? '🌙' : '☀️'}</span>
                  <div>
                    <span class="pref-name">โหมดกลางคืน</span>
                    <span class="pref-desc">ปรับสีแผนที่และ UI</span>
                  </div>
                </div>
                <button class="toggle-switch" class:active={nightMode} on:click={() => { nightMode = !nightMode; try { localStorage.setItem(getUserKey('nightMode'), nightMode ? 'dark' : 'light'); } catch(e) {} }}>
                  <div class="toggle-dot"></div>
                </button>
              </div>
              <div class="pref-item">
                <div class="pref-info">
                  <span class="pref-icon">🔊</span>
                  <div>
                    <span class="pref-name">เสียงนำทาง</span>
                    <span class="pref-desc">แจ้งเตือนด้วยเสียง</span>
                  </div>
                </div>
                <button class="toggle-switch" class:active={voiceEnabled} on:click={toggleVoice}>
                  <div class="toggle-dot"></div>
                </button>
              </div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">ข้อมูล</div>
            <div class="pref-list">
              <button class="pref-item clickable" on:click={exportRouteData}>
                <div class="pref-info">
                  <span class="pref-icon">📤</span>
                  <div>
                    <span class="pref-name">ส่งออกข้อมูลเส้นทาง</span>
                    <span class="pref-desc">Export เป็นไฟล์ JSON</span>
                  </div>
                </div>
                <span class="pref-arrow">›</span>
              </button>
            </div>
          </div>

          <div class="section danger-zone">
            <button class="logout-btn" on:click={openLogoutConfirm}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>
              ออกจากระบบ
            </button>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  /* Overlay */
  .settings-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.6);
    z-index: 2000; display: flex; align-items: center; justify-content: center;
    animation: fadeIn 0.2s ease;
  }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

  /* Modal */
  .settings-modal {
    width: 480px; max-width: calc(100% - 40px);
    max-height: calc(100vh - 80px);
    background: rgba(18, 18, 28, 0.97);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 16px;
    display: flex; flex-direction: column;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05);
    animation: modalIn 0.25s cubic-bezier(0.22, 1, 0.36, 1);
  }
  @keyframes modalIn {
    from { opacity: 0; transform: scale(0.95) translateY(10px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }

  /* Header */
  .modal-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.06);
    flex-shrink: 0;
  }
  .header-left { display: flex; gap: 12px; align-items: center; }
  .avatar {
    width: 40px; height: 40px; border-radius: 12px;
    background: linear-gradient(135deg, #667eea, #764ba2);
    display: flex; align-items: center; justify-content: center; font-size: 20px;
  }
  .header-info { display: flex; flex-direction: column; }
  .header-name { font-size: 15px; font-weight: 600; color: #e4e4e7; }
  .header-role { font-size: 11px; color: #71717a; }
  .close-btn {
    width: 32px; height: 32px; border-radius: 8px;
    background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08);
    color: #71717a; display: flex; align-items: center; justify-content: center;
    cursor: pointer; transition: background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s, transform 0.15s;
  }
  .close-btn:hover { background: rgba(255,107,107,0.15); color: #ff6b6b; border-color: rgba(255,107,107,0.2); }
  .close-btn svg { width: 16px; height: 16px; }

  /* Tab Navigation */
  .tab-nav {
    display: flex; gap: 2px; padding: 8px 16px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    flex-shrink: 0;
  }
  .tab-btn {
    flex: 1; padding: 8px 4px; border: none; border-radius: 8px;
    background: transparent; color: #52525b; font-size: 12px; font-weight: 500;
    font-family: 'Kanit', sans-serif; cursor: pointer; transition: background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s, transform 0.15s;
  }
  .tab-btn:hover { color: #a1a1aa; background: rgba(255,255,255,0.03); }
  .tab-btn.active { color: #e4e4e7; background: rgba(255,255,255,0.08); }

  /* Body */
  .modal-body {
    padding: 16px 20px; overflow-y: auto; flex: 1;
    display: flex; flex-direction: column; gap: 16px;
  }
  .modal-body::-webkit-scrollbar { width: 4px; }
  .modal-body::-webkit-scrollbar-track { background: transparent; }
  .modal-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }

  /* Section */
  .section { display: flex; flex-direction: column; gap: 10px; }
  .section-title { font-size: 11px; font-weight: 600; color: #52525b; text-transform: uppercase; letter-spacing: 0.5px; }
  .section-title-row {
    display: flex; justify-content: space-between; align-items: center;
    font-size: 13px; font-weight: 600; color: #a1a1aa;
  }

  /* Vehicle Type Switch */
  .vtype-switch { display: flex; gap: 8px; }
  .vtype-btn {
    flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px;
    padding: 12px; border-radius: 10px;
    background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
    color: #71717a; font-size: 13px; font-weight: 500;
    font-family: 'Kanit', sans-serif; cursor: pointer; transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s, transform 0.2s;
  }
  .vtype-btn:hover { background: rgba(255,255,255,0.06); }
  .vtype-btn.active {
    background: rgba(0,255,136,0.08); border-color: rgba(0,255,136,0.25); color: #00ff88;
  }
  .vtype-icon { font-size: 18px; }

  /* Slider Card */
  .slider-card {
    background: rgba(0,0,0,0.2); border-radius: 10px; padding: 12px;
    border: 1px solid rgba(255,255,255,0.04);
  }
  .slider-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .slider-label { font-size: 12px; color: #a1a1aa; }
  .slider-value { font-size: 16px; font-weight: 700; font-family: 'JetBrains Mono', monospace; color: #e4e4e7; }
  .slider-value small { font-size: 10px; color: #71717a; font-weight: 400; }
  .slider-value.fuel { color: #ffa502; }
  .slider-value.ev { color: #00ff88; }
  .range {
    width: 100%; height: 6px; border-radius: 3px;
    background: rgba(255,255,255,0.08); outline: none;
    -webkit-appearance: none; appearance: none; margin: 4px 0;
  }
  .range::-webkit-slider-thumb {
    -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%;
    background: #e4e4e7; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }
  .range::-moz-range-thumb {
    width: 18px; height: 18px; border-radius: 50%;
    background: #e4e4e7; cursor: pointer; border: none;
  }
  .fuel-range::-webkit-slider-thumb { background: #ffa502; }
  .fuel-range::-moz-range-thumb { background: #ffa502; }
  .ev-range::-webkit-slider-thumb { background: #00ff88; }
  .ev-range::-moz-range-thumb { background: #00ff88; }
  .battery-range::-webkit-slider-thumb { background: var(--battery-color, #00ff88); }
  .battery-range::-moz-range-thumb { background: var(--battery-color, #00ff88); }
  .range-hint { display: flex; justify-content: space-between; font-size: 9px; color: #3f3f46; margin-top: 2px; }

  /* EV Stats */
  .ev-stats-row { display: flex; gap: 8px; }
  .ev-stat {
    flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px;
    padding: 12px 8px; background: rgba(0,0,0,0.25); border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.04);
  }
  .ev-stat-val { font-size: 20px; font-weight: 700; font-family: 'JetBrains Mono', monospace; line-height: 1; }
  .ev-stat-label { font-size: 10px; color: #52525b; }

  /* EV Sliders Grid */
  .ev-sliders { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .ev-sliders .slider-card.full { grid-column: 1 / -1; }
  .ev-sliders .slider-value { font-size: 13px; }

  /* Fuel Selects */
  .fuel-selects { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .select-wrap { display: flex; flex-direction: column; gap: 4px; }
  .select-wrap label { font-size: 10px; color: #52525b; }
  .select-wrap select {
    width: 100%; padding: 8px 10px; background: rgba(0,0,0,0.3);
    border: 1px solid rgba(255,255,255,0.08); border-radius: 8px;
    color: #e4e4e7; font-size: 12px; cursor: pointer;
  }
  .select-wrap select:focus { outline: none; border-color: rgba(0,255,136,0.3); }
  .date-badge { font-size: 10px; color: #52525b; }

  /* Price Display */
  .price-display {
    display: flex; justify-content: space-between; align-items: center;
    padding: 10px 14px; border-radius: 10px;
    background: rgba(0,255,136,0.06); border: 1px solid rgba(0,255,136,0.15);
    font-size: 12px; color: #a1a1aa;
  }
  .price-val { font-size: 18px; font-weight: 700; color: #00ff88; font-family: 'JetBrains Mono', monospace; }
  .price-val small { font-size: 11px; color: #71717a; font-weight: 400; }

  /* Price Compare */
  .price-compare { display: flex; flex-direction: column; gap: 4px; }
  .compare-title { font-size: 10px; color: #52525b; margin-bottom: 2px; }
  .compare-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 6px 10px; background: rgba(255,255,255,0.02); border-radius: 6px;
    font-size: 11px; color: #a1a1aa; border: 1px solid transparent;
  }
  .compare-row.cheapest { background: rgba(0,255,136,0.06); border-color: rgba(0,255,136,0.15); }
  .compare-row.selected { background: rgba(102,126,234,0.08); border-color: rgba(102,126,234,0.15); }
  .compare-price { font-weight: 600; color: #e4e4e7; font-family: 'JetBrains Mono', monospace; }
  .compare-price small { color: #00ff88; font-size: 9px; margin-left: 4px; }

  /* EV Action Buttons */
  .ev-actions { display: flex; flex-direction: column; gap: 6px; }
  .action-btn {
    padding: 10px 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06);
    background: rgba(255,255,255,0.03); color: #a1a1aa; font-size: 12px;
    font-family: 'Kanit', sans-serif; cursor: pointer; transition: background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s, transform 0.15s;
    text-align: left;
  }
  .action-btn:hover:not(:disabled) { background: rgba(255,255,255,0.06); }
  .action-btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .action-btn.ev { border-color: rgba(0,255,136,0.12); color: #00ff88; }
  .action-btn.ev:hover:not(:disabled) { background: rgba(0,255,136,0.08); }
  .action-btn.danger { border-color: rgba(255,107,107,0.15); color: #ff6b6b; }
  .action-btn.danger:hover:not(:disabled) { background: rgba(255,107,107,0.08); }

  /* Toggle Switch */
  .toggle-switch {
    width: 40px; height: 22px; border-radius: 11px; border: none;
    background: rgba(255,255,255,0.1); cursor: pointer;
    position: relative; transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s, transform 0.2s; flex-shrink: 0;
  }
  .toggle-switch.active { background: rgba(0,255,136,0.3); }
  .toggle-dot {
    width: 16px; height: 16px; border-radius: 50%; background: #71717a;
    position: absolute; top: 3px; left: 3px; transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s, transform 0.2s;
  }
  .toggle-switch.active .toggle-dot { background: #00ff88; left: 21px; }

  /* Preferences List */
  .pref-list { display: flex; flex-direction: column; gap: 2px; }
  .pref-item {
    display: flex; justify-content: space-between; align-items: center;
    padding: 10px 12px; border-radius: 10px;
    background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04);
    transition: background 0.15s;
  }
  .pref-item.clickable { cursor: pointer; border: none; }
  .pref-item.clickable:hover { background: rgba(255,255,255,0.05); }
  .pref-info { display: flex; gap: 10px; align-items: center; }
  .pref-icon { font-size: 18px; width: 28px; text-align: center; }
  .pref-name { font-size: 13px; color: #e4e4e7; display: block; }
  .pref-desc { font-size: 10px; color: #52525b; display: block; }
  .pref-arrow { font-size: 18px; color: #3f3f46; font-weight: 300; }

  /* Icon Button */
  .icon-btn {
    width: 30px; height: 30px; border-radius: 8px;
    background: rgba(0,255,136,0.08); border: 1px solid rgba(0,255,136,0.15);
    color: #00ff88; display: flex; align-items: center; justify-content: center;
    cursor: pointer; font-size: 14px; transition: background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s, transform 0.15s;
  }
  .icon-btn:hover:not(:disabled) { background: rgba(0,255,136,0.15); }
  .icon-btn:disabled { opacity: 0.35; cursor: not-allowed; }

  /* Danger Zone */
  .danger-zone { margin-top: auto; padding-top: 8px; }
  .logout-btn {
    width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;
    padding: 10px; border-radius: 10px;
    background: rgba(255,107,107,0.08); border: 1px solid rgba(255,107,107,0.15);
    color: #ff6b6b; font-size: 13px; font-weight: 500;
    font-family: 'Kanit', sans-serif; cursor: pointer; transition: background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s, transform 0.15s;
  }
  .logout-btn:hover { background: rgba(255,107,107,0.15); }
  .logout-btn svg { width: 18px; height: 18px; }

  .spinner-sm {
    width: 14px; height: 14px; border: 2px solid rgba(0,255,136,0.2);
    border-top-color: #00ff88; border-radius: 50%;
    animation: spin 0.6s linear infinite; display: inline-block;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Mobile */
  @media (max-width: 768px) {
    .settings-modal {
      width: calc(100% - 32px); max-width: 420px;
      max-height: calc(100vh - 60px);
    }
    .modal-body { padding: 14px 16px; }
    .fuel-selects { grid-template-columns: 1fr; }
    .ev-sliders { grid-template-columns: 1fr; }
    .ev-sliders .slider-card.full { grid-column: auto; }
  }

  @media (max-width: 480px) {
    .settings-modal {
      width: calc(100% - 24px); max-width: 100%;
      max-height: calc(100vh - 48px);
    }
    .modal-body { padding: 12px 14px; }
    .modal-header { padding: 14px 16px; }
    .avatar { width: 34px; height: 34px; font-size: 16px; border-radius: 10px; }
    .header-name { font-size: 13px; }
    .tab-btn { font-size: 11px; padding: 7px 2px; }
    .ev-stat-val { font-size: 16px; }
  }
</style>
