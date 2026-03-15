// content_script.js
// Responsible for executing actions on the DOM and extracting data

window.udaaLastClickedElement = null;
window._udaaLastClickX = null;
window._udaaLastClickY = null;

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

// ══════════════════════════════════════════════════════════════════════════════
// UNIVERSAL DOM RESOLVER — 4-Layer Input Resolution System
// ══════════════════════════════════════════════════════════════════════════════

// ── Layer 1 Utility: _isTypeable ─────────────────────────────────────────────
// Returns true if the element can accept text input.
function _isTypeable(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') {
        const t = (el.getAttribute('type') || 'text').toLowerCase();
        return ['text', 'search', 'email', 'password', 'tel', 'url', 'number', 'date', 'time', 'datetime-local', 'month', 'week'].includes(t);
    }
    if (el.isContentEditable) return true;
    // Shadow DOM: check if el hosts a shadow with an input inside
    if (el.shadowRoot) {
        const inner = el.shadowRoot.querySelector('input, textarea, [contenteditable]');
        if (inner) return true;
    }
    return false;
}

// ── Layer 1 Utility: _isVisible ──────────────────────────────────────────────
// Checks if an element is actually visible to the user.
function _isVisible(el) {
    if (!el || !document.contains(el)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
    if (rect.right < 0 || rect.left > window.innerWidth) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (parseFloat(style.opacity) < 0.05) return false;
    return true;
}

// ── Layer 1 Utility: _hasElevatedAncestor ────────────────────────────────────
// Detects whether an element lives inside a modal, overlay, or floating layer.
function _hasElevatedAncestor(el) {
    let node = el.parentElement;
    while (node && node !== document.body) {
        const style = window.getComputedStyle(node);
        if (style.position === 'fixed' || style.position === 'sticky') return true;
        if (parseInt(style.zIndex, 10) > 100) return true;
        const role = node.getAttribute('role') || '';
        if (['dialog', 'alertdialog', 'tooltip', 'listbox', 'combobox'].includes(role)) return true;
        const ariaModal = node.getAttribute('aria-modal');
        if (ariaModal === 'true') return true;
        node = node.parentElement;
    }
    return false;
}

// ── Layer 3: _findBestInputCandidate ─────────────────────────────────────────
// Priority-ordered selector chain covering every known framework pattern.
const INPUT_QUERY_PRIORITY = [
    // ARIA roles (framework-agnostic, highest confidence)
    '[role="dialog"] input:not([type="hidden"]):not([disabled])',
    '[role="dialog"] textarea:not([disabled])',
    '[role="alertdialog"] input:not([type="hidden"]):not([disabled])',
    '[aria-modal="true"] input:not([type="hidden"]):not([disabled])',
    '[aria-modal="true"] textarea:not([disabled])',
    // Angular CDK overlay container
    '.cdk-overlay-container input:not([type="hidden"]):not([disabled])',
    '.cdk-overlay-pane input:not([type="hidden"]):not([disabled])',
    // Generic overlay/modal class patterns
    '[class*="modal"] input:not([type="hidden"]):not([disabled])',
    '[class*="Modal"] input:not([type="hidden"]):not([disabled])',
    '[class*="dialog"] input:not([type="hidden"]):not([disabled])',
    '[class*="Dialog"] input:not([type="hidden"]):not([disabled])',
    '[class*="overlay"] input:not([type="hidden"]):not([disabled])',
    '[class*="Overlay"] input:not([type="hidden"]):not([disabled])',
    '[class*="popup"] input:not([type="hidden"]):not([disabled])',
    '[class*="Popup"] input:not([type="hidden"]):not([disabled])',
    '[class*="drawer"] input:not([type="hidden"]):not([disabled])',
    '[class*="Drawer"] input:not([type="hidden"]):not([disabled])',
    // Search/autocomplete patterns (React/Vue typeahead components)
    '[class*="search"] input:not([type="hidden"]):not([disabled])',
    '[class*="Search"] input:not([type="hidden"]):not([disabled])',
    '[class*="autocomplete"] input:not([type="hidden"]):not([disabled])',
    '[class*="Autocomplete"] input:not([type="hidden"]):not([disabled])',
    '[class*="combobox"] input:not([type="hidden"]):not([disabled])',
    '[class*="typeahead"] input:not([type="hidden"]):not([disabled])',
    // Floating / portal patterns (React Portals, Vue Teleport)
    'body > div[id] input:not([type="hidden"]):not([disabled])',
    'body > div[class] input:not([type="hidden"]):not([disabled])',
    // Fallback: any visible typeable element on the page
    'input:not([type="hidden"]):not([disabled])',
    'textarea:not([disabled])',
    '[contenteditable="true"]',
];

function _findBestInputCandidate() {
    for (const selector of INPUT_QUERY_PRIORITY) {
        try {
            const candidates = [...document.querySelectorAll(selector)];
            const visible = candidates.filter(el => _isVisible(el) && _isTypeable(el));
            if (visible.length === 0) continue;
            // Among visible matches: prefer elevated (overlay) elements
            const elevated = visible.filter(_hasElevatedAncestor);
            if (elevated.length > 0) return elevated[0];
            return visible[0];
        } catch (e) {
            continue;
        }
    }
    // Shadow DOM fallback (uncomment only for Salesforce/Ionic/web-component sites):
    // const shadowInputs = _queryAllDeep('input:not([type="hidden"]):not([disabled])')
    //     .filter(el => _isVisible(el));
    // if (shadowInputs.length > 0) return shadowInputs[0];
    return null;
}

// ── Layer 2: _watchForNewInput (MutationObserver) ────────────────────────────
// Watches for DOM changes that produce a new typeable input.
let _activeObserver = null;

function _watchForNewInput(timeoutMs = 700) {
    return new Promise((resolve) => {
        if (_activeObserver) {
            _activeObserver.disconnect();
            _activeObserver = null;
        }

        // Check immediately — DOM may already have the new input
        const immediate = _findBestInputCandidate();
        if (immediate && immediate !== document.body && immediate !== document.documentElement) {
            resolve(immediate);
            return;
        }

        const deadline = Date.now() + timeoutMs;
        let resolved = false;

        const tryResolve = () => {
            if (resolved) return;
            const found = _findBestInputCandidate();
            if (found && found !== document.body) {
                resolved = true;
                _activeObserver.disconnect();
                _activeObserver = null;
                resolve(found);
                return true;
            }
            return false;
        };

        _activeObserver = new MutationObserver(() => {
            if (tryResolve()) return;
            if (Date.now() > deadline) {
                if (!resolved) {
                    resolved = true;
                    _activeObserver.disconnect();
                    _activeObserver = null;
                    resolve(null);
                }
            }
        });

        _activeObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class', 'hidden', 'aria-hidden', 'display'],
        });

        // Hard timeout fallback
        setTimeout(() => {
            if (!resolved) {
                resolved = true;
                if (_activeObserver) {
                    _activeObserver.disconnect();
                    _activeObserver = null;
                }
                resolve(null);
            }
        }, timeoutMs + 50);
    });
}

