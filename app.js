// ตัวแปรเก็บสถานะการทำงานหลัก
let currentUser = null;
let cart = [];
let html5QrCode = null;
let currentScanMode = 'user'; // 'user' หรือ 'item'
let isScannerRunning = false;

// โหลดข้อมูลเมื่อเปิดเว็บสำเร็จ
document.addEventListener("DOMContentLoaded", () => {
  initApp();
  
  // ดักจับการเลือก/ถ่ายภาพเพื่อสแกนรหัส (สำหรับโทรศัพท์มือถือ)
  const fileInput = document.getElementById('camera-file-input');
  if (fileInput) {
    fileInput.addEventListener('change', handleMobileCameraCapture);
  }

  // ดักจับปุ่ม Enter ในหน้าล็อกอิน
  const passwordInput = document.getElementById('login-password-input');
  if (passwordInput) {
    passwordInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        checkPassword();
      }
    });
  }
});

// ฟังก์ชันเริ่มต้นตรวจสอบความปลอดภัย / ล็อกอิน
function initApp() {
  // ตั้งค่าชื่อองค์กร
  if (typeof CONFIG !== 'undefined' && CONFIG.ORG_NAME) {
    document.getElementById('login-org-name').textContent = CONFIG.ORG_NAME;
  }

  if (checkSession()) {
    showAppScreen();
  } else {
    showLoginScreen();
  }
}

// ตรวจสอบเซสชันใน LocalStorage
function checkSession() {
  const sessionTime = localStorage.getItem('requisition_session');
  if (!sessionTime) return false;

  const hoursElapsed = (Date.now() - parseInt(sessionTime)) / (1000 * 60 * 60);
  const maxHours = (typeof CONFIG !== 'undefined' && CONFIG.SESSION_HOURS) ? CONFIG.SESSION_HOURS : 8;
  
  return hoursElapsed < maxHours;
}

// ตรวจสอบรหัสผ่าน
function checkPassword() {
  const passwordInput = document.getElementById('login-password-input');
  const errorMsg = document.getElementById('login-error-msg');
  const password = passwordInput.value;

  const correctPassword = (typeof CONFIG !== 'undefined') ? CONFIG.PASSWORD : "1234";

  if (password === correctPassword) {
    localStorage.setItem('requisition_session', Date.now().toString());
    errorMsg.style.display = 'none';
    passwordInput.value = '';
    showAppScreen();
  } else {
    errorMsg.style.display = 'block';
    passwordInput.value = '';
    passwordInput.focus();
  }
}

// ออกจากระบบ
function logout() {
  if (confirm('คุณต้องการออกจากระบบใช่หรือไม่?')) {
    stopScanner();
    localStorage.removeItem('requisition_session');
    currentUser = null;
    cart = [];
    showLoginScreen();
  }
}

// สลับการแสดงผลหน้าล็อกอิน / หน้าหลัก
function showLoginScreen() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display = 'none';
}

function showAppScreen() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'block';
  
  switchTab('scan');
  loadDashboardData();
}

