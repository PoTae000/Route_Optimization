<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';

  const API_URL = 'http://localhost:3000/api';

  let currentUser: any = null;

  // Data
  let drivers: any[] = [];
  let allPoints: any[] = [];
  let deliveryHistory: any[] = [];
  let todayStats = { completed: 0, skipped: 0, pending: 0 };
  let driverWorkload: any[] = [];

  // UI State
  let activeTab: 'overview' | 'points' | 'history' | 'drivers' = 'overview';
  let selectedDriver: number | null = null;
  let selectedPoints: number[] = [];
  let showAssignModal = false;
  let isLoading = true;
  let notification = { show: false, message: '', type: 'success' as 'success' | 'error' };

  // Filters
  let filterStatus: 'all' | 'pending' | 'completed' | 'skipped' = 'all';
  let filterDriver: number | null = null;
  let searchQuery = '';

  // Auto refresh
  let refreshInterval: any;

  onMount(async () => {
    const userStr = localStorage.getItem('user');
    if (!userStr) {
      goto('/');
      return;
    }

    currentUser = JSON.parse(userStr);
    
    if (currentUser.role !== 'admin') {
      goto(`/Home/${currentUser.id}`);
      return;
    }

    const urlId = $page.params.id;
    if (Number(urlId) !== currentUser.id) {
      goto(`/Admin/${currentUser.id}`);
      return;
    }

    await loadAllData();
    
    // Auto refresh ทุก 30 วินาที
    refreshInterval = setInterval(loadAllData, 30000);
    
    isLoading = false;
  });

  onDestroy(() => {
    if (refreshInterval) clearInterval(refreshInterval);
  });

  async function loadAllData() {
    await Promise.all([
      loadDrivers(),
      loadAllPoints(),
      loadTodayStats(),
      loadDeliveryHistory(),
      loadDriverWorkload()
    ]);
  }

  async function loadDrivers() {
    try {
      const res = await fetch(`${API_URL}/drivers`);
      const data = await res.json();
      if (Array.isArray(data)) {
        drivers = data;
      }
    } catch (e) {
      console.error('Load drivers error:', e);
    }
  }

  async function loadAllPoints() {
    try {
      const params = new URLSearchParams();
      params.append('role', 'admin');
      
      const res = await fetch(`${API_URL}/points?${params.toString()}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        allPoints = data;
      }
    } catch (e) {
      console.error('Load points error:', e);
    }
  }

  async function loadTodayStats() {
    try {
      const params = new URLSearchParams();
      params.append('role', 'admin');
      
      const res = await fetch(`${API_URL}/deliveries/stats/today?${params.toString()}`);
      const data = await res.json();
      if (!data.error) {
        todayStats = data;
      }
    } catch (e) {
      console.error('Load stats error:', e);
    }
  }

  async function loadDeliveryHistory() {
    try {
      const params = new URLSearchParams();
      params.append('role', 'admin');
      params.append('limit', '100');
      
      const res = await fetch(`${API_URL}/deliveries/history?${params.toString()}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        deliveryHistory = data;
      }
    } catch (e) {
      console.error('Load history error:', e);
    }
  }

  async function loadDriverWorkload() {
    try {
      const res = await fetch(`${API_URL}/drivers/workload`);
      const data = await res.json();
      if (Array.isArray(data)) {
        driverWorkload = data;
      }
    } catch (e) {
      console.error('Load workload error:', e);
    }
  }

  function togglePointSelection(id: number) {
    if (selectedPoints.includes(id)) {
      selectedPoints = selectedPoints.filter(p => p !== id);
    } else {
      selectedPoints = [...selectedPoints, id];
    }
  }

  function selectAllPoints() {
    selectedPoints = allPoints.filter(p => !p.driver_id).map(p => p.id);
  }

  async function assignPointsToDriver() {
    if (!selectedDriver || selectedPoints.length === 0) return;

    try {
      const res = await fetch(`${API_URL}/points/bulk-assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          point_ids: selectedPoints,
          driver_id: selectedDriver
        })
      });

      const data = await res.json();
      if (data.success) {
        showNotification(`มอบหมาย ${data.assigned_count} จุดสำเร็จ`, 'success');
        selectedPoints = [];
        showAssignModal = false;
        await loadAllData();
      } else {
        throw new Error(data.error);
      }
    } catch (e: any) {
      showNotification(`เกิดข้อผิดพลาด: ${e.message}`, 'error');
    }
  }

  function showNotification(message: string, type: 'success' | 'error') {
    notification = { show: true, message, type };
    setTimeout(() => notification.show = false, 3000);
  }

  function formatTime(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  }

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
  }

  function logout() {
    localStorage.removeItem('user');
    goto('/');
  }

  // Open Google Maps
  function openGoogleMaps(lat: number, lng: number) {
    window.open(`https://www.google.com/maps?q=${lat},${lng}`, '_blank');
  }

  // Reactive filtered points
  $: filteredPoints = (() => {
    let filtered = [...allPoints];
    
    if (filterDriver !== null) {
      if (filterDriver === 0) {
        filtered = filtered.filter(p => !p.driver_id);
      } else {
        filtered = filtered.filter(p => p.driver_id === filterDriver);
      }
    }
    
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(p => 
        p.name.toLowerCase().includes(q) || 
        p.address.toLowerCase().includes(q)
      );
    }
    
    return filtered;
  })();

  // Reactive filtered history
  $: filteredHistory = (() => {
    let filtered = [...deliveryHistory];
    
    if (filterStatus !== 'all') {
      filtered = filtered.filter(h => h.status === filterStatus);
    }
    
    if (filterDriver !== null) {
      filtered = filtered.filter(h => h.driver_id === filterDriver);
    }
    
    return filtered;
  })();

  $: unassignedCount = allPoints.filter(p => !p.driver_id).length;
</script>

<svelte:head>
  <title>Admin Dashboard | Route Optimization</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
</svelte:head>

<div class="admin-container">
  <!-- Notification -->
  {#if notification.show}
    <div class="toast" class:success={notification.type === 'success'} class:error={notification.type === 'error'}>
      {notification.message}
    </div>
  {/if}

  <!-- Assign Modal -->
  {#if showAssignModal}
    <div class="modal-overlay" on:click={() => showAssignModal = false} on:keypress={() => {}} role="button" tabindex="-1">
      <div class="modal" on:click|stopPropagation on:keypress={() => {}} role="dialog">
        <h3>มอบหมายงาน</h3>
        <p>{selectedPoints.length} จุดที่เลือก</p>
        
        <div class="form-group">
          <label for="driver-select">เลือก Driver:</label>
          <select id="driver-select" bind:value={selectedDriver}>
            <option value={null}>-- เลือก Driver --</option>
            {#each drivers as driver}
              <option value={driver.id}>{driver.avatar} {driver.name}</option>
            {/each}
          </select>
        </div>
        
        <div class="modal-actions">
          <button class="btn btn-primary" on:click={assignPointsToDriver} disabled={!selectedDriver}>
            มอบหมาย
          </button>
          <button class="btn btn-ghost" on:click={() => showAssignModal = false}>
            ยกเลิก
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Sidebar -->
  <aside class="sidebar">
    <div class="sidebar-header">
      <div class="logo">
        <div class="logo-icon">👑</div>
        <div class="logo-text">
          <h1>Admin Panel</h1>
          <span>Route Optimization</span>
        </div>
      </div>
    </div>

    <div class="user-info">
      <div class="user-avatar">{currentUser?.avatar || '👤'}</div>
      <div class="user-details">
        <div class="user-name">{currentUser?.name || 'Admin'}</div>
        <div class="user-role">Administrator</div>
      </div>
    </div>

    <nav class="nav-menu">
      <button class="nav-item" class:active={activeTab === 'overview'} on:click={() => activeTab = 'overview'}>
        <span class="nav-icon">📊</span>
        <span>ภาพรวม</span>
      </button>
      <button class="nav-item" class:active={activeTab === 'points'} on:click={() => activeTab = 'points'}>
        <span class="nav-icon">📍</span>
        <span>จุดส่งทั้งหมด</span>
        {#if unassignedCount > 0}
          <span class="badge">{unassignedCount}</span>
        {/if}
      </button>
      <button class="nav-item" class:active={activeTab === 'history'} on:click={() => activeTab = 'history'}>
        <span class="nav-icon">📋</span>
        <span>ประวัติการส่ง</span>
      </button>
      <button class="nav-item" class:active={activeTab === 'drivers'} on:click={() => activeTab = 'drivers'}>
        <span class="nav-icon">🚗</span>
        <span>จัดการ Driver</span>
      </button>
    </nav>

    <div class="sidebar-footer">
      <button class="logout-btn" on:click={logout}>
        <span>🚪</span> ออกจากระบบ
      </button>
    </div>
  </aside>

  <!-- Main Content -->
  <main class="main-content">
    {#if isLoading}
      <div class="loading-screen">
        <div class="spinner"></div>
        <p>กำลังโหลดข้อมูล...</p>
      </div>
    {:else}
      <!-- Overview Tab -->
      {#if activeTab === 'overview'}
        <div class="page-header">
          <h2>📊 ภาพรวมวันนี้</h2>
          <button class="btn btn-ghost" on:click={loadAllData}>
            🔄 รีเฟรช
          </button>
        </div>

        <!-- Stats Cards -->
        <div class="stats-grid">
          <div class="stat-card pending">
            <div class="stat-icon">📦</div>
            <div class="stat-info">
              <div class="stat-value">{todayStats.pending}</div>
              <div class="stat-label">รอจัดส่ง</div>
            </div>
          </div>
          <div class="stat-card completed">
            <div class="stat-icon">✅</div>
            <div class="stat-info">
              <div class="stat-value">{todayStats.completed}</div>
              <div class="stat-label">ส่งสำเร็จ</div>
            </div>
          </div>
          <div class="stat-card skipped">
            <div class="stat-icon">⏭️</div>
            <div class="stat-info">
              <div class="stat-value">{todayStats.skipped}</div>
              <div class="stat-label">ข้าม</div>
            </div>
          </div>
          <div class="stat-card drivers">
            <div class="stat-icon">🚗</div>
            <div class="stat-info">
              <div class="stat-value">{drivers.length}</div>
              <div class="stat-label">Driver ทั้งหมด</div>
            </div>
          </div>
        </div>

        <!-- Two Column Layout -->
        <div class="overview-grid">
          <!-- Driver Workload -->
          <div class="card">
            <div class="card-header">
              <h3>🚗 สถานะ Driver</h3>
            </div>
            <div class="card-content">
              {#if driverWorkload.length === 0}
                <div class="empty-state">ไม่มีข้อมูล Driver</div>
              {:else}
                {#each driverWorkload as driver}
                  <div class="driver-row">
                    <div class="driver-info">
                      <span class="driver-avatar">{driver.avatar}</span>
                      <span class="driver-name">{driver.name}</span>
                    </div>
                    <div class="driver-stats">
                      <span class="stat-badge pending">{driver.pending} รอส่ง</span>
                      <span class="stat-badge completed">{driver.completed_today} เสร็จ</span>
                    </div>
                  </div>
                {/each}
              {/if}
            </div>
          </div>

          <!-- Recent Activity -->
          <div class="card">
            <div class="card-header">
              <h3>📋 กิจกรรมล่าสุด</h3>
            </div>
            <div class="card-content">
              {#if deliveryHistory.length === 0}
                <div class="empty-state">ยังไม่มีกิจกรรม</div>
              {:else}
                {#each deliveryHistory.slice(0, 10) as record}
                  <div class="activity-row">
                    <div class="activity-icon" class:success={record.status === 'completed'} class:skip={record.status === 'skipped'}>
                      {record.status === 'completed' ? '✅' : '⏭️'}
                    </div>
                    <div class="activity-info">
                      <div class="activity-title">{record.point_name}</div>
                      <div class="activity-meta">
                        {record.driver_name || 'ไม่ระบุ'} • {formatTime(record.delivered_at)}
                      </div>
                    </div>
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        </div>

        <!-- Points Summary Card -->
        <div class="card">
          <div class="card-header">
            <h3>📍 สรุปจุดส่ง</h3>
          </div>
          <div class="card-content">
            <div class="summary-grid">
              <div class="summary-item">
                <div class="summary-value">{allPoints.length}</div>
                <div class="summary-label">จุดส่งทั้งหมด</div>
              </div>
              <div class="summary-item">
                <div class="summary-value assigned">{allPoints.filter(p => p.driver_id).length}</div>
                <div class="summary-label">มอบหมายแล้ว</div>
              </div>
              <div class="summary-item">
                <div class="summary-value unassigned">{unassignedCount}</div>
                <div class="summary-label">ยังไม่มอบหมาย</div>
              </div>
            </div>
          </div>
        </div>
      {/if}

      <!-- Points Tab -->
      {#if activeTab === 'points'}
        <div class="page-header">
          <h2>📍 จุดส่งทั้งหมด ({filteredPoints.length})</h2>
          <div class="header-actions">
            {#if selectedPoints.length > 0}
              <button class="btn btn-primary" on:click={() => showAssignModal = true}>
                มอบหมาย {selectedPoints.length} จุด
              </button>
            {/if}
            <button class="btn btn-ghost" on:click={selectAllPoints}>
              เลือกที่ยังไม่ assign
            </button>
          </div>
        </div>

        <!-- Filters -->
        <div class="filters-bar">
          <div class="search-box">
            <input type="text" placeholder="ค้นหาจุดส่ง..." bind:value={searchQuery}>
          </div>
          <select bind:value={filterDriver}>
            <option value={null}>Driver ทั้งหมด</option>
            <option value={0}>ยังไม่ assign</option>
            {#each drivers as driver}
              <option value={driver.id}>{driver.name}</option>
            {/each}
          </select>
        </div>

        <!-- Points Table -->
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th class="checkbox-col">
                  <input type="checkbox" on:change={(e) => {
                    if (e.currentTarget.checked) selectAllPoints();
                    else selectedPoints = [];
                  }}>
                </th>
                <th>#</th>
                <th>ชื่อ</th>
                <th>ที่อยู่</th>
                <th>Driver</th>
                <th>Priority</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredPoints as point, i}
                <tr class:selected={selectedPoints.includes(point.id)}>
                  <td class="checkbox-col">
                    <input type="checkbox" checked={selectedPoints.includes(point.id)} on:change={() => togglePointSelection(point.id)}>
                  </td>
                  <td>{i + 1}</td>
                  <td class="name-col">{point.name}</td>
                  <td class="address-col">{point.address}</td>
                  <td>
                    {#if point.driver_name}
                      <span class="driver-badge">{point.driver_name}</span>
                    {:else}
                      <span class="unassigned-badge">ยังไม่ assign</span>
                    {/if}
                  </td>
                  <td>
                    <span class="priority-badge p{point.priority}">P{point.priority}</span>
                  </td>
                  <td>
                    <button class="icon-btn" on:click={() => openGoogleMaps(point.lat, point.lng)} title="เปิด Google Maps">
                      🗺️
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      <!-- History Tab -->
      {#if activeTab === 'history'}
        <div class="page-header">
          <h2>📋 ประวัติการส่ง</h2>
        </div>

        <!-- Filters -->
        <div class="filters-bar">
          <select bind:value={filterStatus}>
            <option value="all">สถานะทั้งหมด</option>
            <option value="completed">ส่งสำเร็จ</option>
            <option value="skipped">ข้าม</option>
          </select>
          <select bind:value={filterDriver}>
            <option value={null}>Driver ทั้งหมด</option>
            {#each drivers as driver}
              <option value={driver.id}>{driver.name}</option>
            {/each}
          </select>
        </div>

        <!-- History Table -->
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>เวลา</th>
                <th>สถานะ</th>
                <th>ชื่อจุด</th>
                <th>ที่อยู่</th>
                <th>Driver</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredHistory as record}
                <tr>
                  <td class="time-col">
                    <div>{formatTime(record.delivered_at)}</div>
                    <div class="date-sub">{formatDate(record.delivered_at)}</div>
                  </td>
                  <td>
                    {#if record.status === 'completed'}
                      <span class="status-badge completed">✅ สำเร็จ</span>
                    {:else}
                      <span class="status-badge skipped">⏭️ ข้าม</span>
                    {/if}
                  </td>
                  <td class="name-col">{record.point_name}</td>
                  <td class="address-col">{record.address || '-'}</td>
                  <td>
                    <span class="driver-badge">{record.driver_name || 'ไม่ระบุ'}</span>
                  </td>
                  <td>
                    <button class="icon-btn" on:click={() => openGoogleMaps(record.lat, record.lng)} title="เปิด Google Maps">
                      🗺️
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      <!-- Drivers Tab -->
      {#if activeTab === 'drivers'}
        <div class="page-header">
          <h2>🚗 จัดการ Driver</h2>
        </div>

        <div class="drivers-grid">
          {#each drivers as driver}
            {@const workload = driverWorkload.find(w => w.id === driver.id)}
            <div class="driver-card">
              <div class="driver-header">
                <div class="driver-avatar-lg">{driver.avatar}</div>
                <div class="driver-info-main">
                  <h3>{driver.name}</h3>
                  <p>{driver.vehicle} • {driver.plateNumber}</p>
                </div>
              </div>
              <div class="driver-stats-grid">
                <div class="driver-stat">
                  <div class="stat-num">{workload?.pending || 0}</div>
                  <div class="stat-text">รอส่ง</div>
                </div>
                <div class="driver-stat">
                  <div class="stat-num">{workload?.completed_today || 0}</div>
                  <div class="stat-text">เสร็จวันนี้</div>
                </div>
              </div>
              <div class="driver-contact">
                <span>📞 {driver.phone}</span>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </main>
</div>

<style>
  :global(*) { margin: 0; padding: 0; box-sizing: border-box; }
  :global(body) { font-family: 'Kanit', sans-serif; background: #0f0f1a; color: #e4e4e7; }

  .admin-container { display: flex; min-height: 100vh; }

  /* Sidebar */
  .sidebar { width: 280px; background: #1a1a2e; border-right: 1px solid rgba(255,255,255,0.05); display: flex; flex-direction: column; position: fixed; top: 0; left: 0; height: 100vh; z-index: 100; }
  
  .sidebar-header { padding: 24px 20px; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .logo { display: flex; align-items: center; gap: 12px; }
  .logo-icon { width: 48px; height: 48px; background: linear-gradient(135deg, #ffd93d, #ff6b6b); border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 24px; }
  .logo-text h1 { font-size: 18px; color: #fff; font-weight: 600; }
  .logo-text span { font-size: 11px; color: #71717a; }

  .user-info { display: flex; align-items: center; gap: 12px; padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .user-avatar { width: 44px; height: 44px; background: linear-gradient(135deg, #667eea, #764ba2); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; }
  .user-name { font-weight: 600; font-size: 14px; }
  .user-role { font-size: 12px; color: #71717a; }

  .nav-menu { flex: 1; padding: 16px 12px; display: flex; flex-direction: column; gap: 4px; }
  .nav-item { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-radius: 10px; background: transparent; border: none; color: #a1a1aa; font-family: 'Kanit', sans-serif; font-size: 14px; cursor: pointer; transition: all 0.2s; text-align: left; width: 100%; }
  .nav-item:hover { background: rgba(255,255,255,0.05); color: #fff; }
  .nav-item.active { background: rgba(0, 255, 136, 0.1); color: #00ff88; }
  .nav-icon { font-size: 18px; }
  .badge { margin-left: auto; background: #ff6b6b; color: white; font-size: 11px; padding: 2px 8px; border-radius: 10px; }

  .sidebar-footer { padding: 16px 20px; border-top: 1px solid rgba(255,255,255,0.05); }
  .logout-btn { width: 100%; padding: 12px; background: rgba(255, 107, 107, 0.1); border: 1px solid rgba(255, 107, 107, 0.3); border-radius: 10px; color: #ff6b6b; font-family: 'Kanit', sans-serif; font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.2s; }
  .logout-btn:hover { background: rgba(255, 107, 107, 0.2); }

  /* Main Content */
  .main-content { flex: 1; margin-left: 280px; padding: 24px; overflow-y: auto; min-height: 100vh; }

  .loading-screen { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 60vh; gap: 16px; }
  .spinner { width: 48px; height: 48px; border: 3px solid rgba(0, 255, 136, 0.2); border-top-color: #00ff88; border-radius: 50%; animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
  .page-header h2 { font-size: 24px; font-weight: 600; }
  .header-actions { display: flex; gap: 12px; }

  .btn { padding: 10px 20px; border-radius: 10px; font-family: 'Kanit', sans-serif; font-size: 14px; cursor: pointer; border: none; transition: all 0.2s; display: flex; align-items: center; gap: 8px; }
  .btn-primary { background: linear-gradient(135deg, #00ff88, #00cc6a); color: #000; font-weight: 600; }
  .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 4px 20px rgba(0, 255, 136, 0.3); }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
  .btn-ghost { background: rgba(255,255,255,0.05); color: #a1a1aa; border: 1px solid rgba(255,255,255,0.1); }
  .btn-ghost:hover { background: rgba(255,255,255,0.1); color: #fff; }

  /* Stats Grid */
  .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
  .stat-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; padding: 20px; display: flex; align-items: center; gap: 16px; }
  .stat-icon { font-size: 32px; }
  .stat-value { font-size: 32px; font-weight: 700; font-family: 'JetBrains Mono', monospace; }
  .stat-label { font-size: 13px; color: #71717a; }
  .stat-card.pending .stat-value { color: #667eea; }
  .stat-card.completed .stat-value { color: #00ff88; }
  .stat-card.skipped .stat-value { color: #ffa502; }
  .stat-card.drivers .stat-value { color: #818cf8; }

  /* Overview Grid */
  .overview-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }

  .card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; overflow: hidden; margin-bottom: 24px; }
  .card-header { padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .card-header h3 { font-size: 16px; font-weight: 600; }
  .card-content { padding: 16px 20px; max-height: 300px; overflow-y: auto; }

  /* Summary Grid */
  .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .summary-item { text-align: center; padding: 20px; background: rgba(0,0,0,0.2); border-radius: 12px; }
  .summary-value { font-size: 36px; font-weight: 700; color: #e4e4e7; font-family: 'JetBrains Mono', monospace; }
  .summary-value.assigned { color: #00ff88; }
  .summary-value.unassigned { color: #ff6b6b; }
  .summary-label { font-size: 13px; color: #71717a; margin-top: 8px; }

  .driver-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .driver-row:last-child { border-bottom: none; }
  .driver-info { display: flex; align-items: center; gap: 12px; }
  .driver-avatar { font-size: 24px; }
  .driver-name { font-size: 14px; font-weight: 500; }
  .driver-stats { display: flex; gap: 8px; }
  .stat-badge { padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 500; }
  .stat-badge.pending { background: rgba(102, 126, 234, 0.2); color: #818cf8; }
  .stat-badge.completed { background: rgba(0, 255, 136, 0.2); color: #00ff88; }

  .activity-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .activity-row:last-child { border-bottom: none; }
  .activity-icon { width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 14px; }
  .activity-icon.success { background: rgba(0, 255, 136, 0.2); }
  .activity-icon.skip { background: rgba(255, 165, 2, 0.2); }
  .activity-title { font-size: 13px; font-weight: 500; }
  .activity-meta { font-size: 11px; color: #71717a; }

  /* Filters */
  .filters-bar { display: flex; gap: 12px; margin-bottom: 20px; }
  .search-box input { padding: 10px 16px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; color: #e4e4e7; font-family: 'Kanit', sans-serif; font-size: 14px; width: 250px; }
  .search-box input:focus { outline: none; border-color: #00ff88; }
  .filters-bar select { padding: 10px 16px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; color: #e4e4e7; font-family: 'Kanit', sans-serif; font-size: 14px; }

  /* Table */
  .table-container { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; overflow: hidden; }
  .data-table { width: 100%; border-collapse: collapse; }
  .data-table th, .data-table td { padding: 14px 16px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .data-table th { background: rgba(0,0,0,0.2); font-size: 12px; font-weight: 600; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px; }
  .data-table tbody tr:hover { background: rgba(255,255,255,0.02); }
  .data-table tbody tr.selected { background: rgba(0, 255, 136, 0.1); }
  .checkbox-col { width: 40px; text-align: center; }
  .name-col { font-weight: 500; max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .address-col { font-size: 13px; color: #a1a1aa; max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .time-col { white-space: nowrap; }
  .date-sub { font-size: 11px; color: #71717a; }

  .driver-badge { padding: 4px 10px; background: rgba(102, 126, 234, 0.2); color: #818cf8; border-radius: 20px; font-size: 12px; }
  .unassigned-badge { padding: 4px 10px; background: rgba(255, 107, 107, 0.2); color: #ff6b6b; border-radius: 20px; font-size: 12px; }
  .priority-badge { padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; }
  .priority-badge.p1 { background: rgba(255, 107, 107, 0.2); color: #ff6b6b; }
  .priority-badge.p2 { background: rgba(255, 165, 2, 0.2); color: #ffa502; }
  .priority-badge.p3 { background: rgba(102, 126, 234, 0.2); color: #818cf8; }
  .priority-badge.p4 { background: rgba(168, 85, 247, 0.2); color: #a855f7; }
  .priority-badge.p5 { background: rgba(107, 114, 128, 0.2); color: #9ca3af; }
  .status-badge { padding: 4px 10px; border-radius: 20px; font-size: 12px; }
  .status-badge.completed { background: rgba(0, 255, 136, 0.2); color: #00ff88; }
  .status-badge.skipped { background: rgba(255, 165, 2, 0.2); color: #ffa502; }

  .icon-btn { width: 32px; height: 32px; border-radius: 8px; background: rgba(255,255,255,0.05); border: none; cursor: pointer; font-size: 14px; transition: all 0.2s; }
  .icon-btn:hover { background: rgba(255,255,255,0.1); }

  /* Drivers Grid */
  .drivers-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(500px, 1fr)); gap: 20px; }
  .driver-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; padding: 20px; }
  .driver-header { display: flex; gap: 16px; margin-bottom: 16px; }
  .driver-avatar-lg { width: 56px; height: 56px; background: linear-gradient(135deg, #667eea, #764ba2); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 28px; }
  .driver-info-main h3 { font-size: 18px; font-weight: 600; margin-bottom: 4px; }
  .driver-info-main p { font-size: 13px; color: #71717a; }
  .driver-stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
  .driver-stat { background: rgba(0,0,0,0.2); border-radius: 10px; padding: 12px; text-align: center; }
  .stat-num { font-size: 24px; font-weight: 700; color: #00ff88; }
  .stat-text { font-size: 11px; color: #71717a; }
  .driver-contact { font-size: 13px; color: #a1a1aa; }

  /* Modal */
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 1000; display: flex; align-items: center; justify-content: center; }
  .modal { background: #1a1a2e; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 24px; width: 400px; }
  .modal h3 { font-size: 18px; margin-bottom: 8px; }
  .modal p { font-size: 14px; color: #71717a; margin-bottom: 20px; }
  .form-group { margin-bottom: 20px; }
  .form-group label { display: block; font-size: 13px; color: #a1a1aa; margin-bottom: 8px; }
  .form-group select { width: 100%; padding: 12px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; color: #e4e4e7; font-family: 'Kanit', sans-serif; font-size: 14px; }
  .modal-actions { display: flex; gap: 12px; justify-content: flex-end; }

  .empty-state { text-align: center; padding: 40px; color: #71717a; }

  /* Toast */
  .toast { position: fixed; top: 24px; right: 24px; padding: 14px 24px; border-radius: 12px; font-size: 14px; z-index: 2000; animation: slideIn 0.3s ease; }
  .toast.success { background: rgba(0, 255, 136, 0.2); border: 1px solid rgba(0, 255, 136, 0.3); color: #00ff88; }
  .toast.error { background: rgba(255, 107, 107, 0.2); border: 1px solid rgba(255, 107, 107, 0.3); color: #ff6b6b; }
  @keyframes slideIn { from { transform: translateX(100px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

  /* Responsive */
  @media (max-width: 1200px) {
    .stats-grid { grid-template-columns: repeat(2, 1fr); }
    .overview-grid { grid-template-columns: 1fr; }
    .summary-grid { grid-template-columns: 1fr; gap: 12px; }
  }

  @media (max-width: 768px) {
    .sidebar { width: 100%; height: auto; position: relative; }
    .main-content { margin-left: 0; }
    .stats-grid { grid-template-columns: 1fr 1fr; }
    .filters-bar { flex-direction: column; }
    .search-box input { width: 100%; }
  }
</style>