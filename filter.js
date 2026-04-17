// ==UserScript==
// @name         ArbPay Ultra Fast Auto Buyer
// @namespace    https://arbpay.me/
// @version      2.0
// @description  Instantly clicks matching Buy orders on arbpay.me – beats the crowd
// @author       YourGitHub
// @match        https://arbpay.me/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // -------------------- CONFIGURATION --------------------
    let TARGET_AMOUNT = null;          // null = any amount, else number (e.g. 3500)
    let SCAN_INTERVAL_MS = 30;         // milliseconds between scans (lower = faster)
    let AUTO_STOP_AFTER_BUY = true;    // stop bot after first successful purchase
    let CLICK_DELAY_MS = 0;            // extra delay before click (0 = instant)

    // -------------------- INTERNAL STATE --------------------
    let isRunning = false;
    let scanIntervalId = null;
    let observer = null;
    let clickedButtons = new WeakSet();   // prevent double-click on same button
    let logContainer = null;
    let controlPanel = null;

    // -------------------- UTILITIES --------------------
    function addLog(msg, isError = false) {
        if (!logContainer) return;
        const logDiv = document.createElement('div');
        logDiv.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        logDiv.style.color = isError ? '#ff8888' : '#aaffdd';
        logDiv.style.fontSize = '11px';
        logDiv.style.marginBottom = '3px';
        logDiv.style.wordBreak = 'break-word';
        logContainer.appendChild(logDiv);
        logContainer.scrollTop = logContainer.scrollHeight;
        while (logContainer.children.length > 80) logContainer.removeChild(logContainer.firstChild);
        console.log(`[ArbBuy] ${msg}`);
    }

    // Extract numeric amount from DOM elements around the Buy button
    function extractAmount(button) {
        // Search up to 5 levels up in the DOM
        let parent = button.parentElement;
        for (let i = 0; i < 5 && parent; i++) {
            // Look for elements with class containing 'amount' or 'x-row'
            const amountElem = parent.querySelector('.amount, [class*="amount"], .x-row.x-row-middle.amount');
            if (amountElem) {
                const txt = amountElem.innerText.trim();
                const match = txt.match(/(\d{1,3}(?:,\d{3})*|\d+)/);
                if (match) return parseInt(match[1].replace(/,/g, ''), 10);
            }
            // Check direct text of parent (lines)
            const lines = parent.innerText.split(/\r?\n/);
            for (let line of lines) {
                if (/reward|limit|buy|usdt|inr|pay/i.test(line)) continue;
                const match = line.match(/(\d{1,3}(?:,\d{3})*|\d+)/);
                if (match) {
                    const val = parseInt(match[1].replace(/,/g, ''), 10);
                    if (val > 0 && val < 10000000) return val;
                }
            }
            parent = parent.parentElement;
        }
        return null;
    }

    // Find all available Buy buttons with their amounts
    function findBuyOrders() {
        const buttons = document.querySelectorAll('button, .van-button, [role="button"], .x-btn, .bottom');
        const orders = [];
        for (const btn of buttons) {
            const text = btn.innerText.trim().toLowerCase();
            if ((text === 'buy' || text.includes('buy')) && text.length < 10) {
                if (clickedButtons.has(btn)) continue;
                if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') continue;
                const rect = btn.getBoundingClientRect();
                if (rect.width === 0 && rect.height === 0) continue;
                let amount = extractAmount(btn);
                if (amount !== null) orders.push({ amount, button: btn });
            }
        }
        return orders;
    }

    // Instant click with multiple fallbacks
    function instantClick(btn, amount) {
        if (!btn || clickedButtons.has(btn)) return false;
        clickedButtons.add(btn);
        addLog(`⚡ CLICKING order for ${amount}`);
        // Visual feedback
        btn.style.transition = '0.1s';
        btn.style.transform = 'scale(0.98)';
        setTimeout(() => { if(btn) btn.style.transform = ''; }, 100);
        // Native click + MouseEvent
        try {
            btn.click();
            const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
            btn.dispatchEvent(ev);
        } catch(e) { addLog(`Click error: ${e.message}`, true); }
        return true;
    }

    // Main scan & buy routine
    function scanAndBuy() {
        if (!isRunning) return;
        const orders = findBuyOrders();
        if (orders.length === 0) return;
        // Sort smallest first (faster to execute)
        orders.sort((a,b) => a.amount - b.amount);
        for (const order of orders) {
            if (TARGET_AMOUNT !== null && order.amount !== TARGET_AMOUNT) continue;
            addLog(`🎯 Found target ${order.amount} → buying`);
            if (CLICK_DELAY_MS > 0) {
                setTimeout(() => instantClick(order.button, order.amount), CLICK_DELAY_MS);
            } else {
                instantClick(order.button, order.amount);
            }
            if (AUTO_STOP_AFTER_BUY) {
                addLog(`🛑 Auto‑stop enabled – stopping bot`);
                stopBot();
            }
            return; // only one order per scan cycle
        }
    }

    // MutationObserver for immediate DOM changes (faster than interval alone)
    function onMutation(mutations) {
        if (!isRunning) return;
        for (const m of mutations) {
            if (m.type === 'childList' && m.addedNodes.length) {
                scanAndBuy();
                break;
            }
        }
    }

    function startBot() {
        if (isRunning) { addLog(`Already running`); return; }
        isRunning = true;
        if (scanIntervalId) clearInterval(scanIntervalId);
        scanIntervalId = setInterval(() => { if(isRunning) scanAndBuy(); }, SCAN_INTERVAL_MS);
        observer = new MutationObserver(onMutation);
        observer.observe(document.body, { childList: true, subtree: true });
        scanAndBuy();
        addLog(`🚀 BOT STARTED | Target: ${TARGET_AMOUNT || 'ANY'} | Scan: ${SCAN_INTERVAL_MS}ms`);
    }

    function stopBot() {
        if (!isRunning) { addLog(`Already stopped`); return; }
        isRunning = false;
        if (scanIntervalId) { clearInterval(scanIntervalId); scanIntervalId = null; }
        if (observer) { observer.disconnect(); observer = null; }
        addLog(`⏹ BOT STOPPED`);
    }

    // -------------------- UI CONTROL PANEL (draggable) --------------------
    function createPanel() {
        if (controlPanel) controlPanel.remove();
        controlPanel = document.createElement('div');
        controlPanel.id = 'arb-autobuy-panel';
        controlPanel.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 280px;
            background: #0a0a1a;
            color: #eee;
            border-radius: 12px;
            padding: 12px;
            font-family: monospace;
            font-size: 13px;
            z-index: 999999;
            box-shadow: 0 4px 20px rgba(0,0,0,0.6);
            border: 1px solid #fac10c;
            backdrop-filter: blur(4px);
            user-select: none;
        `;

        // Header (drag handle)
        const header = document.createElement('div');
        header.innerHTML = `<strong style="color:#fac10c;">⚡ ARB AUTO BUYER</strong> <span style="float:right;font-size:10px;">v2.0</span>`;
        header.style.cssText = 'cursor:move; margin-bottom:10px; border-bottom:1px solid #333; padding-bottom:5px;';
        controlPanel.appendChild(header);

        // Target input row
        const targetRow = document.createElement('div');
        targetRow.style.marginBottom = '8px';
        targetRow.innerHTML = `
            <label style="display:flex; justify-content:space-between;">
                <span>🎯 Target amount:</span>
                <input type="number" id="arbTargetInput" placeholder="Any" style="width:120px; background:#222; color:#fff; border:1px solid #fac10c; border-radius:4px; padding:4px;">
            </label>
        `;
        controlPanel.appendChild(targetRow);

        // Scan interval & delay
        const settingsRow = document.createElement('div');
        settingsRow.style.display = 'flex';
        settingsRow.style.gap = '8px';
        settingsRow.style.marginBottom = '8px';
        settingsRow.innerHTML = `
            <div style="flex:1">
                <label style="font-size:10px;">Scan(ms)</label>
                <input type="number" id="arbScanInterval" value="${SCAN_INTERVAL_MS}" step="10" style="width:100%; background:#222; color:#fff; border:1px solid #555; border-radius:4px;">
            </div>
            <div style="flex:1">
                <label style="font-size:10px;">Click delay(ms)</label>
                <input type="number" id="arbClickDelay" value="${CLICK_DELAY_MS}" step="0" style="width:100%; background:#222; color:#fff; border:1px solid #555; border-radius:4px;">
            </div>
        `;
        controlPanel.appendChild(settingsRow);

        // Auto-stop checkbox
        const autoStopRow = document.createElement('div');
        autoStopRow.style.marginBottom = '10px';
        autoStopRow.innerHTML = `
            <label style="display:flex; align-items:center; gap:6px;">
                <input type="checkbox" id="arbAutoStop" ${AUTO_STOP_AFTER_BUY ? 'checked' : ''}>
                <span>🛑 Stop after first buy</span>
            </label>
        `;
        controlPanel.appendChild(autoStopRow);

        // Buttons
        const btnRow = document.createElement('div');
        btnRow.style.display = 'flex';
        btnRow.style.gap = '10px';
        btnRow.style.marginBottom = '12px';
        const startBtn = document.createElement('button');
        startBtn.textContent = '▶ START';
        startBtn.style.cssText = 'flex:1; background:#2ecc71; border:none; padding:6px; border-radius:8px; font-weight:bold; cursor:pointer;';
        const stopBtn = document.createElement('button');
        stopBtn.textContent = '⏹ STOP';
        stopBtn.style.cssText = 'flex:1; background:#e74c3c; border:none; padding:6px; border-radius:8px; font-weight:bold; cursor:pointer;';
        btnRow.appendChild(startBtn);
        btnRow.appendChild(stopBtn);
        controlPanel.appendChild(btnRow);

        // Log area
        logContainer = document.createElement('div');
        logContainer.style.cssText = 'background:#000; border-radius:6px; height:120px; overflow-y:auto; padding:6px; font-size:10px; border:1px solid #333;';
        logContainer.innerHTML = '<div style="color:#aaa;">⚡ Ready. Set target and press START.</div>';
        controlPanel.appendChild(logContainer);

        document.body.appendChild(controlPanel);

        // --- event listeners ---
        const targetInput = document.getElementById('arbTargetInput');
        const scanInput = document.getElementById('arbScanInterval');
        const delayInput = document.getElementById('arbClickDelay');
        const autoStopCheck = document.getElementById('arbAutoStop');

        targetInput.addEventListener('change', (e) => {
            const val = e.target.value.trim();
            TARGET_AMOUNT = val === '' ? null : parseInt(val, 10);
            addLog(`Target set to ${TARGET_AMOUNT || 'ANY'}`);
        });
        scanInput.addEventListener('change', (e) => {
            let val = parseInt(e.target.value, 10);
            if (val >= 20) {
                SCAN_INTERVAL_MS = val;
                if (isRunning) {
                    clearInterval(scanIntervalId);
                    scanIntervalId = setInterval(() => { if(isRunning) scanAndBuy(); }, SCAN_INTERVAL_MS);
                    addLog(`Scan interval → ${SCAN_INTERVAL_MS}ms`);
                }
            } else e.target.value = SCAN_INTERVAL_MS;
        });
        delayInput.addEventListener('change', (e) => {
            let val = parseInt(e.target.value, 10);
            if (!isNaN(val) && val >= 0) CLICK_DELAY_MS = val;
            else e.target.value = CLICK_DELAY_MS;
            addLog(`Click delay → ${CLICK_DELAY_MS}ms`);
        });
        autoStopCheck.addEventListener('change', (e) => {
            AUTO_STOP_AFTER_BUY = e.target.checked;
            addLog(`Auto‑stop: ${AUTO_STOP_AFTER_BUY ? 'ON' : 'OFF'}`);
        });
        startBtn.onclick = startBot;
        stopBtn.onclick = stopBot;

        // make draggable
        let drag = false, offX, offY;
        header.onmousedown = (e) => {
            if (e.target === startBtn || e.target === stopBtn) return;
            drag = true;
            offX = e.clientX - controlPanel.offsetLeft;
            offY = e.clientY - controlPanel.offsetTop;
            controlPanel.style.cursor = 'grabbing';
            e.preventDefault();
        };
        window.onmousemove = (e) => {
            if (!drag) return;
            let left = e.clientX - offX;
            let top = e.clientY - offY;
            left = Math.min(window.innerWidth - controlPanel.offsetWidth, Math.max(0, left));
            top = Math.min(window.innerHeight - controlPanel.offsetHeight, Math.max(0, top));
            controlPanel.style.left = left + 'px';
            controlPanel.style.top = top + 'px';
            controlPanel.style.right = 'auto';
            controlPanel.style.bottom = 'auto';
        };
        window.onmouseup = () => { drag = false; if(controlPanel) controlPanel.style.cursor = 'default'; };
    }

    // wait for DOM
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createPanel);
    else createPanel();
})();
