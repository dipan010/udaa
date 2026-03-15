// background.js
// Service worker managing extension lifecycle and the WebSocket bridge

let ws = null;
let streamingInterval = null;
let currentSessionId = null;

// Track tabs where content_script.js is already running to avoid re-injection errors
const injectedTabs = new Set();

chrome.runtime.onInstalled.addListener(() => {
    console.log("UDAA Live Controller installed.");
});

function connectWebSocket(sessionId) {
    if (ws) ws.close();
    currentSessionId = sessionId;

    ws = new WebSocket(`ws://localhost:8080/ws/live_ext/${sessionId}`);

    ws.onopen = () => {
        console.log("UDAA Extension: Connected to backend for session", sessionId);
        startStreamingFrames();
    };

    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === "execute_action") {
            executeInActiveTab(message);
        } else if (message.type === "stop_stream") {
            stopStreamingFrames();
        } else if (message.type === "status") {
            // Forward status to the active tab to render the UI banner
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs.length === 0) return;

                // Ensure scripts are injected before sending status
                const tabId = tabs[0].id;
                if (injectedTabs.has(tabId)) {
                    chrome.tabs.sendMessage(tabId, { type: "UDAA_STATUS", payload: message });
                    return;
                }

                chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    files: ["overlay.js", "content_script.js"]
                }, () => {
                    injectedTabs.add(tabId);
                    chrome.tabs.sendMessage(tabId, {
                        type: "UDAA_STATUS",
                        payload: message
                    });
                });
            });
        } else if (message.type === "action_preview") {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs.length === 0) return;
                const tabId = tabs[0].id;
                if (injectedTabs.has(tabId)) {
                    chrome.tabs.sendMessage(tabId, { type: "ACTION_PREVIEW", payload: message });
                    return;
                }

                chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    files: ["overlay.js", "content_script.js"]
                }, () => {
                    injectedTabs.add(tabId);
                    chrome.tabs.sendMessage(tabId, {
                        type: "ACTION_PREVIEW",
                        payload: message
                    });
                });
            });
        }
    };

    ws.onclose = () => {
        console.log("UDAA Extension: Disconnected");
        stopStreamingFrames();
    };
}

function executeInActiveTab(command) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0) return;
        const activeTab = tabs[0];

        // Inject overlay if not already present
        try {
            if (injectedTabs.has(activeTab.id)) {
                _sendMessageToActionScript(activeTab.id, command);
                return;
            }

            chrome.scripting.executeScript({
                target: { tabId: activeTab.id },
                files: ["overlay.js", "content_script.js"]
            }, () => {
                if (chrome.runtime.lastError) {
                    console.warn("UDAA Extension: Could not inject scripts:", chrome.runtime.lastError.message);
                } else {
                    injectedTabs.add(activeTab.id);
                }
                _sendMessageToActionScript(activeTab.id, command);
            });
        } catch (e) {
            console.error("UDAA Extension: Failed to execute tab action", e);
        }
    });
}

function _sendMessageToActionScript(tabId, command) {
    chrome.tabs.sendMessage(tabId, {
        type: "EXECUTE_ACTION",
        payload: { action: command.action, args: command }
    }, (response) => {
        if (chrome.runtime.lastError) {
            console.warn("UDAA Extension: Could not send message to tab:", chrome.runtime.lastError.message);
        }

        // Report result back to backend
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: "action_result",
                result: response || { action: command.action, success: false, detail: "No response from tab" }
            }));
        }
    });
}

function startStreamingFrames() {
    if (streamingInterval) return;
    // Capture screen at ~1 FPS (1200ms) to avoid MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND Chrome errors
    streamingInterval = setInterval(() => {
        chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
            if (chrome.runtime.lastError) {
                // Silently ignore "tabs cannot be edited" or dragging errors
                return;
            }

            if (dataUrl && ws && ws.readyState === WebSocket.OPEN) {
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    let url = "unknown";
                    if (tabs && tabs.length > 0) url = tabs[0].url;

                    ws.send(JSON.stringify({
                        type: "screen_frame",
                        image: dataUrl.split(',')[1],
                        url: url
                    }));
                });
            }
        });
    }, 1200);
}

function stopStreamingFrames() {
    if (streamingInterval) {
        clearInterval(streamingInterval);
        streamingInterval = null;
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "CONNECT_WS") {
        console.log("UDAA Extension: Received auto-connect request for session", request.sessionId);
        connectWebSocket(request.sessionId);
    }
});

// Background polling failsafe: check active tabs periodically for the session ID
// This catches cases where content_script.js is blocked from running (e.g., chrome:// or restricted pages)
let activeTabPolling = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) return; // Already connected

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || tabs.length === 0) return;
        const url = tabs[0].url;
        if (!url) return;

        try {
            const urlObj = new URL(url);
            const sessionId = urlObj.searchParams.get('udaa_session_id');
            if (sessionId && sessionId !== currentSessionId) {
                console.log("UDAA Background Polling: Found session ID in tab URL", sessionId);
                connectWebSocket(sessionId);
            }
        } catch (e) {
            // Invalid URL (e.g. chrome://), ignore
        }
    });
}, 1000);

// Keep manual fallback just in case
chrome.action.onClicked.addListener((tab) => {
    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (current) => prompt("Enter UDAA Session ID to connect Live Browser:", current || ""),
        args: [currentSessionId]
    }, (results) => {
        if (chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError.message);
            return;
        }
        if (results && results[0] && results[0].result) {
            connectWebSocket(results[0].result);
        }
    });
});

// ── Tab Lifecycle Management ────────────────────────────────────────────────
// Clear injection flag on hard reloads or manual URL navigations.
// Without this, the agent would block itself from working after a page refresh.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    // Detect hard reload or new URL navigation
    if (changeInfo.status === 'loading' && changeInfo.url) {
        console.log(`UDAA: Tab ${tabId} reloaded/navigated. Resetting injection state.`);
        injectedTabs.delete(tabId);
    }
});

// Crucial: forget tabs when they are closed to prevent memory leaks
chrome.tabs.onRemoved.addListener((tabId) => {
    injectedTabs.delete(tabId);
});
