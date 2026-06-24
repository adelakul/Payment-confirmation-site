// app.js - main application logic (scanning refactor)
(function(){
  // State
  window.db = null;
  window.tickets = window.tickets || [];
  let currentStream = null;
  let isScanning = false;
  let rafId = null;
  let decodeWorker = null;
  let workerReady = false;
  const deviceId = 'D-' + (crypto && crypto.randomUUID ? crypto.randomUUID().slice(0,6).toUpperCase() : Math.random().toString(36).substr(2,6).toUpperCase());
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('deviceId').textContent = deviceId;
    bindUI();
    initFirebase('https://party-tickets-b5223-default-rtdb.firebaseio.com/');
    startWorker();
  });

  function bindUI(){
    document.getElementById('generateBtn').addEventListener('click', generateTicket);
    document.getElementById('startCamBtn').addEventListener('click', startCamera);
    document.getElementById('stopCamBtn').addEventListener('click', stopCamera);
    document.getElementById('printBtn').addEventListener('click', printTickets);
    document.getElementById('exportBtn').addEventListener('click', exportData);
    document.getElementById('clearBtn').addEventListener('click', clearAll);
    document.getElementById('qrPhoto').addEventListener('change', (e)=> scanPhoto(e.target));
    document.getElementById('verifyManualBtn').addEventListener('click', verifyManual);
    document.getElementById('scanAgain').addEventListener('click', resetScan);
    document.getElementById('searchTickets').addEventListener('input', renderTable);

    // scanner tab buttons
    document.getElementById('tabLive').addEventListener('click', ()=> switchScanMode('live'));
    document.getElementById('tabPhoto').addEventListener('click', ()=> switchScanMode('photo'));
    document.getElementById('tabType').addEventListener('click', ()=> switchScanMode('type'));
  }

  // Firebase init and listeners
  function initFirebase(url){
    try {
      firebase.initializeApp({ databaseURL: url });
      db = firebase.database();
      db.ref('tickets').on('value', (snapshot) => {
        const data = snapshot.val();
        tickets = data ? Object.values(data) : [];
        updateUI();
        document.getElementById('syncText').textContent = 'Cloud Synced ✓';
        document.getElementById('syncDot').classList.add('online');
      }, (err) => { document.getElementById('syncText').textContent = 'Sync Error'; });
    } catch (err) {
      document.getElementById('syncText').textContent = 'Offline Mode';
      tickets = JSON.parse(localStorage.getItem('partyTickets')) || [];
      updateUI();
    }
  }

  // Save single ticket to cloud (safer than overwriting entire collection)
  function saveToCloud(){
    if (!db) { localStorage.setItem('partyTickets', JSON.stringify(tickets)); return; }
    tickets.forEach(t => { if (t && t.id) db.ref(`tickets/${t.id}`).set(t); });
  }

  function updateUI(){ updateStats(); if (typeof renderQRs === 'function') renderQRs(); if (typeof renderTable === 'function') renderTable(); if (tickets.length>0) document.getElementById('qrSection').style.display = 'block'; }

  // Ticket operations
  function generateCode(){ const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let code = ''; for (let i=0;i<8;i++) code += chars[Math.floor(Math.random()*chars.length)]; return 'PT-' + code; }

  function generateTicket(){
    const name = document.getElementById('guestName').value.trim();
    const type = document.getElementById('ticketType').value;
    const amount = parseFloat(document.getElementById('amountPaid').value) || 0;
    if (!name) { alert('Please enter a guest name'); return; }
    const id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : ('PT-' + Date.now());
    const ticket = { id: id, code: generateCode(), name: name, type: type, amount: amount, status: 'valid', created: new Date().toISOString(), usedAt: null, createdBy: deviceId };
    tickets.push(ticket);
    saveToCloud();
    updateUI();
    document.getElementById('guestName').value = '';
    document.getElementById('amountPaid').value = '';
    document.getElementById('qrSection').style.display = 'block';
  }

  function updateStats(){
    document.getElementById('statTotal').textContent = tickets.length;
    document.getElementById('statValid').textContent = tickets.filter(t=>t.status==='valid').length;
    document.getElementById('statUsed').textContent = tickets.filter(t=>t.status==='used').length;
    const total = tickets.reduce((sum,t)=> sum + (Number(t.amount)||0), 0);
    document.getElementById('statRevenue').textContent = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(total);
  }

  // Scanner mode handling
  let scanMode = 'live';
  function switchScanMode(mode){ scanMode = mode; document.getElementById('tabLive').classList.toggle('active', mode==='live'); document.getElementById('tabPhoto').classList.toggle('active', mode==='photo'); document.getElementById('tabType').classList.toggle('active', mode==='type'); document.getElementById('liveView').classList.toggle('hidden', mode!=='live'); document.getElementById('photoView').classList.toggle('hidden', mode!=='photo'); document.getElementById('typeView').classList.toggle('hidden', mode!=='type'); if (mode!=='live') stopCamera(); }

  async function startCamera(){
    const video = document.getElementById('scanVideo');
    const canvas = document.getElementById('scanCanvas');
    const status = document.getElementById('scanStatus');
    const debug = document.getElementById('debugInfo');

    if (location.protocol !== 'https:' && location.hostname !== 'localhost'){
      status.textContent = '❌ Camera requires HTTPS. Use Photo or Type Code.'; status.className='scan-status error'; return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ status.textContent='❌ Camera API not supported. Use Photo or Type Code.'; status.className='scan-status error'; return; }
    status.textContent = '📷 Requesting camera...'; status.className='scan-status';

    try{
      stopCamera();
      const constraints = { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio:false };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      currentStream = stream; video.srcObject = stream;
      video.setAttribute('playsinline','true'); video.setAttribute('muted','true'); video.setAttribute('autoplay','true');

      await new Promise((resolve,reject)=>{
        let settled=false;
        video.onloadedmetadata = () => { if (!settled){ settled=true; video.play().then(resolve).catch(reject); } };
        video.onerror = (e)=> { if (!settled){ settled=true; reject(e); } };
        setTimeout(()=>{ if (!settled){ settled=true; reject(new Error('Video load timeout')); } },10000);
      });

      status.textContent='✅ Camera active! Point at QR code'; status.className='scan-status success'; document.getElementById('startCamBtn').classList.add('hidden'); document.getElementById('stopCamBtn').classList.remove('hidden');
      isScanning = true; scanLoop(video, canvas, status, debug);
    }catch(err){ console.error('Camera error:',err); let msg = err.name==='NotAllowedError' ? 'Camera permission denied. Check browser settings.' : err.name==='NotFoundError' ? 'No camera found on this device.' : err.name==='NotReadableError' ? 'Camera is in use by another app.' : 'Camera failed: ' + err.message; status.textContent = '❌ ' + msg; status.className='scan-status error'; document.getElementById('debugInfo').textContent = 'Error: ' + (err.name || '') + ' | ' + (err.message || ''); }
  }

  async function scanLoop(video, canvas, status, debug){
    if (!isScanning || !currentStream) return;

    try{
      if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0){
        // Try native BarcodeDetector
        if ('BarcodeDetector' in window){
          try{
            const detector = new BarcodeDetector({formats:['qr_code']});
            const detections = await detector.detect(video);
            if (detections && detections.length){ handleScan(detections[0].rawValue); stopCamera(); return; }
          }catch(e){ /* fallback to worker */ }
        }

        // Draw to canvas and send ImageData to worker
        const maxDim = 640;
        let w = video.videoWidth, h = video.videoHeight;
        if (w > maxDim || h > maxDim){ const ratio = Math.min(maxDim/w, maxDim/h); w = Math.floor(w*ratio); h = Math.floor(h*ratio); }
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(video, 0, 0, w, h);
        const imageData = ctx.getImageData(0,0,w,h);

        if (decodeWorker && workerReady){
          // Transfer buffer to worker
          decodeWorker.postMessage({buffer: imageData.data.buffer, width: imageData.width, height: imageData.height}, [imageData.data.buffer]);
          // Worker will return result asynchronously
        } else {
          // Fallback: run jsQR on main thread
          try{
            const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
            if (code && code.data){ handleScan(code.data); stopCamera(); return; }
          }catch(e){}
        }

        if (Math.random() < 0.05) debug.textContent = `Scanning... ${w}x${h} | ReadyState: ${video.readyState}`;
      }
    }catch(e){ console.error('scanLoop error', e); }

    rafId = requestAnimationFrame(()=> scanLoop(video, canvas, status, debug));
  }

  function stopCamera(){ isScanning=false; if (rafId){ cancelAnimationFrame(rafId); rafId=null; } if (currentStream){ currentStream.getTracks().forEach(t=>t.stop()); currentStream=null; } const video=document.getElementById('scanVideo'); if (video){ video.srcObject = null; video.pause(); } document.getElementById('startCamBtn').classList.remove('hidden'); document.getElementById('stopCamBtn').classList.add('hidden'); document.getElementById('scanStatus').textContent = 'Camera stopped'; document.getElementById('scanStatus').className='scan-status'; }

  // Worker setup
  function startWorker(){ try{ decodeWorker = new Worker('src/qr-worker.js'); decodeWorker.onmessage = (ev)=>{
      const msg = ev.data; if (msg && msg.code){ handleScan(msg.code); stopCamera(); } else { /* no code */ }
      // mark worker ready after first message
      workerReady = true;
    }; decodeWorker.onerror = (e)=>{ console.error('worker error', e); decodeWorker = null; workerReady = false; };
  }catch(e){ console.warn('worker not available', e); decodeWorker = null; workerReady=false; } }

  // Photo scan
  async function scanPhoto(input){
    if (!input || !input.files || !input.files[0]) return;
    try{
      const img = await createImageBitmap(input.files[0]);
      const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height; const ctx = canvas.getContext('2d'); ctx.drawImage(img,0,0);
      const imageData = ctx.getImageData(0,0,canvas.width,canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
      if (code && code.data) handleScan(code.data); else throw new Error('No QR found');
    }catch(err){ showResult('invalid','❌','No QR Found','Could not read QR from photo. Try again.'); }
    input.value = '';
  }

  function verifyManual(){ const code = document.getElementById('manualCode').value.trim().toUpperCase(); if (!code) return; handleScan(code); document.getElementById('manualCode').value = ''; }

  function handleScan(code){ stopCamera(); const ticket = tickets.find(t=>t.code===code); const result = document.getElementById('scanResult'); result.className = 'scan-result show'; if (!ticket){ showResult('invalid','❌','Invalid Ticket','Code not found: ' + code); } else if (ticket.status === 'used'){ showResult('used','⚠️','Already Used', `${ticket.name} — checked in at ${ticket.usedAt}`); } else { showResult('valid','✅','Welcome!', `${ticket.name} | ${ticket.type} | ₦${Number(ticket.amount||0).toFixed(2)}`); ticket.status='used'; ticket.usedAt = new Date().toISOString(); ticket.checkedInBy = deviceId; saveToCloud(); updateUI(); } document.getElementById('scanAgain').style.display='block'; }

  function showResult(type, icon, title, msg){ document.getElementById('scanResult').className = 'scan-result show ' + type; document.getElementById('scanIcon').textContent = icon; document.getElementById('scanTitle').textContent = title; document.getElementById('scanMessage').textContent = msg; }

  function resetScan(){ document.getElementById('scanResult').className='scan-result'; document.getElementById('scanAgain').style.display='none'; document.getElementById('debugInfo').textContent=''; if (scanMode==='live'){ document.getElementById('scanStatus').textContent='Tap "Start Camera" to begin'; document.getElementById('scanStatus').className='scan-status'; } }

  // Manage actions
  window.markUsed = function(id){ const t = tickets.find(x=>x.id===id); if (t){ t.status='used'; t.usedAt = new Date().toISOString(); t.checkedInBy=deviceId; saveToCloud(); updateUI(); } };
  window.markValid = function(id){ const t = tickets.find(x=>x.id===id); if (t){ t.status='valid'; t.usedAt = null; saveToCloud(); updateUI(); } };
  window.deleteTicket = function(id){ if (!confirm('Delete this ticket?')) return; tickets = tickets.filter(t=>t.id!==id); // remove from firebase
    if (db) db.ref(`tickets/${id}`).remove(); else localStorage.setItem('partyTickets', JSON.stringify(tickets)); updateUI(); if (tickets.length===0) document.getElementById('qrSection').style.display='none'; };

  function clearAll(){ if (!confirm('Delete ALL tickets?')) return; tickets=[]; if (db) db.ref('tickets').remove(); else localStorage.removeItem('partyTickets'); document.getElementById('qrSection').style.display='none'; updateUI(); }

  function exportData(){ const data = JSON.stringify(tickets, null, 2); const blob = new Blob([data], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='tickets.json'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }
  function printTickets(){ window.print(); }

  // Expose some functions globally for HTML hooks (if any remain)
  window.startCamera = startCamera; window.stopCamera = stopCamera; window.scanPhoto = scanPhoto; window.verifyManual = verifyManual; window.handleScan = handleScan; window.showResult = showResult; window.resetScan = resetScan; window.generateTicket = generateTicket; window.saveToCloud = saveToCloud; window.updateUI = updateUI;
})();
