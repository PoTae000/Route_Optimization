<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';

  const API_URL = 'https://api.suepskun.online/api';

  let currentUser: any = null;

  // Data
  let allPoints: any[] = [];
  let deliveryHistory: any[] = [];
  let todayStats = { completed: 0, skipped: 0, pending: 0 };
  let dashboardUsers: any[] = []; // per_user from dashboard
  let recentActivity: any[] = [];
  let totalUsers = 0;
  let users: any[] = [];

  // UI State
  let activeTab: 'overview' | 'points' | 'history' | 'users' = 'overview';
  let selectedPoints: number[] = [];
  let showAssignModal = false;
  let selectedDriver: number | null = null;
  let isLoading = true;
  let notification = { show: false, message: '', type: 'success' as 'success' | 'error' };
  let sidebarCollapsed = false;
  let currentTime = new Date();
  let nightMode = true;

  // Users CRUD
  let showUserModal = false;
  let editingUser: any = null;
  let userForm = { username: '', password: '', name: '', role: 'User', phone: '', avatar: '' };
  let showDeleteConfirm: number | null = null;

  // Filters
  let filterStatus: 'all' | 'pending' | 'completed' | 'skipped' = 'all';
  let filterDriver: number | null = null;
  let searchQuery = '';

  // Auto refresh
  let refreshInterval: any;
  let timeInterval: any;

  const adminHeaders = () => ({
    'Content-Type': 'application/json',
    'x-user-id': String(currentUser?.id || '')
  });

  onMount(async () => {
    const userStr = localStorage.getItem('user');
    if (!userStr) {
      goto('/');
      return;
    }

    try {
      currentUser = JSON.parse(userStr);
    } catch {
      goto('/');
      return;
    }

    if (currentUser.role?.toLowerCase() !== 'admin') {
      goto(`/User/${currentUser.id}`);
      return;
    }

    const urlId = $page.params.id;
    if (Number(urlId) !== currentUser.id) {
      goto(`/Admin/${currentUser.id}`);
      return;
    }

    // Load night mode preference
    const savedMode = localStorage.getItem('adminNightMode');
    if (savedMode === 'light') nightMode = false;

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
      loadDashboard(),
      loadAllPoints(),
      loadDeliveryHistory(),
      loadUsers()
    ]);
  }

  async function loadDashboard() {
    try {
      const res = await fetch(`${API_URL}/admin/dashboard`, {
        headers: adminHeaders()
      });
      const data = await res.json();
      if (data.today) {
        todayStats = data.today;
      }
      if (Array.isArray(data.per_user)) {
        dashboardUsers = data.per_user;
      }
      if (Array.isArray(data.recent_activity)) {
        recentActivity = data.recent_activity;
      }
      if (data.total_users !== undefined) {
        totalUsers = data.total_users;
      }
    } catch (e) { console.error('Load dashboard error:', e); }
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

  async function loadUsers() {
    try {
      const res = await fetch(`${API_URL}/admin/users`, {
        headers: adminHeaders()
      });
      const data = await res.json();
      if (Array.isArray(data)) users = data;
    } catch (e) { console.error('Load users error:', e); }
  }

  async function createUser() {
    try {
      const res = await fetch(`${API_URL}/admin/users`, {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify(userForm)
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      showNotification('สร้างผู้ใช้สำเร็จ', 'success');
      showUserModal = false;
      editingUser = null;
      await loadUsers();
    } catch (e: any) {
      showNotification(`เกิดข้อผิดพลาด: ${e.message}`, 'error');
    }
  }

  async function updateUser(id: number) {
    try {
      const body: any = { ...userForm };
      if (!body.password) delete body.password;
      const res = await fetch(`${API_URL}/admin/users/${id}`, {
        method: 'PUT',
        headers: adminHeaders(),
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      showNotification('แก้ไขผู้ใช้สำเร็จ', 'success');
      showUserModal = false;
      editingUser = null;
      await loadUsers();
    } catch (e: any) {
      showNotification(`เกิดข้อผิดพลาด: ${e.message}`, 'error');
    }
  }

  async function deleteUser(id: number) {
    try {
      const res = await fetch(`${API_URL}/admin/users/${id}`, {
        method: 'DELETE',
        headers: adminHeaders()
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      showNotification('ลบผู้ใช้สำเร็จ', 'success');
      showDeleteConfirm = null;
      await loadUsers();
    } catch (e: any) {
      showNotification(`เกิดข้อผิดพลาด: ${e.message}`, 'error');
    }
  }

  function openCreateModal() {
    editingUser = null;
    userForm = { username: '', password: '', name: '', role: 'User', phone: '', avatar: '' };
    showUserModal = true;
  }

  function openEditModal(user: any) {
    editingUser = user;
    userForm = {
      username: user.username || '',
      password: '',
      name: user.name || '',
      role: user.role || 'User',
      phone: user.phone || '',
      avatar: user.avatar || ''
    };
    showUserModal = true;
  }

  function saveUser() {
    if (editingUser) {
      updateUser(editingUser.id);
    } else {
      createUser();
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
        headers: adminHeaders(),
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
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  }

  function formatDate(dateStr: string): string {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
  }

  function toggleNightMode() {
    nightMode = !nightMode;
    localStorage.setItem('adminNightMode', nightMode ? 'dark' : 'light');
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
      filtered = filtered.filter(p => p.name?.toLowerCase().includes(q) || p.address?.toLowerCase().includes(q));
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
  $: usersWithWork = dashboardUsers.filter(d => (d.completed || 0) + (d.skipped || 0) > 0).length;
</script>

<svelte:head>
  <title>แอดมิน | Route Optimization</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
</svelte:head>

<div class="admin-container" class:sidebar-collapsed={sidebarCollapsed} class:day-mode={!nightMode}>
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
      <!-- svelte-ignore a11y_interactive_supports_focus -->
      <div class="modal glass-card" on:click|stopPropagation on:keypress={() => {}} role="dialog">
        <div class="modal-header">
          <div class="modal-icon">📦</div>
          <h3>มอบหมายงาน</h3>
        </div>
        <p class="modal-subtitle">{selectedPoints.length} จุดที่เลือก</p>

        <div class="form-group">
          <label for="driver-select">เลือกผู้ใช้</label>
          <div class="select-wrapper">
            <select id="driver-select" bind:value={selectedDriver}>
              <option value={null}>-- เลือกผู้ใช้ --</option>
              {#each users as user}
                <option value={user.id}>{user.avatar || '👤'} {user.name}</option>
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

  <!-- User CRUD Modal -->
  {#if showUserModal}
    <div class="modal-overlay" on:click={() => showUserModal = false} on:keypress={() => {}} role="button" tabindex="-1">
      <!-- svelte-ignore a11y_interactive_supports_focus -->
      <div class="modal glass-card modal-wide" on:click|stopPropagation on:keypress={() => {}} role="dialog">
        <div class="modal-header">
          <div class="modal-icon">{editingUser ? '✏️' : '➕'}</div>
          <h3>{editingUser ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้ใหม่'}</h3>
        </div>

        <div class="user-form-grid">
          <div class="form-group">
            <label for="user-username">ชื่อผู้ใช้ (username)</label>
            <input id="user-username" type="text" bind:value={userForm.username} placeholder="username">
          </div>
          <div class="form-group">
            <label for="user-password">{editingUser ? 'รหัสผ่าน (เว้นว่างถ้าไม่เปลี่ยน)' : 'รหัสผ่าน'}</label>
            <input id="user-password" type="password" bind:value={userForm.password} placeholder="••••••">
          </div>
          <div class="form-group">
            <label for="user-name">ชื่อ</label>
            <input id="user-name" type="text" bind:value={userForm.name} placeholder="ชื่อ-นามสกุล">
          </div>
          <div class="form-group">
            <label for="user-role">ตำแหน่ง</label>
            <div class="select-wrapper">
              <select id="user-role" bind:value={userForm.role}>
                <option value="User">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label for="user-phone">โทรศัพท์</label>
            <input id="user-phone" type="text" bind:value={userForm.phone} placeholder="0xx-xxx-xxxx">
          </div>
          <div class="form-group">
            <label for="user-avatar">Avatar (emoji)</label>
            <input id="user-avatar" type="text" bind:value={userForm.avatar} placeholder="👤">
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn btn-primary" on:click={saveUser} disabled={!userForm.username || (!editingUser && !userForm.password)}>
            <span>{editingUser ? '✓' : '+'}</span> {editingUser ? 'บันทึก' : 'สร้าง'}
          </button>
          <button class="btn btn-ghost" on:click={() => showUserModal = false}>
            ยกเลิก
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Delete Confirm Modal -->
  {#if showDeleteConfirm !== null}
    {@const userToDelete = users.find(u => u.id === showDeleteConfirm)}
    <div class="modal-overlay" on:click={() => showDeleteConfirm = null} on:keypress={() => {}} role="button" tabindex="-1">
      <!-- svelte-ignore a11y_interactive_supports_focus -->
      <div class="modal glass-card" on:click|stopPropagation on:keypress={() => {}} role="dialog">
        <div class="modal-header">
          <div class="modal-icon delete-icon">🗑️</div>
          <h3>ยืนยันการลบ</h3>
        </div>
        <p class="modal-subtitle">คุณต้องการลบผู้ใช้ "{userToDelete?.name || userToDelete?.username}" ใช่หรือไม่?</p>
        <div class="modal-actions">
          <button class="btn btn-danger" on:click={() => deleteUser(showDeleteConfirm!)}>
            <span>🗑️</span> ลบ
          </button>
          <button class="btn btn-ghost" on:click={() => showDeleteConfirm = null}>
            ยกเลิก
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Sidebar -->
  <aside class="sidebar glass-sidebar">
    <!-- svelte-ignore element_implicitly_closed -->
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

      <button class="nav-item" class:active={activeTab === 'history'} on:click={() => activeTab = 'history'}>
        <span class="nav-icon">📋</span>
        {#if !sidebarCollapsed}<span class="nav-text">ประวัติการส่ง</span>{/if}
      </button>

      <button class="nav-item" class:active={activeTab === 'users'} on:click={() => activeTab = 'users'}>
        <span class="nav-icon">👥</span>
        {#if !sidebarCollapsed}<span class="nav-text">ผู้ใช้</span>{/if}
        {#if users.length > 0}
          <span class="badge info">{users.length}</span>
        {/if}
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
          {#if activeTab === 'history'}📋 ประวัติการส่ง{/if}
          {#if activeTab === 'users'}👥 ผู้ใช้ทั้งหมด{/if}
        </h2>
      </div>
      <div class="top-bar-right">
        <div class="time-display">
          <span class="time">{currentTime.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</span>
          <span class="date">{currentTime.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
        </div>
        <button class="theme-toggle-btn" on:click={toggleNightMode} title={nightMode ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'}>
          {nightMode ? '☀️' : '🌙'}
        </button>
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
                <div class="stat-icon-wrap">👥</div>
                <div class="stat-info">
                  <div class="stat-value">{totalUsers || users.length}</div>
                  <div class="stat-label">ผู้ใช้ทั้งหมด</div>
                </div>
              </div>
              <div class="stat-footer">
                <span class="trend">{usersWithWork} คนมีงานวันนี้</span>
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
            <!-- User Status -->
            <div class="card glass-card">
              <div class="card-header">
                <h3>👥 สถานะผู้ใช้</h3>
                <button class="btn-icon" on:click={() => activeTab = 'users'}>→</button>
              </div>
              <div class="card-content">
                {#if dashboardUsers.length === 0}
                  <div class="empty-state">
                    <span class="empty-icon">👥</span>
                    <p>ไม่มีข้อมูลผู้ใช้</p>
                  </div>
                {:else}
                  <div class="driver-list">
                    {#each dashboardUsers as user}
                      <div class="driver-row-modern">
                        <div class="driver-avatar-sm">
                          <span>{user.avatar || '👤'}</span>
                          <div class="online-indicator" class:active={(user.completed || 0) + (user.skipped || 0) > 0}></div>
                        </div>
                        <div class="driver-details">
                          <div class="driver-name-row">
                            <span class="name">{user.name}</span>
                          </div>
                          <div class="driver-progress-bar">
                            <div class="progress-fill" style="width: {(user.completed || 0) + (user.skipped || 0) > 0 ? Math.min(((user.completed || 0) / ((user.completed || 0) + (user.skipped || 0))) * 100, 100) : 0}%"></div>
                          </div>
                        </div>
                        <div class="driver-stats-mini">
                          <span class="stat completed">{user.completed || 0}</span>
                          <span class="stat skipped">{user.skipped || 0}</span>
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
                {#if recentActivity.length === 0 && deliveryHistory.length === 0}
                  <div class="empty-state">
                    <span class="empty-icon">📋</span>
                    <p>ยังไม่มีกิจกรรม</p>
                  </div>
                {:else}
                  <div class="activity-list">
                    {#each (recentActivity.length > 0 ? recentActivity : deliveryHistory).slice(0, 8) as record}
                      <div class="activity-row-modern">
                        <div class="activity-icon-wrap" class:success={record.status === 'completed'} class:skip={record.status === 'skipped'}>
                          {record.status === 'completed' ? '✅' : '⏭️'}
                        </div>
                        <div class="activity-details">
                          <div class="activity-title">{record.point_name}</div>
                          <div class="activity-meta">
                            <span class="driver-tag">{record.user_name || record.driver_name || 'ไม่ระบุ'}</span>
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
                  <option value={null}>👤 ผู้ใช้ทั้งหมด</option>
                  <option value={0}>⏳ ยังไม่ assign</option>
                  {#each users as user}
                    <option value={user.id}>{user.avatar || '👤'} {user.name}</option>
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
                  <th>ผู้รับผิดชอบ</th>
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
                  <option value={null}>👤 ผู้ใช้ทั้งหมด</option>
                  {#each users as user}
                    <option value={user.id}>{user.avatar || '👤'} {user.name}</option>
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
                  <th>ผู้ส่ง</th>
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

        <!-- Users Tab -->
        {#if activeTab === 'users'}
          <div class="tab-header">
            <div class="header-left">
              <span class="result-count">{users.length} ผู้ใช้</span>
            </div>
            <div class="header-actions">
              <button class="btn btn-primary" on:click={openCreateModal}>
                <span>+</span> เพิ่มผู้ใช้
              </button>
            </div>
          </div>

          <div class="users-grid">
            {#each users as user}
              <div class="user-card-modern glass-card">
                <div class="user-card-header-row">
                  <div class="user-avatar-large">
                    <span>{user.avatar || '👤'}</span>
                  </div>
                  <div class="user-main-info">
                    <h3>{user.name || user.username}</h3>
                    <p class="user-username">@{user.username}</p>
                    <span class="role-chip" class:admin={user.role === 'admin'}>{user.role === 'admin' ? 'Admin' : 'User'}</span>
                  </div>
                  <div class="user-card-actions">
                    <button class="action-btn" on:click={() => openEditModal(user)} title="แก้ไข">✏️</button>
                    {#if user.id !== currentUser?.id}
                      <button class="action-btn delete" on:click={() => showDeleteConfirm = user.id} title="ลบ">🗑️</button>
                    {/if}
                  </div>
                </div>

                {#if user.phone}
                  <div class="user-contact">📞 {user.phone}</div>
                {/if}

                <div class="user-stats-row">
                  <div class="stat-box pending">
                    <div class="stat-number">{user.pending_points ?? 0}</div>
                    <div class="stat-text">รอส่ง</div>
                  </div>
                  <div class="stat-box completed">
                    <div class="stat-number">{user.today_completed ?? 0}</div>
                    <div class="stat-text">เสร็จวันนี้</div>
                  </div>
                  <div class="stat-box skipped">
                    <div class="stat-number">{user.today_skipped ?? 0}</div>
                    <div class="stat-text">ข้ามวันนี้</div>
                  </div>
                </div>
              </div>
            {:else}
              <div class="empty-state full-width">
                <span class="empty-icon">👥</span>
                <p>ยังไม่มีผู้ใช้</p>
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

  .badge.info {
    background: linear-gradient(135deg, #667eea, #764ba2);
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

  .theme-toggle-btn,
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

  .theme-toggle-btn:hover,
  .refresh-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .refresh-btn:hover {
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

  /* Driver/User List in Overview */
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

  .driver-stats-mini .stat.completed {
    background: rgba(0, 255, 136, 0.2);
    color: #00ff88;
  }

  .driver-stats-mini .stat.skipped {
    background: rgba(255, 165, 2, 0.2);
    color: #ffa502;
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

  .btn-danger {
    background: linear-gradient(135deg, #ff6b6b, #ee5a5a);
    color: #fff;
    font-weight: 600;
  }

  .btn-danger:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(255, 107, 107, 0.3);
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

  .action-btn.delete:hover {
    background: rgba(255, 107, 107, 0.2);
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

  /* Users Grid */
  .users-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
    gap: 24px;
  }

  .user-card-modern {
    padding: 24px;
    transition: all 0.3s;
  }

  .user-card-modern:hover {
    transform: translateY(-4px);
    border-color: rgba(102, 126, 234, 0.4);
  }

  .user-card-header-row {
    display: flex;
    gap: 16px;
    align-items: flex-start;
    margin-bottom: 16px;
  }

  .user-avatar-large {
    width: 56px;
    height: 56px;
    background: linear-gradient(135deg, #667eea, #764ba2);
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
    flex-shrink: 0;
    box-shadow: 0 8px 24px rgba(102, 126, 234, 0.3);
  }

  .user-main-info {
    flex: 1;
    min-width: 0;
  }

  .user-main-info h3 {
    font-size: 18px;
    font-weight: 600;
    margin-bottom: 2px;
  }

  .user-username {
    font-size: 13px;
    color: #71717a;
    margin-bottom: 6px;
  }

  .role-chip {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
    background: rgba(102, 126, 234, 0.2);
    color: #818cf8;
  }

  .role-chip.admin {
    background: rgba(0, 255, 136, 0.2);
    color: #00ff88;
  }

  .user-card-actions {
    display: flex;
    gap: 8px;
  }

  .user-contact {
    font-size: 13px;
    color: #a1a1aa;
    margin-bottom: 16px;
  }

  .user-stats-row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 12px;
  }

  .stat-box {
    padding: 14px;
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

  .stat-box.skipped {
    border: 1px solid rgba(255, 165, 2, 0.3);
  }

  .stat-number {
    font-size: 24px;
    font-weight: 700;
    font-family: 'JetBrains Mono', monospace;
  }

  .stat-box.pending .stat-number { color: #818cf8; }
  .stat-box.completed .stat-number { color: #00ff88; }
  .stat-box.skipped .stat-number { color: #ffa502; }

  .stat-text {
    font-size: 12px;
    color: #71717a;
    margin-top: 4px;
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

  .modal.modal-wide {
    width: 520px;
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

  .modal-icon.delete-icon {
    background: linear-gradient(135deg, #ff6b6b, #ee5a5a);
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

  .user-form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 24px;
  }

  .form-group {
    margin-bottom: 0;
  }

  .form-group label {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: #a1a1aa;
    margin-bottom: 8px;
  }

  .form-group input {
    width: 100%;
    padding: 12px 16px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    color: #e4e4e7;
    font-family: 'Kanit', sans-serif;
    font-size: 14px;
    transition: all 0.2s;
  }

  .form-group input:focus {
    outline: none;
    border-color: #00ff88;
    box-shadow: 0 0 0 3px rgba(0, 255, 136, 0.1);
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

  /* ═══════════════════════════════════════════════════ */
  /* ═══ DAY MODE (Light Theme) ═══ */
  /* ═══════════════════════════════════════════════════ */

  .day-mode {
    color: #1e293b;
  }

  :global(.admin-container.day-mode ~ body),
  .day-mode :global(body) {
    background: #edf2f7;
    color: #1e293b;
  }

  .day-mode .bg-gradient {
    background:
      radial-gradient(ellipse at 20% 20%, rgba(59, 130, 246, 0.08) 0%, transparent 50%),
      radial-gradient(ellipse at 80% 80%, rgba(99, 102, 241, 0.06) 0%, transparent 50%),
      radial-gradient(ellipse at 50% 50%, rgba(59, 130, 246, 0.03) 0%, transparent 50%);
  }

  .day-mode .bg-grid {
    background-image:
      linear-gradient(rgba(0, 0, 0, 0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(0, 0, 0, 0.03) 1px, transparent 1px);
  }

  .day-mode .glass-card {
    background: rgba(255, 255, 255, 0.85);
    border-color: rgba(59, 130, 246, 0.1);
    box-shadow: 0 4px 24px rgba(30, 64, 175, 0.06);
  }

  .day-mode .glass-sidebar {
    background: rgba(255, 255, 255, 0.92);
    border-right-color: rgba(59, 130, 246, 0.1);
  }

  /* Sidebar day mode */
  .day-mode .user-card.glass-card {
    background: rgba(248, 250, 252, 0.9);
  }

  .day-mode .user-avatar {
    box-shadow: 0 4px 20px rgba(59, 130, 246, 0.2);
  }

  .day-mode .status-dot {
    border-color: #f8fafc;
    background: #2563eb;
  }

  .day-mode .user-name { color: #1e293b; }

  .day-mode .role-badge {
    background: linear-gradient(135deg, rgba(37, 99, 235, 0.1), rgba(59, 130, 246, 0.1));
    border-color: rgba(37, 99, 235, 0.2);
    color: #2563eb;
  }

  .day-mode .nav-section-title { color: #94a3b8; }

  .day-mode .nav-item {
    color: #64748b;
  }

  .day-mode .nav-item::before {
    background: linear-gradient(180deg, #2563eb, #3b82f6);
  }

  .day-mode .nav-item:hover {
    background: rgba(59, 130, 246, 0.06);
    color: #1e293b;
  }

  .day-mode .nav-item.active {
    background: rgba(37, 99, 235, 0.08);
    color: #2563eb;
  }

  .day-mode .badge {
    background: linear-gradient(135deg, #ef4444, #dc2626);
  }

  .day-mode .badge.info {
    background: linear-gradient(135deg, #2563eb, #3b82f6);
  }

  .day-mode .sidebar-footer {
    border-top-color: rgba(59, 130, 246, 0.08);
  }

  .day-mode .logout-btn {
    background: rgba(239, 68, 68, 0.06);
    border-color: rgba(239, 68, 68, 0.15);
    color: #ef4444;
  }

  .day-mode .logout-btn:hover {
    background: rgba(239, 68, 68, 0.12);
  }

  /* Top bar day mode */
  .day-mode .page-title { color: #1e293b; }

  .day-mode .time-display .time {
    color: #2563eb;
  }

  .day-mode .time-display .date { color: #94a3b8; }

  .day-mode .theme-toggle-btn,
  .day-mode .refresh-btn {
    background: rgba(255, 255, 255, 0.9);
    border-color: rgba(59, 130, 246, 0.1);
  }

  .day-mode .theme-toggle-btn:hover,
  .day-mode .refresh-btn:hover {
    background: rgba(59, 130, 246, 0.08);
  }

  /* Stat cards day mode */
  .day-mode .stat-card.gradient-blue {
    background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(255, 255, 255, 0.9));
    border-color: rgba(59, 130, 246, 0.15);
  }

  .day-mode .stat-card.gradient-green {
    background: linear-gradient(135deg, rgba(34, 197, 94, 0.1), rgba(255, 255, 255, 0.9));
    border-color: rgba(34, 197, 94, 0.15);
  }

  .day-mode .stat-card.gradient-orange {
    background: linear-gradient(135deg, rgba(245, 158, 11, 0.1), rgba(255, 255, 255, 0.9));
    border-color: rgba(245, 158, 11, 0.15);
  }

  .day-mode .stat-card.gradient-purple {
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(255, 255, 255, 0.9));
    border-color: rgba(139, 92, 246, 0.15);
  }

  .day-mode .stat-card.gradient-blue .stat-value { color: #2563eb; }
  .day-mode .stat-card.gradient-green .stat-value { color: #16a34a; }
  .day-mode .stat-card.gradient-orange .stat-value { color: #d97706; }
  .day-mode .stat-card.gradient-purple .stat-value { color: #7c3aed; }

  .day-mode .stat-label { color: #64748b; }

  .day-mode .stat-footer {
    border-top-color: rgba(59, 130, 246, 0.08);
  }

  .day-mode .trend { color: #94a3b8; }
  .day-mode .trend.up { color: #16a34a; }

  /* Progress section day mode */
  .day-mode .progress-ring-bg {
    stroke: rgba(59, 130, 246, 0.1);
  }

  .day-mode .progress-ring-fill {
    stroke: #2563eb;
  }

  .day-mode .progress-value { color: #2563eb; }
  .day-mode .progress-label { color: #94a3b8; }
  .day-mode .progress-details h3 { color: #1e293b; }
  .day-mode .item-label { color: #64748b; }
  .day-mode .item-value { color: #1e293b; }
  .day-mode .dot.green { background: #16a34a; }
  .day-mode .dot.orange { background: #d97706; }
  .day-mode .dot.blue { background: #2563eb; }

  /* Dashboard grid day mode */
  .day-mode .card-header {
    border-bottom-color: rgba(59, 130, 246, 0.08);
  }

  .day-mode .card-header h3 { color: #1e293b; }

  .day-mode .btn-icon {
    background: rgba(59, 130, 246, 0.06);
    color: #64748b;
  }

  .day-mode .btn-icon:hover {
    background: rgba(59, 130, 246, 0.12);
    color: #2563eb;
  }

  .day-mode .empty-state { color: #94a3b8; }

  .day-mode .driver-row-modern {
    background: rgba(248, 250, 252, 0.8);
  }

  .day-mode .driver-row-modern:hover {
    background: rgba(59, 130, 246, 0.04);
  }

  .day-mode .online-indicator {
    background: #cbd5e1;
    border-color: #fff;
  }

  .day-mode .online-indicator.active {
    background: #2563eb;
    box-shadow: 0 0 10px rgba(37, 99, 235, 0.4);
  }

  .day-mode .driver-name-row .name { color: #1e293b; }

  .day-mode .driver-progress-bar {
    background: rgba(59, 130, 246, 0.1);
  }

  .day-mode .progress-fill {
    background: linear-gradient(90deg, #2563eb, #3b82f6);
  }

  .day-mode .driver-stats-mini .stat.completed {
    background: rgba(34, 197, 94, 0.1);
    color: #16a34a;
  }

  .day-mode .driver-stats-mini .stat.skipped {
    background: rgba(245, 158, 11, 0.1);
    color: #d97706;
  }

  /* Activity list day mode */
  .day-mode .activity-row-modern:hover {
    background: rgba(59, 130, 246, 0.03);
  }

  .day-mode .activity-icon-wrap.success {
    background: rgba(34, 197, 94, 0.1);
  }

  .day-mode .activity-icon-wrap.skip {
    background: rgba(245, 158, 11, 0.1);
  }

  .day-mode .activity-title { color: #1e293b; }
  .day-mode .driver-tag { color: #2563eb; }
  .day-mode .time-tag { color: #94a3b8; }

  /* Summary card day mode */
  .day-mode .summary-header h3 { color: #1e293b; }
  .day-mode .summary-value { color: #1e293b; }
  .day-mode .summary-value.green { color: #16a34a; }
  .day-mode .summary-value.red { color: #ef4444; }
  .day-mode .summary-label { color: #64748b; }

  .day-mode .summary-divider {
    background: linear-gradient(180deg, transparent, rgba(59, 130, 246, 0.12), transparent);
  }

  /* Tab header day mode */
  .day-mode .result-count { color: #94a3b8; }

  /* Buttons day mode */
  .day-mode .btn-primary {
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    color: #fff;
  }

  .day-mode .btn-primary:hover {
    box-shadow: 0 8px 24px rgba(37, 99, 235, 0.3);
  }

  .day-mode .btn-primary.glow {
    box-shadow: 0 0 20px rgba(37, 99, 235, 0.3);
  }

  .day-mode .btn-secondary {
    background: rgba(255, 255, 255, 0.9);
    color: #64748b;
    border-color: rgba(59, 130, 246, 0.12);
  }

  .day-mode .btn-secondary:hover {
    background: rgba(59, 130, 246, 0.06);
    color: #2563eb;
  }

  .day-mode .btn-ghost {
    color: #64748b;
    border-color: rgba(59, 130, 246, 0.12);
  }

  .day-mode .btn-ghost:hover {
    background: rgba(59, 130, 246, 0.04);
    color: #2563eb;
  }

  /* Filters day mode */
  .day-mode .search-input-wrapper input {
    background: rgba(255, 255, 255, 0.9);
    border-color: rgba(59, 130, 246, 0.12);
    color: #1e293b;
  }

  .day-mode .search-input-wrapper input::placeholder {
    color: #94a3b8;
  }

  .day-mode .search-input-wrapper input:focus {
    border-color: #2563eb;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
  }

  .day-mode .select-wrapper select {
    background: rgba(255, 255, 255, 0.9);
    border-color: rgba(59, 130, 246, 0.12);
    color: #1e293b;
  }

  .day-mode .select-wrapper select:focus {
    border-color: #2563eb;
  }

  .day-mode .select-wrapper::after {
    color: #94a3b8;
  }

  /* Table day mode */
  .day-mode .modern-table th {
    background: rgba(248, 250, 252, 0.9);
    color: #64748b;
  }

  .day-mode .modern-table th,
  .day-mode .modern-table td {
    border-bottom-color: rgba(59, 130, 246, 0.06);
  }

  .day-mode .modern-table tbody tr:hover {
    background: rgba(59, 130, 246, 0.03);
  }

  .day-mode .modern-table tbody tr.selected {
    background: rgba(37, 99, 235, 0.06);
  }

  .day-mode .checkmark {
    background: rgba(255, 255, 255, 0.9);
    border-color: rgba(59, 130, 246, 0.2);
  }

  .day-mode .custom-checkbox input:checked ~ .checkmark {
    background: #2563eb;
    border-color: #2563eb;
  }

  .day-mode .custom-checkbox input:checked ~ .checkmark::after {
    color: #fff;
  }

  .day-mode .row-number {
    background: rgba(59, 130, 246, 0.06);
    color: #64748b;
  }

  .day-mode .point-name { color: #1e293b; }
  .day-mode .address-text { color: #64748b; }

  .day-mode .driver-chip {
    background: rgba(59, 130, 246, 0.1);
    color: #2563eb;
  }

  .day-mode .unassigned-chip {
    background: rgba(239, 68, 68, 0.08);
    color: #ef4444;
  }

  .day-mode .status-chip.completed {
    background: rgba(34, 197, 94, 0.1);
    color: #16a34a;
  }

  .day-mode .status-chip.skipped {
    background: rgba(245, 158, 11, 0.1);
    color: #d97706;
  }

  .day-mode .action-btn {
    background: rgba(59, 130, 246, 0.06);
  }

  .day-mode .action-btn:hover {
    background: rgba(59, 130, 246, 0.12);
  }

  .day-mode .action-btn.delete:hover {
    background: rgba(239, 68, 68, 0.1);
  }

  .day-mode .time-display-cell .time { color: #1e293b; }
  .day-mode .time-display-cell .date { color: #94a3b8; }

  /* Users grid day mode */
  .day-mode .user-card-modern:hover {
    border-color: rgba(59, 130, 246, 0.25);
  }

  .day-mode .user-avatar-large {
    box-shadow: 0 8px 24px rgba(59, 130, 246, 0.2);
  }

  .day-mode .user-main-info h3 { color: #1e293b; }
  .day-mode .user-username { color: #94a3b8; }

  .day-mode .role-chip {
    background: rgba(59, 130, 246, 0.1);
    color: #2563eb;
  }

  .day-mode .role-chip.admin {
    background: rgba(34, 197, 94, 0.1);
    color: #16a34a;
  }

  .day-mode .user-contact { color: #64748b; }

  .day-mode .stat-box {
    background: rgba(248, 250, 252, 0.8);
  }

  .day-mode .stat-box.pending {
    border-color: rgba(59, 130, 246, 0.15);
  }

  .day-mode .stat-box.completed {
    border-color: rgba(34, 197, 94, 0.15);
  }

  .day-mode .stat-box.skipped {
    border-color: rgba(245, 158, 11, 0.15);
  }

  .day-mode .stat-box.pending .stat-number { color: #2563eb; }
  .day-mode .stat-box.completed .stat-number { color: #16a34a; }
  .day-mode .stat-box.skipped .stat-number { color: #d97706; }

  .day-mode .stat-text { color: #94a3b8; }

  /* Modal day mode */
  .day-mode .modal-overlay {
    background: rgba(15, 23, 42, 0.5);
  }

  .day-mode .modal.glass-card {
    background: rgba(255, 255, 255, 0.98);
    border-color: rgba(59, 130, 246, 0.15);
    box-shadow: 0 24px 48px rgba(30, 64, 175, 0.15);
  }

  .day-mode .modal h3 { color: #1e293b; }
  .day-mode .modal-subtitle { color: #64748b; }

  .day-mode .modal-icon {
    background: linear-gradient(135deg, #2563eb, #3b82f6);
  }

  .day-mode .modal-icon.delete-icon {
    background: linear-gradient(135deg, #ef4444, #dc2626);
  }

  .day-mode .form-group label { color: #64748b; }

  .day-mode .form-group input {
    background: rgba(248, 250, 252, 0.9);
    border-color: rgba(59, 130, 246, 0.12);
    color: #1e293b;
  }

  .day-mode .form-group input:focus {
    border-color: #2563eb;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
  }

  .day-mode .form-group input::placeholder {
    color: #94a3b8;
  }

  /* Toast day mode */
  .day-mode .toast.success {
    background: rgba(34, 197, 94, 0.12);
    border-color: rgba(34, 197, 94, 0.25);
    color: #16a34a;
  }

  .day-mode .toast.error {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.2);
    color: #ef4444;
  }

  .day-mode .card-content::-webkit-scrollbar-thumb {
    background: rgba(59, 130, 246, 0.15);
  }

  .day-mode .loading-screen p { color: #64748b; }

  .day-mode .spinner-ring:nth-child(1) { border-top-color: #2563eb; }
  .day-mode .spinner-ring:nth-child(2) { border-right-color: #3b82f6; }
  .day-mode .spinner-ring:nth-child(3) { border-bottom-color: #d97706; }

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

    .users-grid {
      grid-template-columns: 1fr;
    }

    .user-form-grid {
      grid-template-columns: 1fr;
    }

    .modal.modal-wide {
      width: 95vw;
    }
  }
</style>
