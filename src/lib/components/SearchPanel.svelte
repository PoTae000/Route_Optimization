<script>
  import { createEventDispatcher, onDestroy } from 'svelte';

  const dispatch = createEventDispatcher();

  // Props
  export let isNavigating = false;
  export let directDestination = null;
  export let getUserKey = (key) => key;

  // Start Point Search props
  export let showStartPointPicker = false;
  export let startPointSearchQuery = '';
  export let isSearchingStartPoint = false;
  export let startPointResults = [];

  // Internal state
  let searchQuery = '';
  let searchResults = [];
  let isSearching = false;
  let showSearchResults = false;
  let searchFocused = false;
  let recentSearches = [];
  let searchDebounceTimer = null;
  let searchAbortController = null;
  const MAX_RECENT_SEARCHES = 8;

  // Load recent searches on init
  loadRecentSearches();

  function fetchWithTimeout(url, options = {}) {
    const { timeout = 10000, ...fetchOptions } = options;
    const controller = fetchOptions.signal ? undefined : new AbortController();
    const signal = fetchOptions.signal || controller?.signal;
    const timeoutId = controller ? setTimeout(() => controller.abort(), timeout) : null;
    return fetch(url, { ...fetchOptions, signal }).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
  }

  async function searchPlace(query) {
    if (!query || query.length < 2) { searchResults = []; showSearchResults = false; return; }
    if (searchAbortController) { searchAbortController.abort(); }
    searchAbortController = new AbortController();
    const signal = searchAbortController.signal;
    isSearching = true;
    try {
      const params = new URLSearchParams({
        q: query, format: 'json', limit: '8', countrycodes: 'th',
        addressdetails: '1', 'accept-language': 'th'
      });
      const res = await fetchWithTimeout(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        headers: { 'User-Agent': 'RouteOptimization/2.0' },
        signal, timeout: 8000
      });
      if (signal.aborted) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (signal.aborted) return;
      if (!Array.isArray(data)) { searchResults = []; showSearchResults = false; return; }
      searchResults = data.filter((r) => r.lat && r.lon && r.display_name).map((r) => ({
        lat: parseFloat(r.lat), lng: parseFloat(r.lon),
        name: r.display_name?.split(',')[0] || 'ไม่ทราบชื่อ',
        address: r.display_name || '',
        type: r.type, category: r.category
      }));
      showSearchResults = searchResults.length > 0;
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Search error:', err);
      dispatch('searchError', { message: 'ค้นหาไม่สำเร็จ ลองใหม่อีกครั้ง' });
    } finally {
      if (!signal.aborted) isSearching = false;
    }
  }

  function handleSearchInput() {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => searchPlace(searchQuery), 400);
  }

  function selectSearchResult(result) {
    showSearchResults = false;
    searchQuery = result.name;
    addToRecentSearches({ name: result.name, address: result.address, lat: result.lat, lng: result.lng });
    dispatch('selectResult', result);
  }

  function selectRecentSearch(recent) {
    selectSearchResult({ name: recent.name, address: recent.address, lat: recent.lat, lng: recent.lng });
  }

  function clearSearch() {
    searchQuery = '';
    searchResults = [];
    showSearchResults = false;
    dispatch('clearDestination');
  }

  function loadRecentSearches() {
    try {
      const saved = localStorage.getItem(getUserKey('recentSearches'));
      if (saved) recentSearches = JSON.parse(saved);
    } catch (e) {
      recentSearches = [];
    }
  }

  function saveRecentSearches() {
    try {
      localStorage.setItem(getUserKey('recentSearches'), JSON.stringify(recentSearches));
    } catch (e) {}
  }

  function addToRecentSearches(item) {
    recentSearches = recentSearches.filter(r => !(Math.abs(r.lat - item.lat) < 0.0001 && Math.abs(r.lng - item.lng) < 0.0001));
    recentSearches.unshift({ ...item, timestamp: Date.now() });
    if (recentSearches.length > MAX_RECENT_SEARCHES) recentSearches = recentSearches.slice(0, MAX_RECENT_SEARCHES);
    saveRecentSearches();
  }

  function clearRecentSearches() {
    recentSearches = [];
    saveRecentSearches();
  }

  onDestroy(() => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    if (searchAbortController) searchAbortController.abort();
  });
</script>