// ฟังก์ชันกลางในการเชื่อมต่อกับ Google Apps Script API
async function callBackend(action, params = {}) {
  if (typeof CONFIG === 'undefined' || !CONFIG.GAS_URL) {
    throw new Error('ไม่พบการตั้งค่า CONFIG.GAS_URL');
  }

  // ส่งแบบ simple request (ไม่กำหนด Content-Type เป็น application/json เพื่อเลี่ยง OPTIONS preflight CORS)
  const payload = { action, ...params };
  
  const response = await fetch(CONFIG.GAS_URL, {
    method: 'POST',
    mode: 'cors',
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return await response.json();
}

// ฟังก์ชันเปิดกล้องถ่ายภาพของมือถือโดยใช้ Native Camera App
function triggerMobileCamera() {
  stopScanner(); // ปิดกล้องวีดีโอสตรีมสดก่อน
  const fileInput = document.getElementById('camera-file-input');
  if (fileInput) {
    fileInput.click();
  }
}

// ฟังก์ชันประมวลผลรูปภาพที่ถ่ายมาจากกล้องมือถือ
async function handleMobileCameraCapture(e) {
  const files = e.target.files;
  if (!files || files.length === 0) return;
  
  const file = files[0];
  showLoading(true);
  
  // สร้างอินสแตนซ์สแกนภาพจากไฟล์รูปภาพ
  const tempScanner = new Html5Qrcode("reader");
  
  try {
    const decodedText = await tempScanner.scanFile(file, false);
    showLoading(false);
    
    // เคลียร์ค่าอินพุตเพื่อสามารถเลือกถ่ายรูปภาพใหม่ได้เรื่อยๆ
    e.target.value = '';
    
    if (navigator.vibrate) navigator.vibrate(100);
    processCode(decodedText);
  } catch (err) {
    showLoading(false);
    e.target.value = '';
    console.error("ถอดรหัสรูปภาพไม่สำเร็จ: ", err);
    alert("❌ ถอดรหัสไม่สำเร็จ: ไม่พบรหัส QR หรือ Barcode ในรูปภาพที่คุณถ่าย\n\n💡 คำแนะนำ:\n1. จัดรหัสให้อยู่กึ่งกลางภาพ\n2. ถ่ายในที่สว่าง และรอให้กล้องโฟกัสภาพชัดๆ ไม่เบลอ\n3. พยายามอย่าให้ภาพเอียงเกินไป");
  }
}

// ฟังก์ชันเปิด/ปิดหน้าจอบริการโหลด
function showLoading(show) {
  const loader = document.getElementById('loading-overlay');
  if (loader) loader.style.display = show ? 'flex' : 'none';
}

// ฟังก์ชันสลับเมนู/แท็บ (Tabs Switching)
function switchTab(tabName) {
  // สลับการไฮไลท์ปุ่มเมนูด้านล่าง
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.remove('active');
  });
  
  const activeBtn = document.getElementById(`nav-${tabName}`);
  if (activeBtn) activeBtn.classList.add('active');
  
  // สลับหน้าจอเนื้อหา
  document.querySelectorAll('.view-section').forEach(view => {
    view.classList.remove('active');
  });
  
  const activeView = document.getElementById(`view-${tabName}`);
  if (activeView) activeView.classList.add('active');
  
  // จัดการการเปิด/ปิดกล้องสแกน
  if (tabName === 'scan') {
    if (currentUser) {
      setScanMode('item');
    } else {
      setScanMode('user');
    }
  } else {
    stopScanner();
  }
  
  // โหลดข้อมูลอัปเดตสำหรับหน้าแดชบอร์ด/ประวัติ
  if (tabName === 'history') {
    loadDashboardData();
  }
}

// ตั้งค่าโหมดการสแกน (ผู้ใช้ หรือ สินค้า)
function setScanMode(mode) {
  currentScanMode = mode;
  const instructionText = document.getElementById('scan-instruction');
  const manualInputLabel = document.getElementById('manual-input-label');
  const manualInput = document.getElementById('manual-code-input');
  
  if (mode === 'user') {
    instructionText.innerHTML = 'กรุณาสแกน <strong>QR/Barcode บัตรพนักงาน</strong>';
    manualInputLabel.textContent = 'ระบุรหัสพนักงานด้วยตนเอง (หากไม่มีรหัสสแกน):';
    manualInput.placeholder = 'เช่น EMP001';
  } else {
    instructionText.innerHTML = 'กรุณาสแกน <strong>QR/Barcode บนตัวสินค้า</strong>';
    manualInputLabel.textContent = 'ระบุรหัสสินค้าด้วยตนเอง (หากไม่มีรหัสสแกน):';
    manualInput.placeholder = 'เช่น ITEM001';
  }
}

