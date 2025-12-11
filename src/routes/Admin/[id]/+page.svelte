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
  let customerOrders: any[] = [];

  // UI State
  let activeTab: 'overview' | 'points' | 'history' | 'drivers' | 'customers' = 'overview';
  let selectedDriver: number | null = null;
  let selectedPoints: number[] = [];
  let showAssignModal = false;
  let isLoading = true;
  let notification = { show: false, message: '', type: 'success' as 'success' | 'error' };
  let sidebarCollapsed = false;
  let currentTime = new Date();

  // Filters
  let filterStatus: 'all' | 'pending' | 'completed' | 'skipped' = 'all';
  let filterDriver: number | null = null;
  let searchQuery = '';

  // Auto refresh
  let refreshInterval: any;
  let timeInterval: any;

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
    
    refreshInterval = setInterval(loadAllData, 30000);
    timeInterval = setInterval(() => currentTime = new Date(), 1000);
    
    isLoading = false;
  });

  onDestroy(() => {
    if (refreshInterval) clearInterval(refreshInterval);
    if (timeInterval) clearInterval(timeInterval);
  });

  async function loadAllData() {
    await Promise.all([
      loadDrivers(),
      loadAllPoints(),
      loadTodayStats(),
      loadDeliveryHistory(),
      loadDriverWorkload(),
      loadCustomerOrders()
    ]);
  }

  async function loadDrivers() {
    try {
      const res = await fetch(`${API_URL}/drivers`);
      const data = await res.json();
      if (Array.isArray(data)) drivers = data;
    } catch (e) { console.error('Load drivers error:', e); }
  }

  async function loadAllPoints() {
    try {
      const params = new URLSearchParams();
      params.append('role', 'admin');
      const res = await fetch(`${API_URL}/points?${params.toString()}`);
      const data = await res.json();
      if (Array.isArray(data)) allPoints = data;
    } catch (e) { console.error('Load points error:', e); }
  }

  async function loadTodayStats() {
    try {
      const params = new URLSearchParams();
      params.append('role', 'admin');
      const res = await fetch(`${API_URL}/deliveries/stats/today?${params.toString()}`);
      const data = await res.json();
      if (!data.error) todayStats = data;
    } catch (e) { console.error('Load stats error:', e); }
  }

  async function loadDeliveryHistory() {
    try {
      const params = new URLSearchParams();
      params.append('role', 'admin');
      params.append('limit', '100');
      const res = await fetch(`${API_URL}/deliveries/history?${params.toString()}`);
      const data = await res.json();
      if (Array.isArray(data)) deliveryHistory = data;
    } catch (e) { console.error('Load history error:', e); }
  }

  async function loadDriverWorkload() {
    try {
      const res = await fetch(`${API_URL}/drivers/workload`);
      const data = await res.json();
      if (Array.isArray(data)) driverWorkload = data;
    } catch (e) { console.error('Load workload error:', e); }
  }

  async function loadCustomerOrders() {
    try {
      const res = await fetch(`${API_URL}/customer-orders`);
      const data = await res.json();
      if (Array.isArray(data)) customerOrders = data;
    } catch (e) { console.error('Load customer orders error:', e); }
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
        body: JSON.stringify({ point_ids: selectedPoints, driver_id: selectedDriver })
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

  function openGoogleMaps(lat: number, lng: number) {
    window.open(`https://www.google.com/maps?q=${lat},${lng}`, '_blank');
  }

  $: filteredPoints = (() => {
    let filtered = [...allPoints];
    if (filterDriver !== null) {
      if (filterDriver === 0) filtered = filtered.filter(p => !p.driver_id);
      else filtered = filtered.filter(p => p.driver_id === filterDriver);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(p => p.name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q));
    }
    return filtered;
  })();

  $: filteredHistory = (() => {
    let filtered = [...deliveryHistory];
    if (filterStatus !== 'all') filtered = filtered.filter(h => h.status === filterStatus);
    if (filterDriver !== null) filtered = filtered.filter(h => h.driver_id === filterDriver);
    return filtered;
  })();

  $: unassignedCount = allPoints.filter(p => !p.driver_id).length;
  $: totalDeliveries = todayStats.completed + todayStats.skipped + todayStats.pending;
  $: completionRate = totalDeliveries > 0 ? Math.round((todayStats.completed / totalDeliveries) * 100) : 0;
  $: pendingCustomerOrders = customerOrders.filter(o => o.status === 'pending').length;
</script>

<svelte:head>
  <title>Admin Dashboard | Route Optimization</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
</svelte:head>

