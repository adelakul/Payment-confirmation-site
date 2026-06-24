// qr-worker.js - Web Worker for running jsQR off the main thread
// Note: import jsQR inside the worker using importScripts
importScripts('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js');

self.onmessage = function(e){
  try{
    const { buffer, width, height } = e.data;
    if (!buffer) return;
    // Reconstruct Uint8ClampedArray from transferred buffer
    const u8 = new Uint8ClampedArray(buffer);
    // jsQR expects Uint8ClampedArray with RGBA bytes
    const code = jsQR(u8, width, height, { inversionAttempts: 'attemptBoth' });
    if (code && code.data) {
      self.postMessage({ code: code.data });
    } else {
      self.postMessage({ code: null });
    }
  } catch (err) {
    self.postMessage({ code: null, error: String(err) });
  }
};