// ── Layer 0 + 1 + 2 + 3 Combined: _resolveTypeTarget ────────────────────────
// 4-layer priority resolution for finding the best input target.
async function _resolveTypeTarget(clickX, clickY, timeoutMs = 800) {
    // Layer 0: activeElement — if it's already typeable, use it immediately
    const active = document.activeElement;
    if (active && _isTypeable(active) && _isVisible(active)) {
        console.log('UDAA Resolver: Layer 0 — activeElement is typeable');
        return active;
    }

    // Layer 1: Last clicked element — if still in DOM and typeable
    if (window.udaaLastClickedElement
        && document.contains(window.udaaLastClickedElement)
        && _isTypeable(window.udaaLastClickedElement)
        && _isVisible(window.udaaLastClickedElement)) {
        console.log('UDAA Resolver: Layer 1 — using last clicked element');
        window.udaaLastClickedElement.focus();
        return window.udaaLastClickedElement;
    }

    // Layer 2: MutationObserver — wait for React/Vue/Angular to render new input
    console.log('UDAA Resolver: Layer 2 — waiting for MutationObserver...');
    const observed = await _watchForNewInput(timeoutMs);
    if (observed) {
        console.log('UDAA Resolver: Layer 2 — observer found input:', observed.tagName, observed.getAttribute('placeholder')?.slice(0, 30) || '');
        observed.focus();
        return observed;
    }

    // Layer 3: Brute-force scan — query DOM with priority selectors
    console.log('UDAA Resolver: Layer 3 — brute-force DOM scan...');
    const candidate = _findBestInputCandidate();
    if (candidate) {
        console.log('UDAA Resolver: Layer 3 — found candidate:', candidate.tagName, candidate.getAttribute('placeholder')?.slice(0, 30) || '');
        candidate.focus();
        return candidate;
    }

    // Layer 4 (last resort): elementFromPoint at the last click location
    if (clickX != null && clickY != null) {
        const el = document.elementFromPoint(clickX, clickY);
        if (el && _isTypeable(el)) {
            console.log('UDAA Resolver: Layer 4 — elementFromPoint fallback');
            el.focus();
            return el;
        }
    }

    console.warn('UDAA Resolver: All 4 layers failed — no typeable element found');
    return null;
}

