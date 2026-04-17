// ==UserScript==  
// @name         ArbPay Auto Buyer  
// @namespace    http://tampermonkey.net/  
// @version      1.0  
// @description  Auto-buy orders on arbpay.me instantly with start/stop control  
// @author       YourName  
// @match        https://arbpay.me/*  
// @grant        none  
// ==/UserScript==  
  
(function() {  
    'use strict';  
  
    // ==================== CONFIGURATION ====================  
    // Set your target amount (e.g., 3500, 8500). Leave null to buy ANY available order.  
    // You can also change this from the control panel UI.  
    let TARGET_AMOUNT = null;          // null = buy first available order  
    let SCAN_INTERVAL_MS = 100;        // How often to scan for new orders (milliseconds)  
    let AUTO_STOP_AFTER_BUY = true;    // Stop auto-buy after first successful purchase  
    let CLICK_DELAY_MS = 0;            // Delay before clicking (0 = as fast as possible)  
  
    // ==================== STATE ====================  
    let isRunning = false;  
    let scanIntervalId = null;  
    let clickedButtons = new WeakSet();  // Track clicked buttons to avoid double-clicking  
    let observer = null;                 // MutationObserver for instant detection  
  
    // UI Elements  
    let controlPanel = null;  
    let logContainer = null;  
  
    // ==================== UTILITIES ====================  
    function addLog(message, isError = false) {  
        if (!logContainer) return;  
        const logEntry = document.createElement('div');  
        logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;  
        logEntry.style.color = isError ? '#ff6b6b' : '#a8e6cf';  
        logEntry.style.fontSize = '12px';  
        logEntry.style.marginBottom = '4px';  
        logEntry.style.wordBreak = 'break-word';  
        logContainer.appendChild(logEntry);  
        logContainer.scrollTop = logContainer.scrollHeight;  
        // Keep only last 100 logs  
        while (logContainer.children.length > 100) {  
            logContainer.removeChild(logContainer.firstChild);  
        }  
        console.log(`[ArbPay Bot] ${message}`);  
    }  
  
    // Extract numeric amount from element's context around the Buy button  
    function extractAmountFromButton(button) {  
        // Strategy: Search within parent hierarchy (up to 5 levels) for a numeric amount  
        // that is NOT part of "Reward" or "Limit" text.  
        let maxDepth = 5;  
        let current = button;  
        for (let depth = 0; depth < maxDepth && current; depth++) {  
            // Check direct text content of current element  
            let text = current.textContent || '';  
            // Look for numbers (including comma separators) that are likely the order amount  
            // Filter out lines containing "Reward", "Limit", "Buy", "USDT", etc.  
            let lines = text.split(/\r?\n/);  
            for (let line of lines) {  
                line = line.trim();  
                if (!line) continue;  
                // Skip lines that obviously are not the amount  
                if (/reward|limit|buy|usdt|inr|arb|pay|tip/i.test(line)) continue;  
                // Match numbers (with optional commas)  
                let match = line.match(/(\d{1,3}(?:,\d{3})*|\d+)/);  
                if (match) {  
                    let rawNumber = match[1].replace(/,/g, '');  
                    let amount = parseInt(rawNumber, 10);  
                    if (!isNaN(amount) && amount > 0) {  
                        // Additional sanity: amount likely between 10 and 1,000,000  
                        if (amount >= 10 && amount <= 1000000) {  
                            return amount;  
                        }  
                    }  
                }  
            }  
            // Also check for elements with class containing "amount"  
            let amountEl = current.querySelector('.amount, [class*="amount"], .x-row.x-row-middle.amount');  
            if (amountEl) {  
                let amountText = amountEl.textContent.trim();  
                let match = amountText.match(/(\d{1,3}(?:,\d{3})*|\d+)/);  
                if (match) {  
                    let raw = match[1].replace(/,/g, '');  
                    let amount = parseInt(raw, 10);  
                    if (!isNaN(amount) && amount > 0) return amount;  
                }  
            }  
            current = current.parentElement;  
        }  
        return null;  
    }  
  
    // Find all available Buy buttons with their associated amounts  
    function findBuyOrders() {  
        // Select all potential buy buttons (various selectors from the site)  
        let buttons = document.querySelectorAll('button, .van-button, [role="button"], .x-btn, .bottom');  
        let orders = [];  
  
        for (let btn of buttons) {  
            // Check if button text is "Buy" (case-insensitive, trim)  
            let btnText = btn.textContent.trim().toLowerCase();  
            if (btnText === 'buy' || btnText.includes('buy') && btnText.length < 10) {  
                // Skip already clicked buttons  
                if (clickedButtons.has(btn)) continue;  
                // Check if button is disabled  
                if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') continue;  
                // Check visibility  
                const rect = btn.getBoundingClientRect();  
                if (rect.width === 0 && rect.height === 0) continue;  
  
                let amount = extractAmountFromButton(btn);  
                if (amount !== null) {  
                    orders.push({ amount, button: btn });  
                } else {  
                    // Fallback: try to find amount in previous sibling or parent text  
                    let parentText = btn.parentElement?.textContent || '';  
                    let match = parentText.match(/(\d{1,3}(?:,\d{3})*|\d+)/);  
                    if (match) {  
                        let amt = parseInt(match[1].replace(/,/g, ''), 10);  
                        if (!isNaN(amt) && amt > 0) orders.push({ amount: amt, button: btn });  
                    }  
                }  
            }  
        }  
        return orders;  
    }  
  
    // Perform click on the button as fast as possible  
    function instantClick(button) {  
        if (!button || clickedButtons.has(button)) return false;  
        try {  
            // Mark as clicked immediately to prevent duplicate attempts  
            clickedButtons.add(button);  
            addLog(`⚡ CLICKING order! (${button.textContent.trim()})`);  
  
            // Simulate a real mouse click sequence for maximum compatibility  
            const clickEvent = new MouseEvent('click', {  
                view: window,  
                bubbles: true,  
                cancelable: true,  
                buttons: 1  
            });  
            button.dispatchEvent(clickEvent);  
            // Also call native click method as fallback  
            button.click();  
  
            // Highlight the clicked button visually  
            button.style.transition = 'background 0.2s';  
            button.style.background = '#4caf50';  
            setTimeout(() => {  
                if (button) button.style.background = '';  
            }, 300);  
  
            addLog(`✅ Successfully clicked Buy button for amount`);  
            return true;  
        } catch (err) {  
            addLog(`❌ Click error: ${err.message}`, true);  
            return false;  
        }  
    }  
  
    // Main scan and buy logic  
    function scanAndBuy() {  
        if (!isRunning) return;  
  
        const orders = findBuyOrders();  
        if (orders.length === 0) {  
            // Optional: log only occasionally to avoid spam  
            return;  
        }  
  
        // Sort orders by amount (smallest first for faster purchase)  
        orders.sort((a, b) => a.amount - b.amount);  
  
        for (let order of orders) {  
            // Check if target amount matches (if specified)  
            if (TARGET_AMOUNT !== null && order.amount !== TARGET_AMOUNT) {  
                continue;  
            }  
  
            // Found a matching order  
            addLog(`🎯 Found order: ${order.amount} → Clicking...`);  
            if (CLICK_DELAY_MS > 0) {  
                setTimeout(() => instantClick(order.button), CLICK_DELAY_MS);  
            } else {  
                instantClick(order.button);  
            }  
  
            if (AUTO_STOP_AFTER_BUY) {  
                addLog(`🛑 Auto-stop enabled. Stopping bot after purchase.`);  
                stopBot();  
            }  
            return; // Only buy one order per scan cycle  
        }  
    }  
  
    // MutationObserver callback for instant DOM changes  
    function onDomMutation(mutations) {  
        if (!isRunning) return;  
        // Check if any new nodes were added that might contain Buy buttons  
        let shouldScan = false;  
        for (let mutation of mutations) {  
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {  
                shouldScan = true;  
                break;  
            }  
            if (mutation.type === 'characterData' || mutation.type === 'subtree') {  
                shouldScan = true;  
                break;  
            }  
        }  
        if (shouldScan) {  
            // Immediate scan (microtask)  
            setTimeout(() => scanAndBuy(), 0);  
        }  
    }  
  
    function startBot() {  
        if (isRunning) {  
            addLog(`⚠️ Bot is already running!`);  
            return;  
        }  
        isRunning = true;  
  
        // Clear any existing interval  
        if (scanIntervalId) clearInterval(scanIntervalId);  
        // Start periodic scanning  
        scanIntervalId = setInterval(() => {  
            if (isRunning) scanAndBuy();  
        }, SCAN_INTERVAL_MS);  
  
        // Setup MutationObserver for instant detection (faster than interval)  
        observer = new MutationObserver(onDomMutation);  
        observer.observe(document.body, {  
            childList: true,  
            subtree: true,  
            attributes: false,  
            characterData: false  
        });  
  
        // Initial scan  
        scanAndBuy();  
        addLog(`🚀 Bot STARTED | Target: ${TARGET_AMOUNT === null ? 'ANY amount' : TARGET_AMOUNT} | Scan: ${SCAN_INTERVAL_MS}ms`);  
    }  
  
    function stopBot() {  
        if (!isRunning) {  
            addLog(`ℹ️ Bot is already stopped.`);  
            return;  
        }  
        isRunning = false;  
        if (scanIntervalId) {  
            clearInterval(scanIntervalId);  
            scanIntervalId = null;  
        }  
        if (observer) {  
            observer.disconnect();  
            observer = null;  
        }  
        addLog(`🛑 Bot STOPPED`);  
    }  
  
    // ==================== UI CONTROL PANEL ====================  
    function createControlPanel() {  
        if (controlPanel) controlPanel.remove();  
  
        controlPanel = document.createElement('div');  
        controlPanel.id = 'arbpay-autobuy-panel';  
        controlPanel.style.cssText = `  
            position: fixed;  
            bottom: 20px;  
            right: 20px;  
            width: 320px;  
            background: #1e1e2f;  
            color: #fff;  
            border-radius: 12px;  
            padding: 12px;  
            font-family: 'Roboto', 'Segoe UI', sans-serif;  
            font-size: 13px;  
            z-index: 999999;  
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);  
            backdrop-filter: blur(8px);  
            border: 1px solid #333;  
            user-select: none;  
        `;  
  
        // Header with drag handle  
        const header = document.createElement('div');  
        header.style.cssText = `  
            display: flex;  
            justify-content: space-between;  
            align-items: center;  
            margin-bottom: 10px;  
            cursor: move;  
            padding-bottom: 6px;  
            border-bottom: 1px solid #333;  
        `;  
        header.innerHTML = `<strong>⚡ ArbPay Auto Buyer</strong> <span style="font-size:10px; color:#aaa;">v1.0</span>`;  
        controlPanel.appendChild(header);  
  
        // Target amount input  
        const targetRow = document.createElement('div');  
        targetRow.style.marginBottom = '8px';  
        targetRow.innerHTML = `  
            <label style="display:flex; justify-content:space-between; align-items:center;">  
                <span>🎯 Target Amount:</span>  
                <input type="number" id="targetAmountInput" placeholder="Any (empty)" style="width:120px; padding:4px; border-radius:6px; border:none; background:#2d2d3a; color:#fff;">  
            </label>  
        `;  
        controlPanel.appendChild(targetRow);  
  
        // Settings row  
        const settingsRow = document.createElement('div');  
        settingsRow.style.marginBottom = '8px';  
        settingsRow.style.display = 'flex';  
        settingsRow.style.gap = '8px';  
        settingsRow.style.flexWrap = 'wrap';  
        settingsRow.innerHTML = `  
            <div style="flex:1;">  
                <label style="font-size:11px;">Scan (ms)</label>  
                <input type="number" id="scanIntervalInput" value="${SCAN_INTERVAL_MS}" step="50" style="width:100%; padding:4px; border-radius:6px; background:#2d2d3a; color:#fff; border:none;">  
            </div>  
            <div style="flex:1;">  
                <label style="font-size:11px;">Click Delay (ms)</label>  
                <input type="number" id="clickDelayInput" value="${CLICK_DELAY_MS}" step="0" style="width:100%; padding:4px; border-radius:6px; background:#2d2d3a; color:#fff; border:none;">  
            </div>  
        `;  
        controlPanel.appendChild(settingsRow);  
  
        // Auto-stop checkbox  
        const autoStopRow = document.createElement('div');  
        autoStopRow.style.marginBottom = '10px';  
        autoStopRow.innerHTML = `  
            <label style="display:flex; align-items:center; gap:6px;">  
                <input type="checkbox" id="autoStopCheckbox" ${AUTO_STOP_AFTER_BUY ? 'checked' : ''}>  
                <span>🛑 Stop after first buy</span>  
            </label>  
        `;  
        controlPanel.appendChild(autoStopRow);  
  
        // Buttons container  
        const buttonRow = document.createElement('div');  
        buttonRow.style.display = 'flex';  
        buttonRow.style.gap = '10px';  
        buttonRow.style.marginBottom = '12px';  
        const startBtn = document.createElement('button');  
        startBtn.textContent = '▶ START';  
        startBtn.style.cssText = 'flex:1; background:#2ecc71; border:none; padding:6px; border-radius:8px; font-weight:bold; cursor:pointer; color:#fff;';  
        const stopBtn = document.createElement('button');  
        stopBtn.textContent = '⏹ STOP';  
        stopBtn.style.cssText = 'flex:1; background:#e74c3c; border:none; padding:6px; border-radius:8px; font-weight:bold; cursor:pointer; color:#fff;';  
        buttonRow.appendChild(startBtn);  
        buttonRow.appendChild(stopBtn);  
        controlPanel.appendChild(buttonRow);  
  
        // Log area  
        logContainer = document.createElement('div');  
        logContainer.style.cssText = `  
            background: #0a0a12;  
            border-radius: 8px;  
            height: 150px;  
            overflow-y: auto;  
            padding: 6px;  
            font-family: monospace;  
            font-size: 11px;  
            margin-top: 6px;  
            border: 1px solid #2a2a3a;  
        `;  
        logContainer.innerHTML = '<div style="color:#aaa;">📋 Ready. Click START to begin auto-buy.</div>';  
        controlPanel.appendChild(logContainer);  
  
        document.body.appendChild(controlPanel);  
  
        // Event listeners  
        const targetInput = document.getElementById('targetAmountInput');  
        const scanInput = document.getElementById('scanIntervalInput');  
        const clickDelayInput = document.getElementById('clickDelayInput');  
        const autoStopCheck = document.getElementById('autoStopCheckbox');  
  
        targetInput.addEventListener('change', (e) => {  
            const val = e.target.value.trim();  
            TARGET_AMOUNT = val === '' ? null : parseInt(val, 10);  
            addLog(`Target amount set to: ${TARGET_AMOUNT === null ? 'ANY' : TARGET_AMOUNT}`);  
        });  
        scanInput.addEventListener('change', (e) => {  
            let newVal = parseInt(e.target.value, 10);  
            if (!isNaN(newVal) && newVal >= 50) {  
                SCAN_INTERVAL_MS = newVal;  
                if (isRunning) {  
                    // Restart interval with new timing  
                    if (scanIntervalId) clearInterval(scanIntervalId);  
                    scanIntervalId = setInterval(() => {  
                        if (isRunning) scanAndBuy();  
                    }, SCAN_INTERVAL_MS);  
                    addLog(`Scan interval updated to ${SCAN_INTERVAL_MS}ms`);  
                }  
            } else {  
                e.target.value = SCAN_INTERVAL_MS;  
            }  
        });  
        clickDelayInput.addEventListener('change', (e) => {  
            let newDelay = parseInt(e.target.value, 10);  
            if (!isNaN(newDelay) && newDelay >= 0) {  
                CLICK_DELAY_MS = newDelay;  
                addLog(`Click delay set to ${CLICK_DELAY_MS}ms`);  
            } else {  
                e.target.value = CLICK_DELAY_MS;  
            }  
        });  
        autoStopCheck.addEventListener('change', (e) => {  
            AUTO_STOP_AFTER_BUY = e.target.checked;  
            addLog(`Auto-stop after buy: ${AUTO_STOP_AFTER_BUY ? 'ON' : 'OFF'}`);  
        });  
  
        startBtn.addEventListener('click', startBot);  
        stopBtn.addEventListener('click', stopBot);  
  
        // Make panel draggable  
        let isDragging = false;  
        let dragOffsetX = 0, dragOffsetY = 0;  
        header.addEventListener('mousedown', (e) => {  
            if (e.target === startBtn || e.target === stopBtn) return;  
            isDragging = true;  
            dragOffsetX = e.clientX - controlPanel.offsetLeft;  
            dragOffsetY = e.clientY - controlPanel.offsetTop;  
            controlPanel.style.cursor = 'grabbing';  
            e.preventDefault();  
        });  
        window.addEventListener('mousemove', (e) => {  
            if (!isDragging) return;  
            let newLeft = e.clientX - dragOffsetX;  
            let newTop = e.clientY - dragOffsetY;  
            newLeft = Math.max(0, Math.min(window.innerWidth - controlPanel.offsetWidth, newLeft));  
            newTop = Math.max(0, Math.min(window.innerHeight - controlPanel.offsetHeight, newTop));  
            controlPanel.style.left = newLeft + 'px';  
            controlPanel.style.top = newTop + 'px';  
            controlPanel.style.right = 'auto';  
            controlPanel.style.bottom = 'auto';  
        });  
        window.addEventListener('mouseup', () => {  
            isDragging = false;  
            controlPanel.style.cursor = 'default';  
        });  
    }  
  
    // ==================== INIT ====================  
    function init() {  
        // Wait for DOM to be ready  
        if (document.readyState === 'loading') {  
            document.addEventListener('DOMContentLoaded', createControlPanel);  
        } else {  
            createControlPanel();  
        }  
        addLog('🤖 ArbPay Auto Buyer loaded. Configure target & press START.');  
    }  
  
    init();  
})();

Will it work