// เริ่มต้นเปิดการสแกนกล้องสด (Streaming)
async function startScanner() {
  if (isScannerRunning) return;
  
  const readerElement = document.getElementById("reader");
  if (!readerElement) return;
  
  html5QrCode = new Html5Qrcode("reader");
  
  const config = { 
    fps: 15,
    qrbox: function(width, height) {
      const minEdge = Math.min(width, height);
      return {
        width: Math.floor(minEdge * 0.75),
        height: Math.floor(minEdge * 0.5)
      };
    },
    aspectRatio: 1.333333
  };
  
  try {
    isScannerRunning = true;
    document.getElementById('start-camera-btn').style.display = 'none';
    document.getElementById('stop-camera-btn').style.display = 'flex';
    document.getElementById('scanner-hint').style.display = 'block';
    
    await html5QrCode.start(
      { facingMode: "environment" },
      config,
      onScanSuccess,
      onScanError
    );
  } catch (err) {
    console.error("เกิดข้อผิดพลาดในการเปิดกล้อง: ", err);
    alert("ไม่สามารถเข้าถึงกล้องถ่ายรูปได้ กรุณาให้สิทธิ์การใช้งานกล้องในบราว์เซอร์ของคุณ");
    isScannerRunning = false;
    document.getElementById('start-camera-btn').style.display = 'block';
    document.getElementById('stop-camera-btn').style.display = 'none';
    document.getElementById('scanner-hint').style.display = 'none';
  }
}

// หยุดใช้งานกล้องสแกน
function stopScanner() {
  if (!isScannerRunning || !html5QrCode) return;
  
  html5QrCode.stop().then(() => {
    isScannerRunning = false;
    document.getElementById('start-camera-btn').style.display = 'block';
    document.getElementById('stop-camera-btn').style.display = 'none';
    document.getElementById('scanner-hint').style.display = 'none';
  }).catch(err => {
    console.error("หยุดกล้องไม่สำเร็จ: ", err);
  });
}

// จัดการเมื่อกล้องอ่านรหัสสำเร็จ
function onScanSuccess(decodedText, decodedResult) {
  if (navigator.vibrate) navigator.vibrate(100);
  processCode(decodedText);
}

function onScanError(errorMessage) {
  // ไม่ระบุ Error ลง UI เพื่อไม่ให้รบกวนการใช้งาน
}

// ค้นหาด้วยมือผ่าน Input
function submitManualInput() {
  const inputVal = document.getElementById('manual-code-input').value.trim();
  if (!inputVal) {
    alert('กรุณากรอกรหัสก่อนกดตกลง');
    return;
  }
  processCode(inputVal);
  document.getElementById('manual-code-input').value = '';
}

// ประมวลผลรหัสที่ได้รับมา
async function processCode(codeValue) {
  showLoading(true);
  
  try {
    if (currentScanMode === 'user') {
      const response = await callBackend('getUser', { userId: codeValue });
      showLoading(false);
      
      if (response.success) {
        currentUser = response;
        updateUserUI();
        setScanMode('item');
        showNotification('ยืนยันตัวตนพนักงานสำเร็จ', 'success');
      } else {
        alert(response.message);
      }
    } else {
      const response = await callBackend('getItem', { itemId: codeValue });
      showLoading(false);
      
      if (response.success) {
        addToCart(response);
        showNotification(`เพิ่มสินค้า: ${response.itemName} ลงตะกร้าแล้ว`, 'info');
      } else {
        alert(response.message);
      }
    }
  } catch (error) {
    showLoading(false);
    console.error("Error checking code: ", error);
    alert('เกิดข้อผิดพลาดในการตรวจสอบข้อมูล: ' + error.message);
  }
}

