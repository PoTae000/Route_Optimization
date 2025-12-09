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
        
        if (data.user.role === 'admin') {
          goto(`/Admin/${data.user.id}`);
        } else {
          goto(`/Home/${data.user.id}`);
        }
      }
    } catch (err) {
      error = 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้';
    }
    
    isLoading = false;
  }
  
  function handleKeyPress(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      handleLogin();
    }
  }

  onMount(() => {
    const remembered = localStorage.getItem('rememberMe');
    if (remembered) {
      username = remembered;
      rememberMe = true;
    }

    const userStr = localStorage.getItem('user');
    if (userStr) {
      const user = JSON.parse(userStr);
      if (user.role === 'admin') {
        goto(`/Admin/${user.id}`);
      } else {
        goto(`/Home/${user.id}`);
      }
    }
  });
</script>

<svelte:head>
  <title>เข้าสู่ระบบ | Route Optimization</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous">
  <link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
</svelte:head>

<div class="login-container">
  <!-- Animated Background -->
  <div class="bg-animation">
    <div class="bg-gradient"></div>
    <div class="bg-grid"></div>
    <div class="floating-shapes">
      <div class="shape shape-1"></div>
      <div class="shape shape-2"></div>
      <div class="shape shape-3"></div>
      <div class="shape shape-4"></div>
    </div>
  </div>
  
  <!-- Login Card -->
  <div class="login-card">
    <div class="logo-section">
      <div class="logo-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>
        </svg>
      </div>
      <h1>Route Optimization</h1>
      <p>ระบบจัดการเส้นทางการจัดส่ง</p>
    </div>
    
    <form on:submit|preventDefault={handleLogin} class="login-form">
      {#if error}
        <div class="error-message">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M15 9l-6 6M9 9l6 6"/>
          </svg>
          <span>{error}</span>
        </div>
      {/if}
      
      <div class="form-group">
        <label for="username">ชื่อผู้ใช้</label>
        <div class="input-wrapper">
          <span class="input-icon">👤</span>
          <input type="text" id="username" bind:value={username} on:keypress={handleKeyPress} placeholder="กรอกชื่อผู้ใช้" disabled={isLoading} />
        </div>
      </div>
      
      <div class="form-group">
        <label for="password">รหัสผ่าน</label>
        <div class="input-wrapper">
          <span class="input-icon">🔒</span>
          <input type={showPassword ? 'text' : 'password'} id="password" bind:value={password} on:keypress={handleKeyPress} placeholder="กรอกรหัสผ่าน" disabled={isLoading} />
          <button type="button" class="toggle-password" on:click={() => showPassword = !showPassword}>
            {showPassword ? '🙈' : '👁️'}
          </button>
        </div>
      </div>
      
      <div class="form-options">
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={rememberMe} />
          <span class="checkmark"></span>
          จดจำฉัน
        </label>
      </div>
      
      <button type="submit" class="login-btn" disabled={isLoading}>
        {#if isLoading}
          <div class="spinner"></div>
          <span>กำลังเข้าสู่ระบบ...</span>
        {:else}
          <span>เข้าสู่ระบบ</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        {/if}
      </button>
    </form>
    
    <div class="demo-accounts">
      <p>🔑 บัญชีทดสอบ</p>
      <div class="demo-list">
        <button class="demo-btn admin" on:click={() => { username = 'admin'; password = 'admin123'; }}>
          <div class="demo-icon">👑</div>
          <div class="demo-info">
            <span class="demo-role">Admin</span>
            <span class="demo-cred">admin / admin123</span>
          </div>
        </button>
        <button class="demo-btn driver" on:click={() => { username = 'driver1'; password = '1234'; }}>
          <div class="demo-icon">🚗</div>
          <div class="demo-info">
            <span class="demo-role">Driver</span>
            <span class="demo-cred">driver1 / 1234</span>
          </div>
        </button>
      </div>
    </div>
    
    <div class="login-footer">
      <p>© 2024 Route Optimization System v2.0</p>
    </div>
  </div>
  
  <!-- Side Info -->
  <div class="side-info">
    <div class="info-content">
      <div class="welcome-badge">
        <span>🚀</span> Delivery Management System
      </div>
      <h2>ยินดีต้อนรับ</h2>
      <p>ระบบจัดการเส้นทางการจัดส่งอัจฉริยะ<br>ประหยัดเวลา ลดต้นทุน เพิ่มประสิทธิภาพ</p>
      
      <div class="features">
        <!-- Admin Feature Card -->
        <div class="feature-card admin-card">
          <div class="feature-glow"></div>
          <div class="feature-header">
            <div class="feature-icon-wrapper admin">
              <span class="feature-emoji">👑</span>
            </div>
            <div class="feature-badge">Admin</div>
          </div>
          <h3>Admin Dashboard</h3>
          <p>ศูนย์ควบคุมการจัดส่งทั้งหมด</p>
          <ul class="feature-list">
            <li><span>📊</span> ดูภาพรวมสถิติแบบ Real-time</li>
            <li><span>👥</span> มอบหมายงานให้ Driver</li>
            <li><span>📍</span> ติดตามตำแหน่งทุกคัน</li>
            <li><span>📋</span> ดูประวัติการจัดส่งทั้งหมด</li>
          </ul>
        </div>
        
        <!-- Driver Feature Card -->
        <div class="feature-card driver-card">
          <div class="feature-glow"></div>
          <div class="feature-header">
            <div class="feature-icon-wrapper driver">
              <span class="feature-emoji">🚗</span>
            </div>
            <div class="feature-badge">Driver</div>
          </div>
          <h3>Driver App</h3>
          <p>แอปสำหรับคนขับมืออาชีพ</p>
          <ul class="feature-list">
            <li><span>🗺️</span> คำนวณเส้นทางที่ดีที่สุด</li>
            <li><span>📡</span> นำทาง GPS แบบ Real-time</li>
            <li><span>✅</span> บันทึกสถานะการส่ง</li>
            <li><span>🔊</span> แจ้งเตือนด้วยเสียงภาษาไทย</li>
          </ul>
        </div>
      </div>
      
      <!-- Stats Preview -->
      <div class="stats-preview">
        <div class="stat-item">
          <div class="stat-number">99%</div>
          <div class="stat-label">ความแม่นยำ</div>
        </div>
        <div class="stat-divider"></div>
        <div class="stat-item">
          <div class="stat-number">30%</div>
          <div class="stat-label">ประหยัดเวลา</div>
        </div>
        <div class="stat-divider"></div>
        <div class="stat-item">
          <div class="stat-number">24/7</div>
          <div class="stat-label">ใช้งานได้ตลอด</div>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  :global(*) { margin: 0; padding: 0; box-sizing: border-box; }
  :global(body) { font-family: 'Kanit', sans-serif; background: #0a0a0f; color: #e4e4e7; overflow: hidden; }
  
  .login-container { display: flex; min-height: 100vh; position: relative; }
  
  /* Background Animation */
  .bg-animation { position: fixed; inset: 0; z-index: 0; overflow: hidden; }
  .bg-gradient { 
    position: absolute; inset: 0; 
    background: 
      radial-gradient(ellipse at 20% 20%, rgba(0, 255, 136, 0.15) 0%, transparent 50%),
      radial-gradient(ellipse at 80% 80%, rgba(102, 126, 234, 0.15) 0%, transparent 50%),
      radial-gradient(ellipse at 50% 50%, rgba(168, 85, 247, 0.05) 0%, transparent 50%),
      linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #16213e 100%);
  }
  .bg-grid { 
    position: absolute; inset: 0; 
    background-image: linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px), 
                      linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px); 
    background-size: 50px 50px;
  }
  
  /* Floating Shapes */
  .floating-shapes { position: absolute; inset: 0; pointer-events: none; }
  .shape { position: absolute; border-radius: 50%; filter: blur(60px); opacity: 0.5; animation: float 20s ease-in-out infinite; }
  .shape-1 { width: 400px; height: 400px; background: rgba(0, 255, 136, 0.1); top: 10%; left: 60%; animation-delay: 0s; }
  .shape-2 { width: 300px; height: 300px; background: rgba(102, 126, 234, 0.1); top: 60%; left: 70%; animation-delay: -5s; }
  .shape-3 { width: 350px; height: 350px; background: rgba(168, 85, 247, 0.1); top: 30%; left: 50%; animation-delay: -10s; }
  .shape-4 { width: 250px; height: 250px; background: rgba(255, 217, 61, 0.05); top: 70%; left: 40%; animation-delay: -15s; }
  @keyframes float {
    0%, 100% { transform: translate(0, 0) rotate(0deg); }
    25% { transform: translate(30px, -30px) rotate(5deg); }
    50% { transform: translate(-20px, 20px) rotate(-5deg); }
    75% { transform: translate(10px, -10px) rotate(3deg); }
  }
  
  /* Login Card */
  .login-card { 
    width: 100%; max-width: 480px; padding: 48px; 
    display: flex; flex-direction: column; justify-content: center; 
    position: relative; z-index: 10; 
    background: rgba(15, 15, 25, 0.9); 
    backdrop-filter: blur(20px); 
    border-right: 1px solid rgba(255, 255, 255, 0.05);
  }
  
  .logo-section { text-align: center; margin-bottom: 40px; }
  .logo-icon { 
    width: 80px; height: 80px; margin: 0 auto 20px; 
    background: linear-gradient(135deg, #00ff88 0%, #00cc6a 100%); 
    border-radius: 24px; 
    display: flex; align-items: center; justify-content: center; 
    box-shadow: 0 10px 40px rgba(0, 255, 136, 0.3);
    animation: pulse-glow 3s ease-in-out infinite;
  }
  @keyframes pulse-glow {
    0%, 100% { box-shadow: 0 10px 40px rgba(0, 255, 136, 0.3); }
    50% { box-shadow: 0 10px 60px rgba(0, 255, 136, 0.5); }
  }
  .logo-icon svg { width: 44px; height: 44px; color: #0a0a0f; }
  .logo-section h1 { 
    font-size: 28px; font-weight: 700; 
    background: linear-gradient(135deg, #00ff88 0%, #00cc6a 100%); 
    -webkit-background-clip: text; -webkit-text-fill-color: transparent; 
    background-clip: text; margin-bottom: 8px; 
  }
  .logo-section p { font-size: 14px; color: #71717a; }
  
  .login-form { display: flex; flex-direction: column; gap: 20px; }
  
  .error-message { 
    display: flex; align-items: center; gap: 10px; 
    padding: 14px 16px; 
    background: rgba(255, 107, 107, 0.1); 
    border: 1px solid rgba(255, 107, 107, 0.3); 
    border-radius: 12px; color: #ff6b6b; font-size: 14px;
    animation: shake 0.5s ease;
  }
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-5px); }
    75% { transform: translateX(5px); }
  }
  .error-message svg { width: 20px; height: 20px; flex-shrink: 0; }
  
  .form-group { display: flex; flex-direction: column; gap: 8px; }
  .form-group label { font-size: 14px; font-weight: 500; color: #a1a1aa; }
  
  .input-wrapper { 
    position: relative; 
    display: flex; 
    align-items: center;
  }
  .input-icon { 
    position: absolute; left: 16px; 
    font-size: 16px; 
    z-index: 1;
  }
  .form-group input { 
    width: 100%; padding: 14px 16px 14px 48px; 
    background: rgba(0, 0, 0, 0.4); 
    border: 1px solid rgba(255, 255, 255, 0.1); 
    border-radius: 12px; color: #e4e4e7; 
    font-family: 'Kanit', sans-serif; font-size: 15px; 
    transition: all 0.3s ease; 
  }
  .form-group input:focus { 
    outline: none; 
    border-color: #00ff88; 
    box-shadow: 0 0 0 3px rgba(0, 255, 136, 0.1); 
    background: rgba(0, 255, 136, 0.05);
  }
  .form-group input::placeholder { color: #52525b; }
  .form-group input:disabled { opacity: 0.6; cursor: not-allowed; }
  
  .toggle-password { 
    position: absolute; right: 14px; 
    background: none; border: none; 
    cursor: pointer; font-size: 18px;
    transition: transform 0.2s;
  }
  .toggle-password:hover { transform: scale(1.1); }
  
  .form-options { display: flex; justify-content: space-between; align-items: center; }
  .checkbox-label { 
    display: flex; align-items: center; gap: 10px; 
    cursor: pointer; font-size: 14px; color: #a1a1aa; 
  }
  .checkbox-label input { display: none; }
  .checkmark { 
    width: 20px; height: 20px; 
    border: 2px solid rgba(255, 255, 255, 0.2); 
    border-radius: 6px; position: relative; 
    transition: all 0.2s; 
  }
  .checkbox-label input:checked + .checkmark { background: #00ff88; border-color: #00ff88; }
  .checkbox-label input:checked + .checkmark::after { 
    content: '✓'; position: absolute; 
    top: 50%; left: 50%; transform: translate(-50%, -50%); 
    color: #0a0a0f; font-size: 12px; font-weight: bold; 
  }
  
  .login-btn { 
    display: flex; align-items: center; justify-content: center; gap: 10px; 
    padding: 16px; 
    background: linear-gradient(135deg, #00ff88 0%, #00cc6a 100%); 
    border: none; border-radius: 12px; 
    color: #0a0a0f; font-family: 'Kanit', sans-serif; 
    font-size: 16px; font-weight: 600; 
    cursor: pointer; transition: all 0.3s ease; 
    box-shadow: 0 4px 20px rgba(0, 255, 136, 0.3);
  }
  .login-btn svg { width: 20px; height: 20px; transition: transform 0.3s; }
  .login-btn:hover:not(:disabled) { 
    transform: translateY(-2px); 
    box-shadow: 0 6px 30px rgba(0, 255, 136, 0.4); 
  }
  .login-btn:hover:not(:disabled) svg { transform: translateX(4px); }
  .login-btn:disabled { opacity: 0.7; cursor: not-allowed; transform: none; }
  
  .spinner { 
    width: 20px; height: 20px; 
    border: 2px solid rgba(10, 10, 15, 0.3); 
    border-top-color: #0a0a0f; 
    border-radius: 50%; 
    animation: spin 0.8s linear infinite; 
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  
  /* Demo Accounts */
  .demo-accounts { 
    margin-top: 32px; padding-top: 24px; 
    border-top: 1px solid rgba(255, 255, 255, 0.05); 
  }
  .demo-accounts > p { 
    font-size: 12px; color: #71717a; 
    text-transform: uppercase; letter-spacing: 1px; 
    margin-bottom: 12px; text-align: center;
  }
  .demo-list { display: flex; gap: 12px; }
  .demo-btn { 
    flex: 1; display: flex; align-items: center; gap: 12px; 
    padding: 14px 16px; 
    background: rgba(255, 255, 255, 0.03); 
    border: 1px solid rgba(255, 255, 255, 0.08); 
    border-radius: 12px; cursor: pointer; 
    transition: all 0.3s ease;
  }
  .demo-icon { font-size: 28px; }
  .demo-info { display: flex; flex-direction: column; align-items: flex-start; }
  .demo-role { font-size: 14px; font-weight: 600; color: #e4e4e7; }
  .demo-cred { font-size: 11px; color: #71717a; font-family: monospace; }
  
  .demo-btn.admin:hover { 
    background: rgba(255, 217, 61, 0.1); 
    border-color: rgba(255, 217, 61, 0.3);
    transform: translateY(-2px);
  }
  .demo-btn.driver:hover { 
    background: rgba(0, 255, 136, 0.1); 
    border-color: rgba(0, 255, 136, 0.3);
    transform: translateY(-2px);
  }
  
  .login-footer { margin-top: 32px; text-align: center; font-size: 12px; color: #52525b; }
  
  /* Side Info */
  .side-info { 
    flex: 1; display: flex; flex-direction: column; 
    justify-content: center; padding: 60px; 
    position: relative; z-index: 5; 
  }
  .info-content { max-width: 600px; }
  
  .welcome-badge {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 8px 16px;
    background: rgba(0, 255, 136, 0.1);
    border: 1px solid rgba(0, 255, 136, 0.2);
    border-radius: 30px;
    font-size: 13px;
    color: #00ff88;
    margin-bottom: 24px;
  }
  
  .info-content h2 { 
    font-size: 52px; font-weight: 700; margin-bottom: 16px; 
    background: linear-gradient(135deg, #ffffff 0%, #a1a1aa 100%); 
    -webkit-background-clip: text; -webkit-text-fill-color: transparent; 
    background-clip: text;
  }
  .info-content > p { 
    font-size: 18px; color: #71717a; 
    margin-bottom: 48px; line-height: 1.6;
  }
  
  /* Feature Cards */
  .features { display: grid; grid-template-columns: repeat(2, 1fr); gap: 24px; margin-bottom: 48px; }
  
  .feature-card { 
    position: relative;
    padding: 24px; 
    background: rgba(255, 255, 255, 0.02); 
    border: 1px solid rgba(255, 255, 255, 0.05); 
    border-radius: 20px; 
    transition: all 0.4s ease;
    overflow: hidden;
  }
  .feature-glow {
    position: absolute;
    top: -50%;
    left: -50%;
    width: 200%;
    height: 200%;
    opacity: 0;
    transition: opacity 0.4s ease;
    pointer-events: none;
  }
  .admin-card .feature-glow { background: radial-gradient(circle, rgba(255, 217, 61, 0.15) 0%, transparent 50%); }
  .driver-card .feature-glow { background: radial-gradient(circle, rgba(0, 255, 136, 0.15) 0%, transparent 50%); }
  
  .feature-card:hover { 
    transform: translateY(-8px);
    border-color: rgba(255, 255, 255, 0.1);
  }
  .feature-card:hover .feature-glow { opacity: 1; }
  
  .admin-card:hover { border-color: rgba(255, 217, 61, 0.3); }
  .driver-card:hover { border-color: rgba(0, 255, 136, 0.3); }
  
  .feature-header { 
    display: flex; align-items: center; 
    justify-content: space-between; 
    margin-bottom: 16px; 
  }
  .feature-icon-wrapper { 
    width: 56px; height: 56px; 
    border-radius: 16px; 
    display: flex; align-items: center; justify-content: center;
    position: relative;
  }
  .feature-icon-wrapper.admin { 
    background: linear-gradient(135deg, rgba(255, 217, 61, 0.2) 0%, rgba(255, 165, 2, 0.2) 100%);
    box-shadow: 0 8px 32px rgba(255, 217, 61, 0.2);
  }
  .feature-icon-wrapper.driver { 
    background: linear-gradient(135deg, rgba(0, 255, 136, 0.2) 0%, rgba(0, 204, 106, 0.2) 100%);
    box-shadow: 0 8px 32px rgba(0, 255, 136, 0.2);
  }
  .feature-emoji { font-size: 28px; }
  
  .feature-badge {
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .admin-card .feature-badge { 
    background: rgba(255, 217, 61, 0.15); 
    color: #ffd93d; 
  }
  .driver-card .feature-badge { 
    background: rgba(0, 255, 136, 0.15); 
    color: #00ff88; 
  }
  
  .feature-card h3 { 
    font-size: 20px; font-weight: 600; 
    color: #e4e4e7; margin-bottom: 8px; 
  }
  .feature-card > p { 
    font-size: 14px; color: #71717a; 
    margin-bottom: 16px; 
  }
  
  .feature-list { 
    list-style: none; 
    display: flex; flex-direction: column; 
    gap: 10px; 
  }
  .feature-list li { 
    display: flex; align-items: center; gap: 10px; 
    font-size: 13px; color: #a1a1aa;
    padding: 8px 12px;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 8px;
    transition: all 0.2s;
  }
  .feature-list li:hover {
    background: rgba(255, 255, 255, 0.05);
    transform: translateX(4px);
  }
  .feature-list li span { font-size: 14px; }
  
  /* Stats Preview */
  .stats-preview {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 32px;
    padding: 24px 32px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 16px;
  }
  .stat-item { text-align: center; }
  .stat-number { 
    font-size: 32px; font-weight: 700; 
    background: linear-gradient(135deg, #00ff88 0%, #00cc6a 100%);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .stat-label { font-size: 13px; color: #71717a; margin-top: 4px; }
  .stat-divider { width: 1px; height: 40px; background: rgba(255, 255, 255, 0.1); }
  
  /* Responsive */
  @media (max-width: 1200px) { 
    .features { grid-template-columns: 1fr; }
    .stats-preview { flex-wrap: wrap; gap: 20px; }
    .stat-divider { display: none; }
  }
  @media (max-width: 1024px) { 
    .side-info { display: none; } 
    .login-card { max-width: 100%; border-right: none; } 
  }
  @media (max-width: 480px) { 
    .login-card { padding: 32px 24px; } 
    .logo-icon { width: 64px; height: 64px; } 
    .logo-section h1 { font-size: 24px; } 
    .demo-list { flex-direction: column; } 
  }
</style>