<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  
  const API_URL = 'http://localhost:3000/api';
  
  let username = '';
  let password = '';
  let isLoading = false;
  let error = '';
  let rememberMe = false;
  let showPassword = false;
  
  async function handleLogin() {
    error = '';
    
    if (!username.trim() || !password.trim()) {
      error = 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน';
      return;
    }
    
    isLoading = true;
    
    try {
      // ใช้ Unified Login API - ค้นหาใน 3 ตารางอัตโนมัติ
      // ลำดับ: drivers -> customers -> users
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      
      const data = await res.json();
      
      if (data.error) {
        error = data.error;
      } else if (data.success) {
        localStorage.setItem('user', JSON.stringify({
          ...data.user,
          loggedInAt: new Date().toISOString()
        }));
        
        if (rememberMe) {
          localStorage.setItem('rememberMe', username);
        } else {
          localStorage.removeItem('rememberMe');
        }
        
        redirectByRole(data.user.role, data.user.id);
      }
    } catch (err) {
      error = 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้';
    }
    
    isLoading = false;
  }
  
  function redirectByRole(role: string, id: number) {
    const r = role.toLowerCase();
    if (r === 'admin') goto(`/Admin/${id}`);
    else if (r === 'driver') goto(`/Home/${id}`);
    else if (r === 'customer') goto(`/factory/${id}`);
    else if (r === 'user') goto(`/User/${id}`);
    else goto(`/Home/${id}`);
  }
  
  function handleKeyPress(e: KeyboardEvent) {
    if (e.key === 'Enter') handleLogin();
  }
  
  function selectDemo(type: string) {
    error = '';
    if (type === 'admin') { username = 'admin'; password = 'admin123'; }
    else if (type === 'driver') { username = 'driver1'; password = '1234'; }
    else if (type === 'customer') { username = 'customer1'; password = 'cust123'; }
    else if (type === 'user') { username = 'user1'; password = '1234'; }
  }

  onMount(() => {
    const remembered = localStorage.getItem('rememberMe');
    if (remembered) { username = remembered; rememberMe = true; }

    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        redirectByRole(user.role, user.id);
      } catch { localStorage.removeItem('user'); }
    }
  });
</script>

<svelte:head>
  <title>เข้าสู่ระบบ | Route Optimization</title>
  <link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
</svelte:head>

