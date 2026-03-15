// content_script.js
// Responsible for executing actions on the DOM and extracting data

window.udaaLastClickedElement = null;

function _setInputValue(element, value) {
    if (element.isContentEditable) {
        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, value);
    } else {
        const proto = element.tagName === "TEXTAREA"
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (setter) setter.call(element, value);
        else element.value = value;
    }
}

function _fireEnter(element) {
    ["keydown", "keypress", "keyup"].forEach(evType => {
        element.dispatchEvent(new KeyboardEvent(evType, {
            key: "Enter", code: "Enter", keyCode: 13, which: 13,
            bubbles: true, cancelable: true
        }));
    });
    if (element.form && document.contains(element)) {
        element.form.requestSubmit?.() ?? element.form.submit();
    }
}

function _scaleCoords(args) {
    let x = args.x ?? 0, y = args.y ?? 0;
    if (args.coordinates?.length >= 2) {
        x = Math.round((args.coordinates[0] / 1000) * window.innerWidth);
        y = Math.round((args.coordinates[1] / 1000) * window.innerHeight);
    } else if (typeof x === "number" && typeof y === "number") {
        x = Math.round((x / 1000) * window.innerWidth);
        y = Math.round((y / 1000) * window.innerHeight);
    }
    return { x, y };
}

async function executeAction(action, args) {
    if (action === "click_at" || action === "click" || action === "left_click") {
        const { x, y } = _scaleCoords(args);
        return window.udaa.performClick(x, y);

    } else if (action === "type_text_at" || action === "type") {
        if (args.x !== undefined || args.coordinates) {
            const { x, y } = _scaleCoords(args);
            window.udaa.performClick(x, y);
            await new Promise(r => setTimeout(r, 80)); // let focus settle
        }
        return window.udaa.performType(args.text);

    } else if (action === "get_current_url") {
        return { url: window.location.href };

    } else if (action === "navigate" || action === "open_web_browser") {
        if (args.url && args.url !== "about:blank") {
            window.location.href = args.url;
            await new Promise(r => setTimeout(r, 200));
        }
        return true;

    } else if (action === "hover_at" || action === "hover") {
        const { x, y } = _scaleCoords(args);
        return window.udaa.performHover(x, y);

    } else if (action === "key_combination") {
        return window.udaa.performKeyCombination(args.keys || []);

    } else if (action === "scroll_document" || action === "scroll") {
        return window.udaa.performScroll(args.direction || "down", args.amount || 3);

    } else if (action === "scroll_at") {
        const { x, y } = _scaleCoords(args);
        window.udaa.performHover(x, y);
        return window.udaa.performScroll(args.direction || "down", args.amount || 3);
    }
    return false;
}