// อัปเดต UI ส่วนแสดงรายละเอียดพนักงานที่กำลังเบิก
function updateUserUI() {
  const infoSection = document.getElementById('user-info-section');
  if (currentUser) {
    infoSection.innerHTML = `
      <div class="user-badge">
        <div class="user-badge-icon">${currentUser.name.charAt(0)}</div>
        <div class="user-badge-info">
          <h4>${currentUser.name}</h4>
          <p>แผนก: ${currentUser.department} | รหัส: ${currentUser.userId}</p>
        </div>
        <button onclick="clearUser()" style="margin-left: auto; background: none; border: none; color: var(--danger); font-size: 0.85rem; font-weight: 500; cursor: pointer;">เปลี่ยนผู้ใช้</button>
      </div>
    `;
    document.getElementById('cart-card').style.display = 'block';
  } else {
    infoSection.innerHTML = '';
    document.getElementById('cart-card').style.display = 'none';
  }
}

// ยกเลิกพนักงานคนปัจจุบัน
function clearUser() {
  if (confirm('คุณต้องการเปลี่ยนผู้เบิกสินค้าใช่หรือไม่? (รายการในตะกร้าจะถูกรีเซ็ต)')) {
    currentUser = null;
    cart = [];
    updateUserUI();
    updateCartUI();
    setScanMode('user');
  }
}

// เพิ่มสินค้าเข้าตะกร้าสินค้าชั่วคราว
function addToCart(item) {
  const existingIndex = cart.findIndex(c => c.itemId === item.itemId);
  
  if (existingIndex > -1) {
    const newQty = cart[existingIndex].qty + 1;
    if (newQty > item.stock) {
      alert(`ไม่สามารถเพิ่มได้ เนื่องจากมีจำนวนเกินสต็อกคงเหลือ (${item.stock} ${item.unit})`);
      return;
    }
    cart[existingIndex].qty = newQty;
  } else {
    if (item.stock < 1) {
      alert('สินค้านี้หมดคลังแล้ว ไม่สามารถเบิกได้');
      return;
    }
    
    cart.push({
      itemId: item.itemId,
      itemName: item.itemName,
      qty: 1,
      stock: item.stock,
      unit: item.unit,
      isLowStock: item.isLowStock
    });
  }
  
  updateCartUI();
}

// อัปเดต UI รายการของในตะกร้าและปุ่มส่งเบิก
function updateCartUI() {
  const cartList = document.getElementById('cart-list');
  const submitBtn = document.getElementById('submit-requisition-btn');
  
  if (cart.length === 0) {
    cartList.innerHTML = '<p style="text-align: center; color: var(--muted); padding: 12px 0;">ไม่มีรายการสินค้าในขณะนี้ กรุณาสแกนรหัสสินค้าเพื่อเริ่มต้น</p>';
    submitBtn.disabled = true;
    submitBtn.style.opacity = 0.5;
    return;
  }
  
  submitBtn.disabled = false;
  submitBtn.style.opacity = 1;
  
  let html = '';
  cart.forEach((item, index) => {
    html += `
      <div class="cart-item">
        <div class="cart-item-info">
          <h4>${item.itemName}</h4>
          <p>รหัส: ${item.itemId} | ในคลังคงเหลือ: ${item.stock} ${item.unit}</p>
          ${item.isLowStock ? '<span style="font-size: 0.75rem; color: var(--danger); font-weight: 500;">🚨 สินค้าใกล้หมดคลัง!</span>' : ''}
        </div>
        
        <div class="cart-item-actions">
          <div class="qty-control">
            <button class="qty-btn" onclick="adjustQty(${index}, -1)">-</button>
            <input type="number" class="qty-val" value="${item.qty}" readonly>
            <button class="qty-btn" onclick="adjustQty(${index}, 1)">+</button>
          </div>
          
          <button class="btn-remove" onclick="removeFromCart(${index})">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
          </button>
        </div>
      </div>
    `;
  });
  
  cartList.innerHTML = html;
}

// ปรับปรุงจำนวนสินค้าในตะกร้า
function adjustQty(index, change) {
  const item = cart[index];
  const newQty = item.qty + change;
  
  if (newQty < 1) {
    removeFromCart(index);
    return;
  }
  
  if (newQty > item.stock) {
    alert(`ไม่สามารถเบิกสินค้าเกินจำนวนคงคลังสูงสุดได้ (${item.stock} ${item.unit})`);
    return;
  }
  
  item.qty = newQty;
  updateCartUI();
}