{#if !isNavigating}
  <div class="map-search-float glass-card">
    {#if showStartPointPicker}
      <div class="start-point-section">
        <div class="start-section-header">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="#00ff88" stroke="none"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/></svg>
          <span>จุดเริ่มต้น</span>
          <button class="start-section-close" on:click={() => dispatch('closeStartPointSearch')}>✕</button>
        </div>
        <div class="start-input-wrapper">
          <svg class="start-search-icon" viewBox="0 0 24 24" width="16" height="16" fill="#00ff88" stroke="none"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
          <input
            type="text"
            class="start-input"
            placeholder="ค้นหาจุดเริ่มต้น..."
            bind:value={startPointSearchQuery}
            on:input={() => dispatch('startPointInput', startPointSearchQuery)}
          />
          {#if startPointSearchQuery}
            <button class="start-clear-btn" on:click={() => { startPointSearchQuery = ''; startPointResults = []; dispatch('startPointInput', ''); }}>×</button>
          {/if}
          <button class="start-reload-btn" on:click={() => { if (startPointSearchQuery.trim()) dispatch('startPointInput', startPointSearchQuery); }} title="ค้นหาใหม่">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
          </button>
        </div>
        {#if isSearchingStartPoint}
          <div class="start-loading">กำลังค้นหา...</div>
        {/if}
        {#if startPointResults.length > 0}
          <div class="start-result-list">
            {#each startPointResults as result}
              <button class="search-result-item" on:click={() => dispatch('selectStartPoint', result)}>
                <span class="result-icon" style="color:#00ff88">📍</span>
                <div class="result-info">
                  <span class="result-name">{result.name}</span>
                </div>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
    <div class="search-input-wrapper">
      <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
      <input
        type="text"
        class="search-input"
        placeholder="ค้นหาสถานที่..."
        bind:value={searchQuery}
        on:input={handleSearchInput}
        on:focus={() => { searchFocused = true; dispatch('searchFocus', true); if (searchResults.length > 0) showSearchResults = true; }}
        on:blur={() => { setTimeout(() => { searchFocused = false; dispatch('searchFocus', false); }, 200); }}
      />
      {#if searchQuery}
        <button class="search-clear" on:click={clearSearch}>×</button>
      {/if}
      {#if isSearching}
        <div class="search-spinner"></div>
      {/if}
    </div>
    {#if showSearchResults && searchResults.length > 0}
      <div class="search-dropdown">
        {#each searchResults as result}
          <button class="search-result-item" on:click={() => selectSearchResult(result)}>
            <span class="result-icon">📍</span>
            <div class="result-info">
              <span class="result-name">{result.name}</span>
              <span class="result-address">{result.address}</span>
            </div>
          </button>
        {/each}
      </div>
    {:else if !searchQuery && searchFocused && recentSearches.length > 0}
      <div class="search-dropdown recent-searches">
        <div class="recent-header">
          <span>🕐 ค้นหาล่าสุด</span>
          <button class="recent-clear-btn" on:click={clearRecentSearches}>ล้าง</button>
        </div>
        {#each recentSearches as recent}
          <button class="search-result-item" on:click={() => selectRecentSearch(recent)}>
            <span class="result-icon">🕐</span>
            <div class="result-info">
              <span class="result-name">{recent.name}</span>
              <span class="result-address">{recent.address}</span>
            </div>
          </button>
        {/each}
      </div>
    {/if}
    {#if directDestination}
      <div class="direct-nav-bar">
        <div class="direct-dest-info">
          <span class="dest-icon">📍</span>
          <span class="dest-name">{directDestination.name}</span>
        </div>
        <button class="btn btn-navigate-direct" on:click={() => { searchQuery = ''; searchResults = []; showSearchResults = false; dispatch('navigate'); }}>
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>
          ปักหมุด
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .map-search-float {
    position: absolute;
    top: 16px;
    right: 16px;
    z-index: 1002;
    width: 380px;
    max-width: calc(100% - 32px);
    padding: 10px 14px;
    border-radius: 14px;
    animation: fadeInFloat 0.4s cubic-bezier(0.22, 1, 0.36, 1) 0.1s both;
  }
  @keyframes fadeInFloat {
    from { opacity: 0; transform: translateY(-8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .map-search-float .search-input {
    background: rgba(0, 0, 0, 0.5);
    border-color: rgba(255, 255, 255, 0.15);
  }
  .map-search-float .search-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    border-radius: 12px;
  }
  .map-search-float .direct-nav-bar {
    margin-top: 8px;
  }

  .search-input-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }
  .search-icon {
    position: absolute;
    left: 12px;
    width: 18px;
    height: 18px;
    color: #52525b;
    pointer-events: none;
  }
  .search-input {
    width: 100%;
    padding: 12px 40px 12px 38px;
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    color: #e4e4e7;
    font-family: 'Kanit', sans-serif;
    font-size: 14px;
    transition: border-color 0.35s ease, box-shadow 0.35s ease, background 0.35s ease;
  }
  .search-input:focus {
    outline: none;
    border-color: #00ff88;
    background: rgba(0, 0, 0, 0.55);
    box-shadow: 0 0 0 3px rgba(0, 255, 136, 0.1), 0 4px 20px rgba(0, 255, 136, 0.08);
  }
  .search-input::placeholder { color: #52525b; }
  .search-clear {
    position: absolute;
    right: 10px;
    background: none;
    border: none;
    color: #71717a;
    font-size: 20px;
    cursor: pointer;
    padding: 4px;
  }
  .search-spinner {
    position: absolute;
    right: 36px;
    width: 16px;
    height: 16px;
    border: 2px solid rgba(0, 255, 136, 0.3);
    border-top-color: #00ff88;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .search-dropdown {
    position: absolute;
    top: calc(100% - 4px);
    left: 24px;
    right: 24px;
    background: rgba(15, 15, 25, 0.98);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 12px;
    max-height: 280px;
    overflow-y: auto;
    z-index: 200;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  }
  .search-result-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
    padding: 12px 16px;
    text-align: left;
    background: none;
    border: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    cursor: pointer;
    color: #e4e4e7;
    font-family: 'Kanit', sans-serif;
    transition: background 0.15s;
  }
  .search-result-item:hover { background: rgba(0, 255, 136, 0.08); }
  .search-result-item:last-child { border-bottom: none; }
  .result-icon { font-size: 16px; margin-top: 2px; }
  .result-info { display: flex; flex-direction: column; min-width: 0; }
  .result-name { font-weight: 500; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .result-address { font-size: 11px; color: #71717a; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

  /* Direct Navigation Bar */
  .direct-nav-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 10px;
    padding: 10px 14px;
    background: rgba(0, 255, 136, 0.08);
    border: 1px solid rgba(0, 255, 136, 0.2);
    border-radius: 10px;
  }
  .direct-dest-info { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
  .dest-icon { font-size: 16px; }
  .dest-name { font-size: 13px; font-weight: 500; color: #00ff88; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .btn-navigate-direct {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
    border: none;
    border-radius: 8px;
    color: white;
    font-family: 'Kanit', sans-serif;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
  }
  .btn-navigate-direct svg { width: 16px; height: 16px; }
  .btn-navigate-direct:hover { transform: translateY(-1px); }

  /* Recent Searches */
  .recent-searches {
    padding: 8px 0;
  }
  .recent-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 12px 8px;
    font-size: 12px;
    color: #a1a1aa;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    margin-bottom: 4px;
  }
  .recent-clear-btn {
    background: none;
    border: none;
    color: #ef4444;
    font-size: 11px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    font-family: 'Kanit', sans-serif;
  }
  .recent-clear-btn:hover {
    background: rgba(239, 68, 68, 0.15);
  }

  /* Start Point Search Section */
  .start-point-section {
    border-bottom: 1px solid rgba(255,255,255,0.06);
    padding: 0 0 8px;
    margin-bottom: 8px;
  }
  .start-section-header {
    display: flex; align-items: center; gap: 6px;
    font-size: 12px; color: #00ff88; font-weight: 500;
    margin-bottom: 6px; padding: 0 2px;
  }
  .start-section-close {
    background: none; border: none; color: #a1a1aa;
    cursor: pointer; margin-left: auto; font-size: 14px;
    padding: 2px 4px; font-family: inherit; line-height: 1;
  }
  .start-section-close:hover { color: #ef4444; }
  .start-input-wrapper {
    position: relative; display: flex; align-items: center;
  }
  .start-search-icon {
    position: absolute; left: 10px; pointer-events: none; z-index: 1;
  }
  .start-input {
    width: 100%; padding: 10px 60px 10px 34px; font-size: 13px;
    border: 1px solid rgba(255,255,255,0.1); border-radius: 10px;
    background: rgba(0, 0, 0, 0.4); color: #e4e4e7;
    outline: none; font-family: 'Kanit', sans-serif;
    transition: border-color 0.3s ease, box-shadow 0.3s ease, background 0.3s ease;
  }
  .start-input:focus {
    border-color: #00ff88;
    background: rgba(0, 0, 0, 0.55);
    box-shadow: 0 0 0 3px rgba(0, 255, 136, 0.1), 0 4px 20px rgba(0, 255, 136, 0.08);
  }
  .start-input::placeholder { color: #52525b; }
  .start-clear-btn {
    position: absolute; right: 30px;
    background: none; border: none; color: #71717a;
    font-size: 18px; cursor: pointer; padding: 2px 4px;
    font-family: inherit; line-height: 1;
  }
  .start-clear-btn:hover { color: #e4e4e7; }
  .start-reload-btn {
    position: absolute; right: 8px;
    background: none; border: none; color: #52525b;
    cursor: pointer; padding: 3px;
    border-radius: 6px; transition: all 0.2s; display: flex; align-items: center;
  }
  .start-reload-btn:hover { color: #00ff88; background: rgba(0,255,136,0.1); }
  .start-loading { padding: 6px 4px; font-size: 12px; color: #a1a1aa; }
  .start-result-list { margin-top: 4px; max-height: 180px; overflow-y: auto; }

  /* Glass Card base */
  :global(.glass-card) {
    background: rgba(12, 12, 20, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
  }

  /* Responsive */
  @media (max-width: 1024px) {
    .map-search-float { width: 340px; top: 12px; right: 12px; }
  }
  @media (max-width: 768px) {
    .map-search-float { left: 10px; right: 10px; width: auto; top: 10px; padding: 8px 10px; }
    .search-input { padding: 10px 36px 10px 34px; font-size: 13px; }
    .search-dropdown { left: 8px; right: 8px; }
    .direct-nav-bar { flex-direction: column; gap: 8px; }
    .btn-navigate-direct { width: 100%; justify-content: center; }
  }
  @media (max-width: 480px) {
    .map-search-float { left: 8px; right: 8px; width: auto; top: 8px; padding: 6px 8px; }
    .map-search-float .search-input { padding: 8px 32px 8px 30px; font-size: 12px; }
  }
</style>