window.udaa = {
    getDOMSnapshot: () => {
        return document.documentElement.outerHTML;
    },

    performClick: (x, y) => {
        // elementFromPoint evaluates viewport-relative coords, whereas x,y are layout relative
        // We must subtract scroll distances
        const viewportX = x - window.scrollX;
        const viewportY = y - window.scrollY;

        let element = document.elementFromPoint(viewportX, viewportY);
        // Fallback to absolute point if off-screen heuristics fail
        if (!element) element = document.elementFromPoint(x, y);

        if (element) {
            if (window.udaaOverlay) {
                window.udaaOverlay.drawHighlight(x, y);
            }

            const eventInit = {
                view: window,
                bubbles: true,
                cancelable: true,
                clientX: x,
                clientY: y,
                button: 0,
                buttons: 1
            };

            // Dispatch full event sequence for better compatibility with SPAs
            element.dispatchEvent(new PointerEvent('pointerdown', eventInit));
            element.dispatchEvent(new MouseEvent('mousedown', eventInit));
            element.dispatchEvent(new PointerEvent('pointerup', { ...eventInit, buttons: 0 }));
            element.dispatchEvent(new MouseEvent('mouseup', { ...eventInit, buttons: 0 }));
            element.dispatchEvent(new MouseEvent('click', { ...eventInit, buttons: 0 }));

            // Focus the element so that subsequent type actions target this element
            if (typeof element.focus === 'function') {
                element.focus();
            }

            // Save as fallback for performType
            window.udaaLastClickedElement = element;

            console.log(`UDAA: Clicked at ${x}, ${y}`);
            return true;
        }
        return false;
    },

    performType: (text) => {
        let element = document.activeElement;

        // If the active element is not an input, try the last clicked element (fallback for sites that steal focus)
        const isInput = (el) => el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

        if (!isInput(element)) {
            if (isInput(window.udaaLastClickedElement) && document.contains(window.udaaLastClickedElement)) {
                console.log("UDAA: Active element is not an input, falling back to last clicked element for type action.");
                element = window.udaaLastClickedElement;
                element.focus(); // Try to refocus it
            } else {
                console.warn("UDAA: No focused input for type action, and no valid fallback.");
                return false;
            }
        }

        // Dedup repeated strings (keep existing logic)
        if (text.length > 3) {
            const h = Math.floor(text.length / 2);
            if (text.slice(0, h) === text.slice(h)) text = text.slice(0, h);
            const t = Math.floor(text.length / 3);
            if (t > 2 && text.slice(0, t) === text.slice(t, t * 2)
                && text.slice(0, t) === text.slice(t * 2)) text = text.slice(0, t);
        }

        // Parse into ordered [text | special] parts
        const specialRe = /(control\+[a-z]|cmd\+[a-z]|enter|backspace(?:\*\d+)?|delete(?:\*\d+)?|tab|escape)/gi;
        const parts = [];
        let last = 0, m;
        const re = new RegExp(specialRe.source, "gi");
        while ((m = re.exec(text)) !== null) {
            if (m.index > last) parts.push({ type: "text", value: text.slice(last, m.index).trim() });
            parts.push({ type: "special", value: m[0].toLowerCase() });
            last = re.lastIndex;
        }
        if (last < text.length) {
            const r = text.slice(last).trim();
            if (r) parts.push({ type: "text", value: r });
        }

        let hasEnter = false;
        for (const part of parts) {
            if (part.type === "text" && part.value) {
                _setInputValue(element, part.value);
            } else if (part.type === "special") {
                const a = part.value;
                if (a === "control+a" || a === "cmd+a") {
                    if (element.setSelectionRange && element.value !== undefined)
                        element.setSelectionRange(0, element.value.length);
                } else if (a.startsWith("backspace")) {
                    const n = parseInt(a.match(/\*(\d+)/)?.[1] || "1");
                    if (element.value !== undefined) element.value = element.value.slice(0, -n);
                } else if (a.startsWith("delete")) {
                    if (element.value !== undefined) element.value = "";
                } else if (a === "enter") {
                    hasEnter = true;   // deferred — fire after input/change
                } else if (a === "escape") {
                    element.blur();
                }
            }
        }

        // CS-5 fix: input/change THEN enter — React state updates first
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        if (hasEnter) _fireEnter(element);

        return true;
    },

    performHover: (x, y) => {
        const element = document.elementFromPoint(x, y);
        if (element) {
            if (window.udaaOverlay) {
                window.udaaOverlay.drawHighlight(x, y);
            }
            const eventInit = {
                view: window,
                bubbles: true,
                cancelable: true,
                clientX: x,
                clientY: y
            };
            element.dispatchEvent(new PointerEvent('pointermove', eventInit));
            element.dispatchEvent(new MouseEvent('mouseover', eventInit));
            element.dispatchEvent(new MouseEvent('mouseenter', eventInit));
            element.dispatchEvent(new MouseEvent('mousemove', eventInit));
            console.log(`UDAA: Hovered at ${x}, ${y}`);
            return true;
        }
        return false;
    },

    performKeyCombination: (keysRaw) => {
        const element = document.activeElement || document.body;

        // Fix for TypeError: keys.join is not a function
        let keys = [];
        if (Array.isArray(keysRaw)) {
            keys = keysRaw;
        } else if (typeof keysRaw === 'string') {
            keys = [keysRaw];
        } else {
            return false;
        }

        console.log(`UDAA: Key combo: ${keys.join('+')}`);

        // Dispatch keydown for all
        for (let key of keys) {
            element.dispatchEvent(new KeyboardEvent('keydown', {
                key: key,
                code: key,
                bubbles: true,
                cancelable: true
            }));
        }

        // Dispatch keyup in reverse
        for (let i = keys.length - 1; i >= 0; i--) {
            element.dispatchEvent(new KeyboardEvent('keyup', {
                key: keys[i],
                code: keys[i],
                bubbles: true,
                cancelable: true
            }));
        }
        return true;
    },

    performScroll: (direction, amount = 3) => {
        const delta = direction === "down" ? amount * 100 : -(amount * 100);
        window.scrollBy({ top: delta, behavior: "smooth" });
        console.log(`UDAA: Scrolled ${direction} by ${delta}`);
        return true;
    }
};

