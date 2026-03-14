// background.js
// Service worker managing extension lifecycle and the WebSocket bridge

let ws = null;
let streamingInterval = null;
let currentSessionId = null;

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
                chrome.scripting.executeScript({
                    target: { tabId: tabs[0].id },
                    files: ["overlay.js", "content_script.js"]
                }, () => {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        type: "UDAA_STATUS",
                        payload: message
                    });
                });
            });
        } else if (message.type === "action_preview") {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs.length === 0) return;
                chrome.scripting.executeScript({
                    target: { tabId: tabs[0].id },
                    files: ["overlay.js", "content_script.js"]
                }, () => {
                    chrome.tabs.sendMessage(tabs[0].id, {
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
            chrome.scripting.executeScript({
                target: { tabId: activeTab.id },
                files: ["overlay.js", "content_script.js"]
            }, () => {
                if (chrome.runtime.lastError) {
                    console.warn("UDAA Extension: Could not inject scripts:", chrome.runtime.lastError.message);
                }

                // Send message to the content script in the active tab
                chrome.tabs.sendMessage(activeTab.id, {
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
            });
        } catch (e) {
            console.error("UDAA Extension: Failed to execute tab action", e);
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