// ลบสินค้าออกจากตะกร้า
function removeFromCart(index) {
  cart.splice(index, 1);
  updateCartUI();
  showNotification('ลบรายการสินค้าออกแล้ว', 'info');
}

// ยืนยันการส่งรายการเบิกของไปยัง Google Sheets
async function submitRequisition() {
  if (!currentUser) {
    alert('ไม่พบข้อมูลพนักงานผู้เบิก กรุณาสแกนบัตรพนักงานใหม่อีกครั้ง');
    return;
  }
  
  if (cart.length === 0) {
    alert('ไม่มีรายการสินค้าในตะกร้าเบิก');
    return;
  }
  
  if (!confirm(`คุณต้องการบันทึกการเบิกสินค้าจำนวน ${cart.length} รายการ ไปยังระบบใช่หรือไม่?`)) {
    return;
  }
  
  showLoading(true);
  stopScanner();
  
  try {
    // ต้องแปลงตะกร้า (cart) ให้เป็น JSON string หรือส่งตรงๆ
    const response = await callBackend('submitRequisition', {
      userId: currentUser.userId,
      userName: currentUser.name,
      items: JSON.stringify(cart) // ส่งเป็น JSON String เพื่อความชัวร์ในการดึงฝั่ง GAS
    });
    
    showLoading(false);
    
    if (response.success) {
      alert(`เบิกของเสร็จสิ้น!\nเลขที่ใบเบิก: ${response.transId}`);
      
      // เคลียร์ข้อมูลตะกร้า
      cart = [];
      updateCartUI();
      
      // เปิดหน้าสแกนกลับไปโหมดสแกนพนักงานพร้อมรับคิวถัดไป
      currentUser = null;
      updateUserUI();
      setScanMode('user');
      
      // รีโหลดประวัติข้อมูล Dashboard
      loadDashboardData();
    } else {
      alert('ทำรายการไม่สำเร็จ: ' + response.message);
    }
  } catch (error) {
    showLoading(false);
    console.error("Error submitting requisition: ", error);
    alert('เกิดข้อผิดพลาดในการเชื่อมต่อระบบฐานข้อมูล: ' + error.message);
  }
}

// ดึงข้อมูลแดชบอร์ดและประวัติการเบิกสินค้า
async function loadDashboardData() {
  try {
    // 1. ดึงประวัติการทำรายการเบิก
    const logsRes = await callBackend('getLogs');
    const logContainer = document.getElementById('recent-logs');
    
    if (logContainer) {
      if (logsRes.success && logsRes.data && logsRes.data.length > 0) {
        let html = '';
        logsRes.data.forEach(log => {
          html += `
            <div class="log-item">
              <div class="log-time">${log.timestamp}</div>
              <div class="log-desc">
                <strong>${log.userName}</strong> เบิก <span>${log.itemName}</span> จำนวน <strong>${log.qty}</strong>
              </div>
              <div class="log-sub">รหัสสินค้า: ${log.itemId} | เลขที่ใบเบิก: ${log.transId}</div>
            </div>
          `;
        });
        logContainer.innerHTML = html;
      } else {
        logContainer.innerHTML = '<p style="text-align: center; color: var(--muted); font-size: 0.9rem;">ไม่มีประวัติการทำรายการเบิกของ</p>';
      }
    }

    // 2. ดึงรายการสินค้าแจ้งเตือนภัยใกล้หมด (Low Stock)
    const lowStockRes = await callBackend('getLowStock');
    const container = document.getElementById('low-stock-container');
    const badge = document.getElementById('low-stock-count-badge');
    
    if (container) {
      if (lowStockRes.success && lowStockRes.data && lowStockRes.data.length > 0) {
        if (badge) {
          badge.textContent = lowStockRes.data.length;
          badge.style.display = 'inline-flex';
        }
        
        let html = '';
        lowStockRes.data.forEach(item => {
          html += `
            <div class="low-stock-alert" style="margin-bottom: 8px;">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
              <div>
                <strong>${item.itemName} (${item.itemId})</strong><br>
                คงเหลือปัจจุบัน: <span style="font-size: 1rem; font-weight: bold;">${item.stock}</span> ${item.unit} (ขั้นต่ำ ${item.minStock} ${item.unit})
              </div>
            </div>
          `;
        });
        container.innerHTML = html;
      } else {
        container.innerHTML = `
          <div style="background-color: var(--success-light); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.2); padding: 12px; border-radius: var(--radius-md); font-size: 0.9rem; text-align: center;">
            ✓ สต็อกสินค้าทุกรายการยังอยู่ในระดับปลอดภัย
          </div>
        `;
        if (badge) badge.style.display = 'none';
      }
    }
  } catch (error) {
    console.error("Error loading dashboard data: ", error);
  }
}