// Listen for action commands from the background service worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "EXECUTE_ACTION") {
        (async () => {
            let success = false;
            try {
                success = await executeAction(
                    request.payload.action,
                    request.payload.args
                );
            } catch (e) {
                console.error("UDAA execution error:", e);
                sendResponse({ success: false, detail: e.toString() });
                return;
            }
            sendResponse({ success, action: request.payload.action });
        })();
        return true;  // CRITICAL: keeps message channel open for async response
    } else if (request.type === "UDAA_STATUS") {
        if (request.payload) {
            const status = request.payload.status;
            const isGP = request.payload.grandparents_mode;
            let msg = request.payload.message ? `UDAA: ${request.payload.message}` : status.toUpperCase();

            if (isGP) {
                const GP_COPY = {
                    "thinking": "Thinking about what to do next...",
                    "executing": "Working on it...",
                    "navigating": "Going to a new page...",
                    "confirming": "Double checking with you...",
                    "idle": "Ready to help",
                    "error": "Oops, something went wrong",
                    "completed": "Finished helping with this task.",
                    "cancelled": "Stopped task."
                };
                if (GP_COPY[status]) {
                    msg = GP_COPY[status];
                } else if (request.payload.message && status !== "completed") {
                    // Fallback to the natural language summary sent by the backend
                    msg = request.payload.message;
                }
            }

            const type = (status === "completed" || status === "error" || status === "timeout" || status === "cancelled")
                ? (status === "completed" ? "completed" : "error")
                : "active";

            // If the overlay library loaded, use it
            if (window.udaaOverlay && typeof window.udaaOverlay.showStatus === 'function') {
                if (status === "cancelled") {
                    window.udaaOverlay.hideStatus();
                } else {
                    window.udaaOverlay.showStatus(msg, type);
                    if (type !== 'active') {
                        setTimeout(() => window.udaaOverlay.hideStatus(), 5000);
                    }
                }
            } else {
                // Fallback: Build banner directly if overlay.js was blocked by CSP
                let banner = document.getElementById("udaa-status-banner-fallback");
                if (!banner) {
                    banner = document.createElement("div");
                    banner.id = "udaa-status-banner-fallback";
                    banner.style.position = "fixed";
                    banner.style.bottom = "20px";
                    banner.style.right = "20px";
                    banner.style.padding = "12px 20px";
                    banner.style.borderRadius = "8px";
                    banner.style.backgroundColor = "#1a1a2e";
                    banner.style.color = "#ffffff";
                    banner.style.fontFamily = "sans-serif";
                    banner.style.fontSize = "14px";
                    banner.style.fontWeight = "bold";
                    banner.style.zIndex = "999999";
                    banner.style.boxShadow = "0 4px 15px rgba(0,0,0,0.5)";
                    document.body.appendChild(banner);
                }

                banner.textContent = msg;
                if (type === 'active') {
                    banner.style.border = "2px solid #00f2fe";
                    banner.style.color = "#00f2fe";
                } else if (type === 'completed') {
                    banner.style.border = "2px solid #2ecc71";
                    banner.style.color = "#2ecc71";
                    banner.textContent = msg;
                    // Wait 3s so user can read it, THEN remove
                    setTimeout(() => { if (banner && banner.parentNode) banner.remove(); }, 3000);
                    // Also clear the pulsing animation if any
                    banner.style.animation = 'none';
                } else {
                    banner.style.border = "2px solid #e74c3c";
                    banner.style.color = "#e74c3c";
                    setTimeout(() => { if (banner && banner.parentNode) banner.remove(); }, 3000);
                }
                if (status === "cancelled") {
                    if (banner && banner.parentNode) banner.remove();
                }
            }
        }
    } else if (request.type === "ACTION_PREVIEW") {
        if (request.payload && request.payload.text) {
            const msg = `About to: ${request.payload.text}`;
            if (window.udaaOverlay && typeof window.udaaOverlay.showStatus === 'function') {
                window.udaaOverlay.showStatus(msg, 'active');
            }
        }
    }
});

if (!window.__udaaConnectInitialized) {
    window.__udaaConnectInitialized = true;

    // Auto-connect flow: check if a session ID was passed via URL or injected by Playwright
    let connectAttempts = 0;
    const connectInterval = setInterval(() => {
        connectAttempts++;

        // 1. Check URL parameters (for native webbrowser launch)
        const urlParams = new URLSearchParams(window.location.search);
        let sessionId = urlParams.get('udaa_session_id');

        // 2. Check localStorage (for Playwright launch)
        if (!sessionId) {
            sessionId = window.localStorage.getItem('udaa_session_id');
        }

        if (sessionId) {
            console.log("UDAA Content Script: Found Session ID. Instructing background worker to connect...");
            chrome.runtime.sendMessage({ type: "CONNECT_WS", sessionId: sessionId });
            clearInterval(connectInterval);
        } else if (connectAttempts > 10) {
            // Stop trying after 5 seconds (10 * 500ms)
            clearInterval(connectInterval);
        }
    }, 500);
}

// Security Badge Injection
setTimeout(() => {
    const sensitiveDomains = ["accounts.google.com", ".bank", "paypal.com", "stripe.com", "login", "signin", "auth", "checkout", "pay."];
    const url = window.location.href.toLowerCase();

    if (sensitiveDomains.some(d => url.includes(d)) && !document.getElementById("udaa-security-badge")) {
        const badge = document.createElement("div");
        badge.id = "udaa-security-badge";
        badge.innerHTML = "🔒 <b>Secure Page</b> &nbsp;|&nbsp; UDAA respects your privacy here.";
        badge.style.position = "fixed";
        badge.style.top = "20px";
        badge.style.left = "50%";
        badge.style.transform = "translateX(-50%)";
        badge.style.backgroundColor = "rgba(46, 204, 113, 0.95)";
        badge.style.color = "white";
        badge.style.padding = "8px 20px";
        badge.style.borderRadius = "20px";
        badge.style.fontSize = "13px";
        badge.style.fontFamily = "sans-serif";
        badge.style.zIndex = "2147483647"; // Max z-index
        badge.style.boxShadow = "0 4px 12px rgba(0,0,0,0.2)";
        badge.style.pointerEvents = "none";
        document.body.appendChild(badge);
    }
}, 1000);