// ── Shadow DOM piercing utility (disabled by default — expensive) ────────────
// Uncomment only when targeting Salesforce Lightning, Ionic, or Lit-based sites.
// function _queryAllDeep(selector, root = document) {
//     const results = [];
//     const walker = (node) => {
//         try { results.push(...node.querySelectorAll(selector)); } catch(e) {}
//         node.querySelectorAll('*').forEach(el => {
//             if (el.shadowRoot) walker(el.shadowRoot);
//         });
//     };
//     walker(root);
//     return results;
// }

// ══════════════════════════════════════════════════════════════════════════════
// ACTION DISPATCHER
// ══════════════════════════════════════════════════════════════════════════════

async function executeAction(action, args) {
    if (action === "click_at" || action === "click" || action === "left_click") {
        const { x, y } = _scaleCoords(args);
        return window.udaa.performClick(x, y);

    } else if (action === "type_text_at" || action === "type") {
        if (args.x !== undefined || args.coordinates) {
            const { x, y } = _scaleCoords(args);
            window.udaa.performClick(x, y);
            // Give the pre-arm observer a 100ms head start
            // before performType calls _resolveTypeTarget
            await new Promise(r => setTimeout(r, 100));
        }
        return await window.udaa.performType(args.text);  // MUST be awaited

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
        // Save click coordinates for the DOM Resolver
        window._udaaLastClickX = x;
        window._udaaLastClickY = y;

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

            // Pre-arm MutationObserver: watch for new inputs that React/Vue may spawn
            _watchForNewInput(800).then(found => {
                if (found) console.log('UDAA: Pre-click observer caught input:', found.tagName);
            });

            console.log(`UDAA: Clicked at ${x}, ${y}`);
            return true;
        }
        return false;
    },

    performType: async (text) => {
        // ── Universal DOM Resolver: find the best input target ────────
        const element = await _resolveTypeTarget(
            window._udaaLastClickX,
            window._udaaLastClickY,
            800
        );

        if (!element) {
            console.warn('UDAA: performType — all resolver layers failed, no typeable element found.');
            return false;
        }

        // Brief settle for the element to be ready
        await new Promise(r => setTimeout(r, 40));

        console.log('UDAA: Typing into', element.tagName,
            element.getAttribute('placeholder')?.slice(0, 30) || '',
            element.className?.slice(0, 40) || '');

        // ── Existing type logic (unchanged) ──────────────────────────
        // Dedup repeated strings
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