<div class="login-container">
  <div class="bg-animation">
    <div class="bg-gradient"></div>
    <div class="bg-grid"></div>
    <div class="floating-shapes">
      <div class="shape shape-1"></div>
      <div class="shape shape-2"></div>
      <div class="shape shape-3"></div>
    </div>
  </div>
  
  <div class="login-card">
    <div class="logo-section">
      <div class="logo-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>
        </svg>
      </div>
      <h1>Route Optimization</h1>
      <p>ระบบการวางแผนเส้นทางก่อนออกเดินทาง</p>
    </div>
    
    <form on:submit|preventDefault={handleLogin} class="login-form">
      {#if error}
        <div class="error-message">
          <span>❌</span> {error}
        </div>
      {/if}
      
      <div class="form-group">
        <label>ชื่อผู้ใช้</label>
        <div class="input-wrapper">
          <span class="input-icon">👤</span>
          <input type="text" bind:value={username} on:keypress={handleKeyPress} placeholder="กรอกชื่อผู้ใช้" disabled={isLoading} />
        </div>
      </div>
      
      <div class="form-group">
        <label>รหัสผ่าน</label>
        <div class="input-wrapper">
          <span class="input-icon">🔒</span>
          <input type={showPassword ? 'text' : 'password'} bind:value={password} on:keypress={handleKeyPress} placeholder="กรอกรหัสผ่าน" disabled={isLoading} />
          <button type="button" class="toggle-pw" on:click={() => showPassword = !showPassword}>
            {showPassword ? '🙈' : '👁️'}
          </button>
        </div>
      </div>
      
      <label class="checkbox-label">
        <input type="checkbox" bind:checked={rememberMe} />
        <span class="checkmark"></span>
        จดจำฉัน
      </label>
      
      <button type="submit" class="login-btn" disabled={isLoading}>
        {#if isLoading}
          <div class="spinner"></div> กำลังเข้าสู่ระบบ...
        {:else}
          เข้าสู่ระบบ →
        {/if}
      </button>
    </form>
    
    <div class="demo-accounts">
      <p>🔑 บัญชีทดสอบ</p>
      <div class="demo-grid">
        <button class="demo-btn admin" on:click={() => selectDemo('admin')}>
          <span class="demo-icon">👑</span>
          <span class="demo-role">Admin</span>
          <span class="demo-cred">admin / admin123</span>
          <span class="demo-table">drivers</span>
        </button>
        <button class="demo-btn driver" on:click={() => selectDemo('driver')}>
          <span class="demo-icon">🚗</span>
          <span class="demo-role">Driver</span>
          <span class="demo-cred">driver1 / 1234</span>
          <span class="demo-table">drivers</span>
        </button>
        <button class="demo-btn customer" on:click={() => selectDemo('customer')}>
          <span class="demo-icon">🛒</span>
          <span class="demo-role">Customer</span>
          <span class="demo-cred">customer1 / cust123</span>
          <span class="demo-table">customers</span>
        </button>
        <button class="demo-btn user" on:click={() => selectDemo('user')}>
          <span class="demo-icon">👤</span>
          <span class="demo-role">User</span>
          <span class="demo-cred">user1 / 1234</span>
          <span class="demo-table">users</span>
        </button>
      </div>
    </div>
  </div>
  
  <div class="side-info">
    <div class="info-content">
      <div class="welcome-badge">🚀 Delivery Management System</div>
      <h2>ยินดีต้อนรับ</h2>
      <p>ระบบจัดการเส้นทางการจัดส่งอัจฉริยะ</p>
      
      <div class="features">
        <div class="feature-card admin-card">
          <div class="feature-icon admin">👑</div>
          <div class="feature-info">
            <h3>Admin</h3>
            <p>ศูนย์ควบคุมการจัดส่ง</p>
            <span class="table-tag">drivers table</span>
          </div>
        </div>
        <div class="feature-card driver-card">
          <div class="feature-icon driver">🚗</div>
          <div class="feature-info">
            <h3>Driver</h3>
            <p>แอปสำหรับคนขับ</p>
            <span class="table-tag">drivers table</span>
          </div>
        </div>
        <div class="feature-card customer-card">
          <div class="feature-icon customer">🛒</div>
          <div class="feature-info">
            <h3>Customer</h3>
            <p>สั่งซื้อและติดตาม</p>
            <span class="table-tag">customers table</span>
          </div>
        </div>
        <div class="feature-card user-card">
          <div class="feature-icon user">👤</div>
          <div class="feature-info">
            <h3>User</h3>
            <p>ผู้ใช้ทั่วไป</p>
            <span class="table-tag">users table</span>
          </div>
        </div>
      </div> 
    </div>
  </div>
</div>

<style>
  :global(*) { margin: 0; padding: 0; box-sizing: border-box; }
  :global(body) { font-family: 'Kanit', sans-serif; background: #0a0a0f; color: #e4e4e7; }
  
  .login-container { display: flex; min-height: 100vh; }
  
  .bg-animation { position: fixed; inset: 0; z-index: 0; }
  .bg-gradient { 
    position: absolute; inset: 0; 
    background: radial-gradient(ellipse at 20% 20%, rgba(0,255,136,0.15) 0%, transparent 50%),
                radial-gradient(ellipse at 80% 80%, rgba(102,126,234,0.15) 0%, transparent 50%),
                linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #16213e 100%);
  }
  .bg-grid { 
    position: absolute; inset: 0; 
    background-image: linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), 
                      linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px); 
    background-size: 50px 50px;
  }
  .floating-shapes { position: absolute; inset: 0; pointer-events: none; }
  .shape { position: absolute; border-radius: 50%; filter: blur(60px); animation: float 20s ease-in-out infinite; }
  .shape-1 { width: 300px; height: 300px; background: rgba(0,255,136,0.1); top: 10%; left: 60%; }
  .shape-2 { width: 250px; height: 250px; background: rgba(102,126,234,0.1); top: 60%; left: 70%; animation-delay: -5s; }
  .shape-3 { width: 200px; height: 200px; background: rgba(168,85,247,0.1); top: 30%; left: 50%; animation-delay: -10s; }
  @keyframes float { 0%,100% { transform: translate(0,0); } 50% { transform: translate(-20px,20px); } }
  
  .login-card { 
    width: 100%; max-width: 460px; padding: 40px; 
    display: flex; flex-direction: column; justify-content: center; 
    position: relative; z-index: 10; 
    background: rgba(15,15,25,0.95); backdrop-filter: blur(20px); 
    border-right: 1px solid rgba(255,255,255,0.05);
  }
  
  .logo-section { text-align: center; margin-bottom: 20px; }
  .logo-icon { 
    width: 70px; height: 70px; margin: 0 auto 16px; 
    background: linear-gradient(135deg, #00ff88, #00cc6a); 
    border-radius: 20px; display: flex; align-items: center; justify-content: center; 
    box-shadow: 0 10px 40px rgba(0,255,136,0.3);
  }
  .logo-icon svg { width: 38px; height: 38px; color: #0a0a0f; }
  .logo-section h1 { 
    font-size: 24px; font-weight: 700; 
    background: linear-gradient(135deg, #00ff88, #00cc6a); 
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  .logo-section p { font-size: 13px; color: #71717a; }
  
  .system-badge {
    display: flex; align-items: center; justify-content: center; gap: 6px;
    padding: 8px 16px; margin-bottom: 20px;
    background: rgba(0,255,136,0.1); border: 1px solid rgba(0,255,136,0.2);
    border-radius: 20px; font-size: 12px; color: #00ff88;
  }
  
  .login-form { display: flex; flex-direction: column; gap: 16px; }
  
  .error-message { 
    display: flex; align-items: center; gap: 8px; 
    padding: 12px; background: rgba(255,107,107,0.1); 
    border: 1px solid rgba(255,107,107,0.3); border-radius: 10px; 
    color: #ff6b6b; font-size: 13px;
  }
  
  .form-group { display: flex; flex-direction: column; gap: 6px; }
  .form-group label { font-size: 13px; color: #a1a1aa; }
  .input-wrapper { position: relative; }
  .input-icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); font-size: 14px; }
  .form-group input { 
    width: 100%; padding: 12px 14px 12px 42px; 
    background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.1); 
    border-radius: 10px; color: #e4e4e7; font-family: 'Kanit'; font-size: 14px;
  }
  .form-group input:focus { outline: none; border-color: #00ff88; box-shadow: 0 0 0 3px rgba(0,255,136,0.1); }
  .form-group input::placeholder { color: #52525b; }
  .toggle-pw { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; font-size: 16px; }
  
  .checkbox-label { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; color: #a1a1aa; }
  .checkbox-label input { display: none; }
  .checkmark { width: 18px; height: 18px; border: 2px solid rgba(255,255,255,0.2); border-radius: 4px; }
  .checkbox-label input:checked + .checkmark { background: #00ff88; border-color: #00ff88; }
  
  .login-btn { 
    padding: 14px; background: linear-gradient(135deg, #00ff88, #00cc6a); 
    border: none; border-radius: 10px; color: #0a0a0f; 
    font-family: 'Kanit'; font-size: 15px; font-weight: 600; 
    cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
    box-shadow: 0 4px 20px rgba(0,255,136,0.3); transition: all 0.3s;
  }
  .login-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 6px 30px rgba(0,255,136,0.4); }
  .login-btn:disabled { opacity: 0.7; cursor: not-allowed; }
  .spinner { width: 18px; height: 18px; border: 2px solid rgba(0,0,0,0.2); border-top-color: #0a0a0f; border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  
  .demo-accounts { margin-top: 24px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.05); }
  .demo-accounts > p { font-size: 11px; color: #71717a; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; text-align: center; }
  .demo-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
  .demo-btn { 
    display: flex; flex-direction: column; align-items: center; gap: 2px; 
    padding: 10px 8px; background: rgba(255,255,255,0.03); 
    border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; 
    cursor: pointer; transition: all 0.3s;
  }
  .demo-icon { font-size: 20px; }
  .demo-role { font-size: 11px; font-weight: 600; color: #e4e4e7; }
  .demo-cred { font-size: 8px; color: #71717a; font-family: monospace; }
  .demo-table { font-size: 7px; color: #52525b; }
  .demo-btn.admin:hover { background: rgba(255,217,61,0.1); border-color: rgba(255,217,61,0.3); }
  .demo-btn.driver:hover { background: rgba(0,255,136,0.1); border-color: rgba(0,255,136,0.3); }
  .demo-btn.customer:hover { background: rgba(139,92,246,0.1); border-color: rgba(139,92,246,0.3); }
  .demo-btn.user:hover { background: rgba(59,130,246,0.1); border-color: rgba(59,130,246,0.3); }
  
  .footer { margin-top: 24px; text-align: center; }
  .footer p { font-size: 11px; color: #52525b; }
  .footer .sub { font-size: 9px; color: #3f3f46; margin-top: 4px; }
  
  .side-info { flex: 1; display: flex; align-items: center; padding: 40px; position: relative; z-index: 5; }
  .info-content { max-width: 600px; }
  .welcome-badge { display: inline-block; padding: 8px 16px; background: rgba(0,255,136,0.1); border: 1px solid rgba(0,255,136,0.2); border-radius: 20px; font-size: 13px; color: #00ff88; margin-bottom: 20px; }
  .info-content h2 { font-size: 40px; font-weight: 700; margin-bottom: 12px; background: linear-gradient(135deg, #fff, #a1a1aa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .info-content > p { font-size: 16px; color: #71717a; margin-bottom: 32px; }
  
  .features { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 24px; }
  .feature-card { display: flex; align-items: center; gap: 12px; padding: 16px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; transition: all 0.3s; }
  .feature-card:hover { transform: translateY(-4px); }
  .admin-card:hover { border-color: rgba(255,217,61,0.3); }
  .driver-card:hover { border-color: rgba(0,255,136,0.3); }
  .customer-card:hover { border-color: rgba(139,92,246,0.3); }
  .user-card:hover { border-color: rgba(59,130,246,0.3); }
  .feature-icon { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 22px; }
  .feature-icon.admin { background: rgba(255,217,61,0.2); }
  .feature-icon.driver { background: rgba(0,255,136,0.2); }
  .feature-icon.customer { background: rgba(139,92,246,0.2); }
  .feature-icon.user { background: rgba(59,130,246,0.2); }
  .feature-info h3 { font-size: 14px; color: #e4e4e7; margin-bottom: 2px; }
  .feature-info p { font-size: 11px; color: #71717a; margin-bottom: 4px; }
  .table-tag { font-size: 9px; color: #52525b; background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; }
  
  .db-info { padding: 20px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; }
  .db-info h4 { font-size: 14px; color: #a1a1aa; margin-bottom: 16px; text-align: center; }
  .db-tables { display: flex; justify-content: center; gap: 16px; flex-wrap: wrap; }
  .db-item { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 12px 16px; background: rgba(0,0,0,0.3); border-radius: 8px; font-size: 12px; color: #00ff88; }
  .db-item span { font-size: 20px; }
  .db-item small { font-size: 10px; color: #71717a; }
  
  @media (max-width: 1024px) { .side-info { display: none; } .login-card { max-width: 100%; } }
  @media (max-width: 480px) { .login-card { padding: 24px 20px; } .demo-grid { grid-template-columns: 1fr 1fr; } }
</style>