<div class="admin-container" class:sidebar-collapsed={sidebarCollapsed}>
  <!-- Animated Background -->
  <div class="bg-gradient"></div>
  <div class="bg-grid"></div>

  <!-- Notification Toast -->
  {#if notification.show}
    <div class="toast" class:success={notification.type === 'success'} class:error={notification.type === 'error'}>
      <span class="toast-icon">{notification.type === 'success' ? '✅' : '❌'}</span>
      <span>{notification.message}</span>
    </div>
  {/if}

  <!-- Assign Modal -->
  {#if showAssignModal}
    <div class="modal-overlay" on:click={() => showAssignModal = false} on:keypress={() => {}} role="button" tabindex="-1">
      <div class="modal glass-card" on:click|stopPropagation on:keypress={() => {}} role="dialog">
        <div class="modal-header">
          <div class="modal-icon">📦</div>
          <h3>มอบหมายงาน</h3>
        </div>
        <p class="modal-subtitle">{selectedPoints.length} จุดที่เลือก</p>
        
        <div class="form-group">
          <label for="driver-select">เลือก Driver</label>
          <div class="select-wrapper">
            <select id="driver-select" bind:value={selectedDriver}>
              <option value={null}>-- เลือก Driver --</option>
              {#each drivers as driver}
                <option value={driver.id}>{driver.avatar} {driver.name}</option>
              {/each}
            </select>
          </div>
        </div>
        
        <div class="modal-actions">
          <button class="btn btn-primary" on:click={assignPointsToDriver} disabled={!selectedDriver}>
            <span>✓</span> มอบหมาย
          </button>
          <button class="btn btn-ghost" on:click={() => showAssignModal = false}>
            ยกเลิก
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Sidebar -->
  <aside class="sidebar glass-sidebar">
    <div class="sidebar-header">
      <div class="logo">
        <div class="logo-icon">
          <span>🚀</span>
        </div>
        {#if !sidebarCollapsed}
          <div class="logo-text">
            <h1>RouteFlow</h1>
            <span>Admin Panel</span>
          </div>
        {/if}
      </div>
      
    </div>

    <div class="user-card glass-card">
      <div class="user-avatar">
        <span>{currentUser?.avatar || '👤'}</span>
        <div class="status-dot"></div>
      </div>
      {#if !sidebarCollapsed}
        <div class="user-info">
          <div class="user-name">{currentUser?.name || 'Admin'}</div>
          <div class="user-role">
            <span class="role-badge">Administrator</span>
          </div>
        </div>
      {/if}
    </div>

    <nav class="nav-menu">
      <div class="nav-section-title">{sidebarCollapsed ? '' : 'เมนูหลัก'}</div>
      
      <button class="nav-item" class:active={activeTab === 'overview'} on:click={() => activeTab = 'overview'}>
        <span class="nav-icon">📊</span>
        {#if !sidebarCollapsed}<span class="nav-text">ภาพรวม</span>{/if}
      </button>
      
      <button class="nav-item" class:active={activeTab === 'points'} on:click={() => activeTab = 'points'}>
        <span class="nav-icon">📍</span>
        {#if !sidebarCollapsed}<span class="nav-text">จุดส่งทั้งหมด</span>{/if}
        {#if unassignedCount > 0}
          <span class="badge pulse">{unassignedCount}</span>
        {/if}
      </button>
      
      <button class="nav-item" class:active={activeTab === 'customers'} on:click={() => activeTab = 'customers'}>
        <span class="nav-icon">🛒</span>
        {#if !sidebarCollapsed}<span class="nav-text">คำสั่งซื้อลูกค้า</span>{/if}
        {#if pendingCustomerOrders > 0}
          <span class="badge warning pulse">{pendingCustomerOrders}</span>
        {/if}
      </button>
      
      <button class="nav-item" class:active={activeTab === 'history'} on:click={() => activeTab = 'history'}>
        <span class="nav-icon">📋</span>
        {#if !sidebarCollapsed}<span class="nav-text">ประวัติการส่ง</span>{/if}
      </button>
      
      <button class="nav-item" class:active={activeTab === 'drivers'} on:click={() => activeTab = 'drivers'}>
        <span class="nav-icon">🚗</span>
        {#if !sidebarCollapsed}<span class="nav-text">จัดการ Driver</span>{/if}
      </button>
    </nav>

    <div class="sidebar-footer">
      <button class="logout-btn" on:click={logout}>
        <span>🚪</span>
        {#if !sidebarCollapsed}<span>ออกจากระบบ</span>{/if}
      </button>
    </div>
  </aside>

  <!-- Main Content -->
  <main class="main-content">
    <!-- Top Bar -->
    <header class="top-bar glass-card">
      <div class="top-bar-left">
        <h2 class="page-title">
          {#if activeTab === 'overview'}📊 ภาพรวม{/if}
          {#if activeTab === 'points'}📍 จุดส่งทั้งหมด{/if}
          {#if activeTab === 'customers'}🛒 คำสั่งซื้อลูกค้า{/if}
          {#if activeTab === 'history'}📋 ประวัติการส่ง{/if}
          {#if activeTab === 'drivers'}🚗 จัดการ Driver{/if}
        </h2>
      </div>
      <div class="top-bar-right">
        <div class="time-display">
          <span class="time">{currentTime.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</span>
          <span class="date">{currentTime.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
        </div>
        <button class="refresh-btn" on:click={loadAllData} title="รีเฟรชข้อมูล">
          🔄
        </button>
      </div>
    </header>

    {#if isLoading}
      <div class="loading-screen">
        <div class="loading-spinner">
          <div class="spinner-ring"></div>
          <div class="spinner-ring"></div>
          <div class="spinner-ring"></div>
        </div>
        <p>กำลังโหลดข้อมูล...</p>
      </div>
    {:else}
      <div class="content-area">
        <!-- Overview Tab -->
        {#if activeTab === 'overview'}
          <!-- Hero Stats -->
          <div class="hero-stats">
            <div class="stat-card glass-card gradient-blue">
              <div class="stat-background">
                <div class="stat-pattern"></div>
              </div>
              <div class="stat-content">
                <div class="stat-icon-wrap">📦</div>
                <div class="stat-info">
                  <div class="stat-value">{todayStats.pending}</div>
                  <div class="stat-label">รอจัดส่ง</div>
                </div>
              </div>
              <div class="stat-footer">
                <span class="trend up">↑ งานใหม่วันนี้</span>
              </div>
            </div>

            <div class="stat-card glass-card gradient-green">
              <div class="stat-background">
                <div class="stat-pattern"></div>
              </div>
              <div class="stat-content">
                <div class="stat-icon-wrap">✅</div>
                <div class="stat-info">
                  <div class="stat-value">{todayStats.completed}</div>
                  <div class="stat-label">ส่งสำเร็จ</div>
                </div>
              </div>
              <div class="stat-footer">
                <span class="trend up">อัตราสำเร็จ {completionRate}%</span>
              </div>
            </div>

            <div class="stat-card glass-card gradient-orange">
              <div class="stat-background">
                <div class="stat-pattern"></div>
              </div>
              <div class="stat-content">
                <div class="stat-icon-wrap">⏭️</div>
                <div class="stat-info">
                  <div class="stat-value">{todayStats.skipped}</div>
                  <div class="stat-label">ข้ามไป</div>
                </div>
              </div>
              <div class="stat-footer">
                <span class="trend">รอดำเนินการ</span>
              </div>
            </div>

            <div class="stat-card glass-card gradient-purple">
              <div class="stat-background">
                <div class="stat-pattern"></div>
              </div>
              <div class="stat-content">
                <div class="stat-icon-wrap">🚗</div>
                <div class="stat-info">
                  <div class="stat-value">{drivers.length}</div>
                  <div class="stat-label">Driver ทั้งหมด</div>
                </div>
              </div>
              <div class="stat-footer">
                <span class="trend">{driverWorkload.filter(d => d.pending > 0).length} คนมีงาน</span>
              </div>
            </div>
          </div>

          <!-- Progress Ring -->
          <div class="progress-section glass-card">
            <div class="progress-ring-container">
              <svg class="progress-ring" width="180" height="180">
                <circle class="progress-ring-bg" cx="90" cy="90" r="70" />
                <circle 
                  class="progress-ring-fill" 
                  cx="90" 
                  cy="90" 
                  r="70"
                  style="stroke-dasharray: {completionRate * 4.4}, 440"
                />
              </svg>
              <div class="progress-text">
                <div class="progress-value">{completionRate}%</div>
                <div class="progress-label">อัตราสำเร็จ</div>
              </div>
            </div>
            <div class="progress-details">
              <h3>สรุปผลงานวันนี้</h3>
              <div class="progress-items">
                <div class="progress-item">
                  <div class="item-label">
                    <span class="dot green"></span>
                    ส่งสำเร็จ
                  </div>
                  <div class="item-value">{todayStats.completed}</div>
                </div>
                <div class="progress-item">
                  <div class="item-label">
                    <span class="dot orange"></span>
                    ข้ามไป
                  </div>
                  <div class="item-value">{todayStats.skipped}</div>
                </div>
                <div class="progress-item">
                  <div class="item-label">
                    <span class="dot blue"></span>
                    รอจัดส่ง
                  </div>
                  <div class="item-value">{todayStats.pending}</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Two Column Layout -->
          <div class="dashboard-grid">
            <!-- Driver Status -->
            <div class="card glass-card">
              <div class="card-header">
                <h3>🚗 สถานะ Driver</h3>
                <button class="btn-icon" on:click={() => activeTab = 'drivers'}>→</button>
              </div>
              <div class="card-content">
                {#if driverWorkload.length === 0}
                  <div class="empty-state">
                    <span class="empty-icon">🚗</span>
                    <p>ไม่มีข้อมูล Driver</p>
                  </div>
                {:else}
                  <div class="driver-list">
                    {#each driverWorkload as driver}
                      <div class="driver-row-modern">
                        <div class="driver-avatar-sm">
                          <span>{driver.avatar}</span>
                          <div class="online-indicator" class:active={driver.pending > 0}></div>
                        </div>
                        <div class="driver-details">
                          <div class="driver-name-row">
                            <span class="name">{driver.name}</span>
                          </div>
                          <div class="driver-progress-bar">
                            <div class="progress-fill" style="width: {driver.pending > 0 ? Math.min((driver.completed_today / (driver.completed_today + driver.pending)) * 100, 100) : 100}%"></div>
                          </div>
                        </div>
                        <div class="driver-stats-mini">
                          <span class="stat pending">{driver.pending}</span>
                          <span class="stat completed">{driver.completed_today}</span>
                        </div>
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            </div>

            <!-- Recent Activity -->
            <div class="card glass-card">
              <div class="card-header">
                <h3>📋 กิจกรรมล่าสุด</h3>
                <button class="btn-icon" on:click={() => activeTab = 'history'}>→</button>
              </div>
              <div class="card-content">
                {#if deliveryHistory.length === 0}
                  <div class="empty-state">
                    <span class="empty-icon">📋</span>
                    <p>ยังไม่มีกิจกรรม</p>
                  </div>
                {:else}
                  <div class="activity-list">
                    {#each deliveryHistory.slice(0, 8) as record}
                      <div class="activity-row-modern">
                        <div class="activity-icon-wrap" class:success={record.status === 'completed'} class:skip={record.status === 'skipped'}>
                          {record.status === 'completed' ? '✅' : '⏭️'}
                        </div>
                        <div class="activity-details">
                          <div class="activity-title">{record.point_name}</div>
                          <div class="activity-meta">
                            <span class="driver-tag">{record.driver_name || 'ไม่ระบุ'}</span>
                            <span class="time-tag">{formatTime(record.delivered_at)}</span>
                          </div>
                        </div>
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            </div>
          </div>

          <!-- Points Summary -->
          <div class="summary-card glass-card">
            <div class="summary-header">
              <h3>📍 สรุปจุดส่ง</h3>
            </div>
            <div class="summary-content">
              <div class="summary-item">
                <div class="summary-icon">📦</div>
                <div class="summary-value">{allPoints.length}</div>
                <div class="summary-label">จุดส่งทั้งหมด</div>
              </div>
              <div class="summary-divider"></div>
              <div class="summary-item">
                <div class="summary-icon">✅</div>
                <div class="summary-value green">{allPoints.filter(p => p.driver_id).length}</div>
                <div class="summary-label">มอบหมายแล้ว</div>
              </div>
              <div class="summary-divider"></div>
              <div class="summary-item">
                <div class="summary-icon">⏳</div>
                <div class="summary-value red">{unassignedCount}</div>
                <div class="summary-label">ยังไม่มอบหมาย</div>
              </div>
            </div>
          </div>
        {/if}

        <!-- Points Tab -->
        {#if activeTab === 'points'}
          <div class="tab-header">
            <div class="header-left">
              <span class="result-count">{filteredPoints.length} รายการ</span>
            </div>
            <div class="header-actions">
              {#if selectedPoints.length > 0}
                <button class="btn btn-primary glow" on:click={() => showAssignModal = true}>
                  <span>📦</span> มอบหมาย {selectedPoints.length} จุด
                </button>
              {/if}
              <button class="btn btn-secondary" on:click={selectAllPoints}>
                <span>☑️</span> เลือกที่ยังไม่ assign
              </button>
            </div>
          </div>

          <!-- Filters -->
          <div class="filters-bar glass-card">
            <div class="search-input-wrapper">
              <span class="search-icon">🔍</span>
              <input type="text" placeholder="ค้นหาจุดส่ง..." bind:value={searchQuery}>
            </div>
            <div class="filter-group">
              <div class="select-wrapper">
                <select bind:value={filterDriver}>
                  <option value={null}>🚗 Driver ทั้งหมด</option>
                  <option value={0}>⏳ ยังไม่ assign</option>
                  {#each drivers as driver}
                    <option value={driver.id}>{driver.avatar} {driver.name}</option>
                  {/each}
                </select>
              </div>
            </div>
          </div>

          <!-- Points Table -->
          <div class="table-container glass-card">
            <table class="modern-table">
              <thead>
                <tr>
                  <th class="checkbox-col">
                    <label class="custom-checkbox">
                      <input type="checkbox" on:change={(e) => {
                        if (e.currentTarget.checked) selectAllPoints();
                        else selectedPoints = [];
                      }}>
                      <span class="checkmark"></span>
                    </label>
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
                      <label class="custom-checkbox">
                        <input type="checkbox" checked={selectedPoints.includes(point.id)} on:change={() => togglePointSelection(point.id)}>
                        <span class="checkmark"></span>
                      </label>
                    </td>
                    <td><span class="row-number">{i + 1}</span></td>
                    <td class="name-col">
                      <span class="point-name">{point.name}</span>
                    </td>
                    <td class="address-col">
                      <span class="address-text">{point.address}</span>
                    </td>
                    <td>
                      {#if point.driver_name}
                        <span class="driver-chip">{point.driver_name}</span>
                      {:else}
                        <span class="unassigned-chip">ยังไม่ assign</span>
                      {/if}
                    </td>
                    <td>
                      <span class="priority-chip p{point.priority}">P{point.priority}</span>
                    </td>
                    <td>
                      <button class="action-btn" on:click={() => openGoogleMaps(point.lat, point.lng)} title="เปิด Google Maps">
                        🗺️
                      </button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}

        <!-- Customer Orders Tab -->
        {#if activeTab === 'customers'}
          <div class="tab-header">
            <div class="header-left">
              <span class="result-count">{customerOrders.length} คำสั่งซื้อ</span>
            </div>
          </div>

          <div class="orders-grid">
            {#each customerOrders as order}
              <div class="order-card glass-card" class:pending={order.status === 'pending'} class:accepted={order.status === 'accepted'} class:completed={order.status === 'completed'}>
                <div class="order-header">
                  <div class="customer-info">
                    <span class="customer-avatar">{order.customer_avatar || '👤'}</span>
                    <div class="customer-details">
                      <div class="customer-name">{order.customer_name}</div>
                      <div class="customer-phone">📞 {order.customer_phone || '-'}</div>
                    </div>
                  </div>
                  <span class="order-status" class:pending={order.status === 'pending'} class:accepted={order.status === 'accepted'} class:completed={order.status === 'completed'}>
                    {order.status === 'pending' ? '⏳ รอรับ' : order.status === 'accepted' ? '✅ รับแล้ว' : '🎉 เสร็จ'}
                  </span>
                </div>
                <div class="order-address">📍 {order.address}</div>
                {#if order.driver_name}
                  <div class="order-driver">🚗 {order.driver_name}</div>
                {/if}
                <div class="order-time">
                  🕐 {formatTime(order.created_at)} • {formatDate(order.created_at)}
                </div>
              </div>
            {:else}
              <div class="empty-state full-width">
                <span class="empty-icon">🛒</span>
                <p>ยังไม่มีคำสั่งซื้อ</p>
              </div>
            {/each}
          </div>
        {/if}

        <!-- History Tab -->
        {#if activeTab === 'history'}
          <div class="tab-header">
            <div class="header-left">
              <span class="result-count">{filteredHistory.length} รายการ</span>
            </div>
          </div>

          <!-- Filters -->
          <div class="filters-bar glass-card">
            <div class="filter-group">
              <div class="select-wrapper">
                <select bind:value={filterStatus}>
                  <option value="all">📋 สถานะทั้งหมด</option>
                  <option value="completed">✅ ส่งสำเร็จ</option>
                  <option value="skipped">⏭️ ข้าม</option>
                </select>
              </div>
              <div class="select-wrapper">
                <select bind:value={filterDriver}>
                  <option value={null}>🚗 Driver ทั้งหมด</option>
                  {#each drivers as driver}
                    <option value={driver.id}>{driver.avatar} {driver.name}</option>
                  {/each}
                </select>
              </div>
            </div>
          </div>

          <!-- History Table -->
          <div class="table-container glass-card">
            <table class="modern-table">
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
                      <div class="time-display-cell">
                        <span class="time">{formatTime(record.delivered_at)}</span>
                        <span class="date">{formatDate(record.delivered_at)}</span>
                      </div>
                    </td>
                    <td>
                      {#if record.status === 'completed'}
                        <span class="status-chip completed">✅ สำเร็จ</span>
                      {:else}
                        <span class="status-chip skipped">⏭️ ข้าม</span>
                      {/if}
                    </td>
                    <td class="name-col">
                      <span class="point-name">{record.point_name}</span>
                    </td>
                    <td class="address-col">
                      <span class="address-text">{record.address || '-'}</span>
                    </td>
                    <td>
                      <span class="driver-chip">{record.driver_name || 'ไม่ระบุ'}</span>
                    </td>
                    <td>
                      <button class="action-btn" on:click={() => openGoogleMaps(record.lat, record.lng)} title="เปิด Google Maps">
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
          <div class="drivers-grid-modern">
            {#each drivers as driver}
              {@const workload = driverWorkload.find(w => w.id === driver.id)}
              <div class="driver-card-modern glass-card">
                <div class="driver-card-header">
                  <div class="driver-avatar-large">
                    <span>{driver.avatar}</span>
                    <div class="status-indicator" class:active={workload?.pending > 0}></div>
                  </div>
                  <div class="driver-main-info">
                    <h3>{driver.name}</h3>
                    <p class="vehicle-info">{driver.vehicle} • {driver.plateNumber}</p>
                  </div>
                </div>
                
                <div class="driver-stats-row">
                  <div class="stat-box pending">
                    <div class="stat-number">{workload?.pending || 0}</div>
                    <div class="stat-text">รอส่ง</div>
                  </div>
                  <div class="stat-box completed">
                    <div class="stat-number">{workload?.completed_today || 0}</div>
                    <div class="stat-text">เสร็จวันนี้</div>
                  </div>
                </div>
                
                <div class="driver-contact-info">
                  <span class="contact-item">📞 {driver.phone}</span>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </main>
</div>

<style>
  :global(*) { margin: 0; padding: 0; box-sizing: border-box; }
  :global(body) { 
    font-family: 'Kanit', sans-serif; 
    background: #0a0a0f; 
    color: #e4e4e7;
    overflow-x: hidden;
  }

  .admin-container { 
    display: flex; 
    min-height: 100vh; 
    position: relative;
  }

  /* Animated Background */
  .bg-gradient {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: 
      radial-gradient(ellipse at 20% 20%, rgba(102, 126, 234, 0.15) 0%, transparent 50%),
      radial-gradient(ellipse at 80% 80%, rgba(118, 75, 162, 0.15) 0%, transparent 50%),
      radial-gradient(ellipse at 50% 50%, rgba(0, 255, 136, 0.05) 0%, transparent 50%);
    z-index: 0;
    animation: bgPulse 20s ease-in-out infinite;
  }

  @keyframes bgPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }

  .bg-grid {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-image: 
      linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
    background-size: 50px 50px;
    z-index: 0;
  }

  /* Glass Effects */
  .glass-card {
    background: rgba(255, 255, 255, 0.03);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
  }

  .glass-sidebar {
    background: rgba(15, 15, 25, 0.8);
    backdrop-filter: blur(30px);
    border-right: 1px solid rgba(255, 255, 255, 0.06);
  }

  /* Sidebar */
  .sidebar { 
    width: 280px; 
    min-width: 280px;
    height: 100vh; 
    display: flex; 
    flex-direction: column; 
    position: fixed; 
    top: 0; 
    left: 0; 
    z-index: 100;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .sidebar-collapsed .sidebar {
    width: 80px;
    min-width: 80px;
  }

  .sidebar-header { 
    padding: 20px; 
    display: flex; 
    justify-content: space-between; 
    align-items: center;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .logo { display: flex; align-items: center; gap: 14px; }
  
  .logo-icon { 
    width: 48px; 
    height: 48px; 
    background: linear-gradient(135deg, #00ff88 0%, #00cc6a 100%); 
    border-radius: 14px; 
    display: flex; 
    align-items: center; 
    justify-content: center; 
    font-size: 24px;
    box-shadow: 0 8px 32px rgba(0, 255, 136, 0.3);
    animation: logoGlow 3s ease-in-out infinite;
  }

  @keyframes logoGlow {
    0%, 100% { box-shadow: 0 8px 32px rgba(0, 255, 136, 0.3); }
    50% { box-shadow: 0 8px 48px rgba(0, 255, 136, 0.5); }
  }

  .logo-text h1 { 
    font-size: 20px; 
    font-weight: 700; 
    background: linear-gradient(135deg, #00ff88, #00cc6a);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  
  .logo-text span { font-size: 11px; color: #71717a; }

  .collapse-btn {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #a1a1aa;
    cursor: pointer;
    transition: all 0.2s;
  }

  .collapse-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .user-card {
    margin: 16px;
    padding: 16px;
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .user-avatar { 
    width: 48px; 
    height: 48px; 
    background: linear-gradient(135deg, #667eea, #764ba2); 
    border-radius: 14px; 
    display: flex; 
    align-items: center; 
    justify-content: center; 
    font-size: 24px;
    position: relative;
    box-shadow: 0 4px 20px rgba(102, 126, 234, 0.3);
  }

  .status-dot {
    position: absolute;
    bottom: -2px;
    right: -2px;
    width: 14px;
    height: 14px;
    background: #00ff88;
    border: 3px solid #0a0a0f;
    border-radius: 50%;
  }

  .user-name { font-weight: 600; font-size: 15px; }
  
  .role-badge {
    display: inline-block;
    padding: 4px 10px;
    background: linear-gradient(135deg, rgba(0, 255, 136, 0.2), rgba(0, 204, 106, 0.2));
    border: 1px solid rgba(0, 255, 136, 0.3);
    border-radius: 20px;
    font-size: 11px;
    color: #00ff88;
    font-weight: 500;
  }

  .nav-menu { 
    flex: 1; 
    padding: 12px;
    overflow-y: auto;
  }

  .nav-section-title {
    font-size: 10px;
    font-weight: 600;
    color: #52525b;
    text-transform: uppercase;
    letter-spacing: 1px;
    padding: 8px 12px;
    margin-bottom: 8px;
  }

  .nav-item { 
    display: flex; 
    align-items: center; 
    gap: 14px; 
    padding: 14px 16px; 
    border-radius: 12px; 
    background: transparent; 
    border: none; 
    color: #a1a1aa; 
    font-family: 'Kanit', sans-serif; 
    font-size: 14px; 
    cursor: pointer; 
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); 
    width: 100%;
    position: relative;
    overflow: hidden;
  }

  .nav-item::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    height: 100%;
    width: 3px;
    background: linear-gradient(180deg, #00ff88, #00cc6a);
    transform: scaleY(0);
    transition: transform 0.2s;
  }

  .nav-item:hover { 
    background: rgba(255, 255, 255, 0.05); 
    color: #fff; 
  }

  .nav-item.active { 
    background: rgba(0, 255, 136, 0.1); 
    color: #00ff88;
  }

  .nav-item.active::before {
    transform: scaleY(1);
  }

  .nav-icon { font-size: 20px; }
  .nav-text { flex: 1; text-align: left; }

  .badge { 
    padding: 4px 10px; 
    border-radius: 20px; 
    font-size: 11px; 
    font-weight: 600;
    background: linear-gradient(135deg, #ff6b6b, #ee5a5a);
    color: white;
    margin-left: auto;
  }

  .badge.warning {
    background: linear-gradient(135deg, #ffa502, #ff7f00);
  }

  .badge.pulse {
    animation: badgePulse 2s ease-in-out infinite;
  }

  @keyframes badgePulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.1); }
  }

  .sidebar-footer { 
    padding: 16px; 
    border-top: 1px solid rgba(255, 255, 255, 0.06); 
  }

  .logout-btn { 
    width: 100%; 
    padding: 14px; 
    background: rgba(255, 107, 107, 0.1); 
    border: 1px solid rgba(255, 107, 107, 0.2); 
    border-radius: 12px; 
    color: #ff6b6b; 
    font-family: 'Kanit', sans-serif; 
    font-size: 14px; 
    cursor: pointer; 
    display: flex; 
    align-items: center; 
    justify-content: center; 
    gap: 10px; 
    transition: all 0.2s; 
  }

  .logout-btn:hover { 
    background: rgba(255, 107, 107, 0.2);
    transform: translateY(-2px);
  }

  /* Main Content */
  .main-content { 
    flex: 1; 
    margin-left: 280px; 
    min-height: 100vh;
    position: relative;
    z-index: 1;
    transition: margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .sidebar-collapsed .main-content {
    margin-left: 80px;
  }

  /* Top Bar */
  .top-bar {
    position: sticky;
    top: 0;
    z-index: 50;
    margin: 16px 24px;
    padding: 16px 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .page-title {
    font-size: 24px;
    font-weight: 600;
  }

  .top-bar-right {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .time-display {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }

  .time-display .time {
    font-size: 20px;
    font-weight: 600;
    font-family: 'JetBrains Mono', monospace;
    color: #00ff88;
  }

  .time-display .date {
    font-size: 12px;
    color: #71717a;
  }

  .refresh-btn {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    font-size: 20px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .refresh-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    transform: rotate(180deg);
  }

  .content-area {
    padding: 0 24px 24px;
  }

  /* Loading Screen */
  .loading-screen { 
    display: flex; 
    flex-direction: column; 
    align-items: center; 
    justify-content: center; 
    height: 60vh; 
    gap: 24px; 
  }

  .loading-spinner {
    position: relative;
    width: 80px;
    height: 80px;
  }

  .spinner-ring {
    position: absolute;
    width: 100%;
    height: 100%;
    border: 3px solid transparent;
    border-radius: 50%;
  }

  .spinner-ring:nth-child(1) {
    border-top-color: #00ff88;
    animation: spin 1s linear infinite;
  }

  .spinner-ring:nth-child(2) {
    width: 70%;
    height: 70%;
    top: 15%;
    left: 15%;
    border-right-color: #667eea;
    animation: spin 1.5s linear infinite reverse;
  }

  .spinner-ring:nth-child(3) {
    width: 40%;
    height: 40%;
    top: 30%;
    left: 30%;
    border-bottom-color: #ffa502;
    animation: spin 2s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  /* Hero Stats */
  .hero-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 20px;
    margin-bottom: 24px;
  }

  .stat-card {
    position: relative;
    padding: 24px;
    overflow: hidden;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .stat-card:hover {
    transform: translateY(-4px);
  }

  .stat-background {
    position: absolute;
    top: 0;
    right: 0;
    width: 150px;
    height: 150px;
    opacity: 0.1;
  }

  .stat-pattern {
    width: 100%;
    height: 100%;
    background: radial-gradient(circle, currentColor 1px, transparent 1px);
    background-size: 10px 10px;
  }

  .stat-card.gradient-blue { 
    background: linear-gradient(135deg, rgba(102, 126, 234, 0.2), rgba(102, 126, 234, 0.05));
    border-color: rgba(102, 126, 234, 0.3);
  }

  .stat-card.gradient-green { 
    background: linear-gradient(135deg, rgba(0, 255, 136, 0.2), rgba(0, 255, 136, 0.05));
    border-color: rgba(0, 255, 136, 0.3);
  }

  .stat-card.gradient-orange { 
    background: linear-gradient(135deg, rgba(255, 165, 2, 0.2), rgba(255, 165, 2, 0.05));
    border-color: rgba(255, 165, 2, 0.3);
  }

  .stat-card.gradient-purple { 
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(168, 85, 247, 0.05));
    border-color: rgba(168, 85, 247, 0.3);
  }

  .stat-content {
    display: flex;
    align-items: center;
    gap: 16px;
    position: relative;
    z-index: 1;
  }

  .stat-icon-wrap {
    font-size: 40px;
    filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.3));
  }

  .stat-value { 
    font-size: 36px; 
    font-weight: 700; 
    font-family: 'JetBrains Mono', monospace;
    line-height: 1;
  }

  .stat-card.gradient-blue .stat-value { color: #818cf8; }
  .stat-card.gradient-green .stat-value { color: #00ff88; }
  .stat-card.gradient-orange .stat-value { color: #ffa502; }
  .stat-card.gradient-purple .stat-value { color: #a855f7; }

  .stat-label { 
    font-size: 14px; 
    color: #a1a1aa;
    margin-top: 4px;
  }

  .stat-footer {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }

  .trend {
    font-size: 12px;
    color: #71717a;
  }

  .trend.up { color: #00ff88; }

  /* Progress Section */
  .progress-section {
    display: flex;
    align-items: center;
    gap: 40px;
    padding: 32px;
    margin-bottom: 24px;
  }

  .progress-ring-container {
    position: relative;
    flex-shrink: 0;
  }

  .progress-ring {
    transform: rotate(-90deg);
  }

  .progress-ring-bg {
    fill: none;
    stroke: rgba(255, 255, 255, 0.1);
    stroke-width: 10;
  }

  .progress-ring-fill {
    fill: none;
    stroke: url(#progressGradient);
    stroke-width: 10;
    stroke-linecap: round;
    transition: stroke-dasharray 1s ease;
    stroke: #00ff88;
  }

  .progress-text {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    text-align: center;
  }

  .progress-value {
    font-size: 36px;
    font-weight: 700;
    color: #00ff88;
    font-family: 'JetBrains Mono', monospace;
  }

  .progress-label {
    font-size: 12px;
    color: #71717a;
  }

  .progress-details {
    flex: 1;
  }

  .progress-details h3 {
    font-size: 18px;
    margin-bottom: 20px;
  }

  .progress-items {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .progress-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .item-label {
    display: flex;
    align-items: center;
    gap: 10px;
    color: #a1a1aa;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .dot.green { background: #00ff88; }
  .dot.orange { background: #ffa502; }
  .dot.blue { background: #667eea; }

  .item-value {
    font-size: 20px;
    font-weight: 600;
    font-family: 'JetBrains Mono', monospace;
  }

  /* Dashboard Grid */
  .dashboard-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin-bottom: 24px;
  }

  .card {
    overflow: hidden;
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 24px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .card-header h3 {
    font-size: 16px;
    font-weight: 600;
  }

  .btn-icon {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.05);
    border: none;
    color: #a1a1aa;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-icon:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #00ff88;
  }

  .card-content {
    padding: 16px 24px;
    max-height: 350px;
    overflow-y: auto;
  }

  .card-content::-webkit-scrollbar {
    width: 4px;
  }

  .card-content::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
  }

  .empty-state {
    text-align: center;
    padding: 40px 20px;
    color: #71717a;
  }

  .empty-state.full-width {
    grid-column: 1 / -1;
  }

  .empty-icon {
    font-size: 48px;
    display: block;
    margin-bottom: 12px;
    opacity: 0.5;
  }

  /* Driver List */
  .driver-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .driver-row-modern {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px;
    background: rgba(255, 255, 255, 0.02);
    border-radius: 12px;
    transition: all 0.2s;
  }

  .driver-row-modern:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .driver-avatar-sm {
    width: 40px;
    height: 40px;
    background: linear-gradient(135deg, #667eea, #764ba2);
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    position: relative;
    flex-shrink: 0;
  }

  .online-indicator {
    position: absolute;
    bottom: -2px;
    right: -2px;
    width: 12px;
    height: 12px;
    background: #52525b;
    border: 2px solid #0a0a0f;
    border-radius: 50%;
  }

  .online-indicator.active {
    background: #00ff88;
    box-shadow: 0 0 10px #00ff88;
  }

  .driver-details {
    flex: 1;
    min-width: 0;
  }

  .driver-name-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .driver-name-row .name {
    font-weight: 500;
    font-size: 14px;
  }

  .driver-progress-bar {
    height: 4px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #00ff88, #00cc6a);
    border-radius: 2px;
    transition: width 0.5s ease;
  }

  .driver-stats-mini {
    display: flex;
    gap: 8px;
  }

  .driver-stats-mini .stat {
    padding: 4px 10px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    font-family: 'JetBrains Mono', monospace;
  }

  .driver-stats-mini .stat.pending {
    background: rgba(102, 126, 234, 0.2);
    color: #818cf8;
  }

  .driver-stats-mini .stat.completed {
    background: rgba(0, 255, 136, 0.2);
    color: #00ff88;
  }

  /* Activity List */
  .activity-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .activity-row-modern {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px;
    border-radius: 10px;
    transition: all 0.2s;
  }

  .activity-row-modern:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .activity-icon-wrap {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    flex-shrink: 0;
  }

  .activity-icon-wrap.success {
    background: rgba(0, 255, 136, 0.15);
  }

  .activity-icon-wrap.skip {
    background: rgba(255, 165, 2, 0.15);
  }

  .activity-details {
    flex: 1;
    min-width: 0;
  }

  .activity-title {
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .activity-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
  }

  .driver-tag {
    font-size: 11px;
    color: #818cf8;
  }

  .time-tag {
    font-size: 11px;
    color: #71717a;
  }

  /* Summary Card */
  .summary-card {
    padding: 24px;
    margin-bottom: 24px;
  }

  .summary-header {
    margin-bottom: 24px;
  }

  .summary-header h3 {
    font-size: 18px;
  }

  .summary-content {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 40px;
  }

  .summary-item {
    text-align: center;
    padding: 20px 40px;
  }

  .summary-icon {
    font-size: 32px;
    margin-bottom: 12px;
  }

  .summary-value {
    font-size: 40px;
    font-weight: 700;
    font-family: 'JetBrains Mono', monospace;
    color: #e4e4e7;
    margin-bottom: 8px;
  }

  .summary-value.green { color: #00ff88; }
  .summary-value.red { color: #ff6b6b; }

  .summary-label {
    font-size: 14px;
    color: #71717a;
  }

  .summary-divider {
    width: 1px;
    height: 80px;
    background: linear-gradient(180deg, transparent, rgba(255, 255, 255, 0.1), transparent);
  }

  /* Tab Header */
  .tab-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
  }

  .result-count {
    font-size: 14px;
    color: #71717a;
  }

  .header-actions {
    display: flex;
    gap: 12px;
  }

  /* Buttons */
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    border-radius: 12px;
    font-family: 'Kanit', sans-serif;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .btn-primary {
    background: linear-gradient(135deg, #00ff88 0%, #00cc6a 100%);
    color: #000;
    font-weight: 600;
  }

  .btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 255, 136, 0.3);
  }

  .btn-primary.glow {
    box-shadow: 0 0 20px rgba(0, 255, 136, 0.4);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
  }

  .btn-secondary {
    background: rgba(255, 255, 255, 0.05);
    color: #a1a1aa;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .btn-secondary:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .btn-ghost {
    background: transparent;
    color: #a1a1aa;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .btn-ghost:hover {
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
  }

  /* Filters */
  .filters-bar {
    display: flex;
    gap: 16px;
    padding: 16px 20px;
    margin-bottom: 20px;
    flex-wrap: wrap;
  }

  .search-input-wrapper {
    position: relative;
    flex: 1;
    min-width: 250px;
  }

  .search-icon {
    position: absolute;
    left: 14px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 16px;
    opacity: 0.5;
  }

  .search-input-wrapper input {
    width: 100%;
    padding: 12px 16px 12px 42px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    color: #e4e4e7;
    font-family: 'Kanit', sans-serif;
    font-size: 14px;
    transition: all 0.2s;
  }

  .search-input-wrapper input:focus {
    outline: none;
    border-color: #00ff88;
    box-shadow: 0 0 0 3px rgba(0, 255, 136, 0.1);
  }

  .filter-group {
    display: flex;
    gap: 12px;
  }

  .select-wrapper {
    position: relative;
  }

  .select-wrapper select {
    appearance: none;
    padding: 12px 40px 12px 16px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    color: #e4e4e7;
    font-family: 'Kanit', sans-serif;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .select-wrapper select:focus {
    outline: none;
    border-color: #00ff88;
  }

  .select-wrapper::after {
    content: '▼';
    position: absolute;
    right: 14px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 10px;
    color: #71717a;
    pointer-events: none;
  }

  /* Table */
  .table-container {
    overflow: hidden;
  }

  .modern-table {
    width: 100%;
    border-collapse: collapse;
  }

  .modern-table th,
  .modern-table td {
    padding: 16px 20px;
    text-align: left;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .modern-table th {
    background: rgba(0, 0, 0, 0.2);
    font-size: 11px;
    font-weight: 600;
    color: #71717a;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .modern-table tbody tr {
    transition: all 0.2s;
  }

  .modern-table tbody tr:hover {
    background: rgba(255, 255, 255, 0.02);
  }

  .modern-table tbody tr.selected {
    background: rgba(0, 255, 136, 0.08);
  }

  .checkbox-col {
    width: 50px;
    text-align: center;
  }

  .custom-checkbox {
    position: relative;
    display: inline-block;
    width: 20px;
    height: 20px;
    cursor: pointer;
  }

  .custom-checkbox input {
    opacity: 0;
    position: absolute;
  }

  .checkmark {
    position: absolute;
    top: 0;
    left: 0;
    width: 20px;
    height: 20px;
    background: rgba(255, 255, 255, 0.05);
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    transition: all 0.2s;
  }

  .custom-checkbox input:checked ~ .checkmark {
    background: #00ff88;
    border-color: #00ff88;
  }

  .custom-checkbox input:checked ~ .checkmark::after {
    content: '✓';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 12px;
    color: #000;
    font-weight: 700;
  }

  .row-number {
    display: inline-block;
    width: 28px;
    height: 28px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    text-align: center;
    line-height: 28px;
    font-size: 12px;
    font-weight: 600;
    color: #71717a;
  }

  .name-col {
    max-width: 200px;
  }

  .point-name {
    font-weight: 500;
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .address-col {
    max-width: 250px;
  }

  .address-text {
    font-size: 13px;
    color: #a1a1aa;
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .driver-chip {
    display: inline-block;
    padding: 6px 12px;
    background: rgba(102, 126, 234, 0.2);
    color: #818cf8;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 500;
  }

  .unassigned-chip {
    display: inline-block;
    padding: 6px 12px;
    background: rgba(255, 107, 107, 0.2);
    color: #ff6b6b;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 500;
  }

  .priority-chip {
    display: inline-block;
    padding: 6px 12px;
    border-radius: 8px;
    font-size: 11px;
    font-weight: 600;
  }

  .priority-chip.p1 { background: rgba(255, 107, 107, 0.2); color: #ff6b6b; }
  .priority-chip.p2 { background: rgba(255, 165, 2, 0.2); color: #ffa502; }
  .priority-chip.p3 { background: rgba(102, 126, 234, 0.2); color: #818cf8; }
  .priority-chip.p4 { background: rgba(168, 85, 247, 0.2); color: #a855f7; }
  .priority-chip.p5 { background: rgba(107, 114, 128, 0.2); color: #9ca3af; }

  .status-chip {
    display: inline-block;
    padding: 6px 12px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 500;
  }

  .status-chip.completed {
    background: rgba(0, 255, 136, 0.2);
    color: #00ff88;
  }

  .status-chip.skipped {
    background: rgba(255, 165, 2, 0.2);
    color: #ffa502;
  }

  .action-btn {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.05);
    border: none;
    cursor: pointer;
    font-size: 16px;
    transition: all 0.2s;
  }

  .action-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    transform: scale(1.1);
  }

  .time-col {
    white-space: nowrap;
  }

  .time-display-cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .time-display-cell .time {
    font-family: 'JetBrains Mono', monospace;
    font-weight: 500;
  }

  .time-display-cell .date {
    font-size: 11px;
    color: #71717a;
  }

  /* Customer Orders Grid */
  .orders-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
    gap: 20px;
  }

  .order-card {
    padding: 20px;
    transition: all 0.3s;
  }

  .order-card:hover {
    transform: translateY(-4px);
  }

  .order-card.pending {
    border-color: rgba(255, 165, 2, 0.3);
    background: linear-gradient(135deg, rgba(255, 165, 2, 0.1), rgba(255, 165, 2, 0.02));
  }

  .order-card.accepted {
    border-color: rgba(0, 255, 136, 0.3);
    background: linear-gradient(135deg, rgba(0, 255, 136, 0.1), rgba(0, 255, 136, 0.02));
  }

  .order-card.completed {
    border-color: rgba(107, 114, 128, 0.3);
    opacity: 0.7;
  }

  .order-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 16px;
  }

  .customer-info {
    display: flex;
    gap: 12px;
    align-items: center;
  }

  .customer-avatar {
    width: 44px;
    height: 44px;
    background: linear-gradient(135deg, #8b5cf6, #6d28d9);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
  }

  .customer-name {
    font-weight: 600;
    font-size: 15px;
  }

  .customer-phone {
    font-size: 13px;
    color: #71717a;
  }

  .order-status {
    padding: 6px 12px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 600;
  }

  .order-status.pending {
    background: rgba(255, 165, 2, 0.2);
    color: #ffa502;
  }

  .order-status.accepted {
    background: rgba(0, 255, 136, 0.2);
    color: #00ff88;
  }

  .order-status.completed {
    background: rgba(107, 114, 128, 0.2);
    color: #9ca3af;
  }

  .order-address {
    font-size: 13px;
    color: #a1a1aa;
    padding: 12px;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 10px;
    margin-bottom: 12px;
  }

  .order-driver {
    font-size: 13px;
    color: #818cf8;
    margin-bottom: 8px;
  }

  .order-time {
    font-size: 12px;
    color: #71717a;
  }

  /* Drivers Grid Modern */
  .drivers-grid-modern {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(700px, 1fr));
    gap: 24px;
  }

  .driver-card-modern {
    padding: 24px;
    transition: all 0.3s;
  }

  .driver-card-modern:hover {
    transform: translateY(-4px);
    border-color: rgba(102, 126, 234, 0.4);
  }

  .driver-card-header {
    display: flex;
    gap: 16px;
    margin-bottom: 20px;
  }

  .driver-avatar-large {
    width: 64px;
    height: 64px;
    background: linear-gradient(135deg, #667eea, #764ba2);
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 32px;
    position: relative;
    box-shadow: 0 8px 24px rgba(102, 126, 234, 0.3);
  }

  .status-indicator {
    position: absolute;
    bottom: -4px;
    right: -4px;
    width: 18px;
    height: 18px;
    background: #52525b;
    border: 3px solid #0a0a0f;
    border-radius: 50%;
  }

  .status-indicator.active {
    background: #00ff88;
    box-shadow: 0 0 12px #00ff88;
  }

  .driver-main-info h3 {
    font-size: 20px;
    font-weight: 600;
    margin-bottom: 4px;
  }

  .vehicle-info {
    font-size: 13px;
    color: #71717a;
  }

  .driver-stats-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 20px;
  }

  .stat-box {
    padding: 16px;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 12px;
    text-align: center;
  }

  .stat-box.pending {
    border: 1px solid rgba(102, 126, 234, 0.3);
  }

  .stat-box.completed {
    border: 1px solid rgba(0, 255, 136, 0.3);
  }

  .stat-number {
    font-size: 28px;
    font-weight: 700;
    font-family: 'JetBrains Mono', monospace;
  }

  .stat-box.pending .stat-number { color: #818cf8; }
  .stat-box.completed .stat-number { color: #00ff88; }

  .stat-text {
    font-size: 12px;
    color: #71717a;
    margin-top: 4px;
  }

  .driver-contact-info {
    padding-top: 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .contact-item {
    font-size: 14px;
    color: #a1a1aa;
  }

  /* Modal */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(8px);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeIn 0.2s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .modal {
    width: 420px;
    padding: 32px;
    animation: slideUp 0.3s ease;
  }

  @keyframes slideUp {
    from { transform: translateY(20px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  .modal-header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 8px;
  }

  .modal-icon {
    width: 48px;
    height: 48px;
    background: linear-gradient(135deg, #00ff88, #00cc6a);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
  }

  .modal h3 {
    font-size: 20px;
    font-weight: 600;
  }

  .modal-subtitle {
    font-size: 14px;
    color: #71717a;
    margin-bottom: 24px;
    margin-left: 64px;
  }

  .form-group {
    margin-bottom: 24px;
  }

  .form-group label {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: #a1a1aa;
    margin-bottom: 10px;
  }

  .form-group .select-wrapper {
    width: 100%;
  }

  .form-group .select-wrapper select {
    width: 100%;
  }

  .modal-actions {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
  }

  /* Toast */
  .toast {
    position: fixed;
    top: 24px;
    right: 24px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 24px;
    border-radius: 14px;
    font-size: 14px;
    font-weight: 500;
    z-index: 2000;
    animation: toastIn 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    backdrop-filter: blur(20px);
  }

  .toast.success {
    background: rgba(0, 255, 136, 0.15);
    border: 1px solid rgba(0, 255, 136, 0.3);
    color: #00ff88;
  }

  .toast.error {
    background: rgba(255, 107, 107, 0.15);
    border: 1px solid rgba(255, 107, 107, 0.3);
    color: #ff6b6b;
  }

  @keyframes toastIn {
    from { transform: translateX(100px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }

  /* Responsive */
  @media (max-width: 1400px) {
    .hero-stats {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 1200px) {
    .dashboard-grid {
      grid-template-columns: 1fr;
    }
    
    .progress-section {
      flex-direction: column;
      text-align: center;
    }
    
    .summary-content {
      flex-direction: column;
      gap: 20px;
    }
    
    .summary-divider {
      width: 100%;
      height: 1px;
    }
  }

  @media (max-width: 768px) {
    .sidebar {
      position: fixed;
      transform: translateX(-100%);
      z-index: 1000;
    }
    
    .sidebar.open {
      transform: translateX(0);
    }
    
    .main-content {
      margin-left: 0;
    }
    
    .hero-stats {
      grid-template-columns: 1fr;
    }
    
    .filters-bar {
      flex-direction: column;
    }
    
    .search-input-wrapper {
      min-width: 100%;
    }
    
    .filter-group {
      width: 100%;
    }
    
    .filter-group .select-wrapper {
      flex: 1;
    }
    
    .filter-group .select-wrapper select {
      width: 100%;
    }
    
    .orders-grid,
    .drivers-grid-modern {
      grid-template-columns: 1fr;
    }
  }
</style>