// ส่วนงานสร้าง QR Code และ Barcode (Generator)
function generateCode() {
  const codeText = document.getElementById('gen-code-text').value.trim();
  const codeName = document.getElementById('gen-code-name').value.trim() || 'ไม่มีชื่อรายการ';
  const codeType = document.querySelector('input[name="gen-type"]:checked').value;
  
  if (!codeText) {
    alert('กรุณากรอกรหัสพนักงานหรือรหัสสินค้าที่ต้องการสร้างรหัส');
    return;
  }
  
  showLoading(true);
  
  const cleanText = encodeURIComponent(codeText);
  let apiUri = '';
  
  if (codeType === 'qr') {
    apiUri = `https://quickchart.io/qr?text=${cleanText}&size=300&margin=1`;
  } else {
    apiUri = `https://quickchart.io/barcode?type=code128&text=${cleanText}&width=400&height=150&includeText=true`;
  }
  
  // อัปโหลดไฟล์รูปเข้าสู่หน้าพรีวิว
  const imgEl = document.getElementById('generator-result-img');
  imgEl.onload = () => {
    showLoading(false);
    document.getElementById('generator-preview-box').style.display = 'flex';
    document.getElementById('preview-title-txt').textContent = codeName;
    document.getElementById('preview-subtitle-txt').textContent = `${codeType.toUpperCase()}: ${codeText}`;
  };
  
  imgEl.onerror = () => {
    showLoading(false);
    alert('เกิดข้อผิดพลาดในการโหลดรูปภาพสัญลักษณ์ความปลอดภัย');
  };
  
  imgEl.src = apiUri;
}

// สั่งพิมพ์รหัสสินค้าที่กำลัง Preview
function printCode() {
  window.print();
}

// ระบบกล่องข้อความแจ้งเตือนด้านล่าง (Toast Notifications)
function showNotification(message, type = 'info') {
  const notificationId = 'toast-notification';
  let toast = document.getElementById(notificationId);
  
  if (!toast) {
    toast = document.createElement('div');
    toast.id = notificationId;
    toast.style.position = 'fixed';
    toast.style.bottom = '90px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.padding = '10px 20px';
    toast.style.borderRadius = '20px';
    toast.style.color = 'white';
    toast.style.fontSize = '0.85rem';
    toast.style.fontWeight = '500';
    toast.style.zIndex = '9999';
    toast.style.boxShadow = '0 4px 10px rgba(0,0,0,0.15)';
    toast.style.transition = 'opacity 0.3s ease';
    document.body.appendChild(toast);
  }
  
  if (type === 'success') {
    toast.style.backgroundColor = 'var(--success)';
  } else if (type === 'danger') {
    toast.style.backgroundColor = 'var(--danger)';
  } else {
    toast.style.backgroundColor = 'var(--text)';
  }
  
  toast.innerHTML = message;
  toast.style.opacity = '1';
  toast.style.display = 'block';
  
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => { toast.style.display = 'none'; }, 300);
  }, 2500);
}
