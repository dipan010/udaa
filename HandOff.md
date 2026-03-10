UDAA Project Handoff Context
Project Name: Universal Digital Accessibility Agent (UDAA) Current Status: Phase 10 Complete (Automated Live Browser Launching) Last Updated: 2026-03-10

🚀 Mission Statement
UDAA is a multimodal AI agent designed to assist users with accessibility needs by autonomously navigating digital interfaces. It observes the screen via real-time screenshots, processes the UI context using Gemini, and executes native browser actions (click, type, scroll).

🛠 Technical Architecture
The system uses a Hybrid Minimal-GCP Architecture to minimize billing while maintaining scalability.

Backend: FastAPI (Python 3.11).
Frontend: Next.js 15+ (TypeScript, Tailwind CSS).
Browser Control: Playwright (for Remote mode) and a Custom Chrome Extension (for Live mode).
AI Core:
Action Engine: gemini-2.5-computer-use-preview-10-2025 (via google-genai SDK).
Narration Engine: gemini-2.0-flash-exp (via Gemini Live API / Bidi streaming).
State Management: Firestore (used for cross-instance session synchronization).
Storage: Local filesystem (backend/screenshots/) and local logs (backend/actions.log).
💡 Key Features & Recent Fixes (CRITICAL)
1. Hands-Free Live Browser (Phase 10)
Mechanism: The backend LiveBrowserAdapter spawns a persistent Chrome context with the UDAA extension pre-loaded.
Auto-Handshake: Playwright injects udaa_session_id into the browser's localStorage. The extension's content_script.js detects this and triggers an automatic WebSocket connection.
Restriction Note: Extensions cannot run on about:blank. Thus, the adapter defaults to https://www.google.com to ensure the handshake triggers.
2. WebSocket Stability
Memory Leak Fix: The useWebSocket.ts hook was patched to prevent reconnect loops by cleaning up event listeners (onclose, onerror) during unmount and using an intentionalClose ref.
Port: Backend runs on :8080, Frontend on :3000.
⚙️ Environment Configuration
Next agents must ensure these are set in backend/.env:

GOOGLE_API_KEY: Required for Gemini models.
GOOGLE_CLOUD_PROJECT: udaa-489513 (for Firestore).
COMPUTER_USE_MODEL: gemini-2.5-computer-use-preview-10-2025.
LIVE_MODEL: gemini-2.0-flash-exp (Do NOT use gemini-2.5-flash for Live API as it lacks Bidi support in current v1beta).
📂 Directory Structure
/backend: FastAPI source, venv, requirements.
/frontend: Next.js source, components, hooks.
/extension: Manifest V3 source (background, content_script, overlay).
/appDataDir/brain/<id>: Contains task.md, walkthrough.md, and implementation_plan.md.
📝 Roadmap / Next Steps
Safety Refinement: Implement the backend logic for safety_response (currently a TODO in main.py).
Context Window Management: The run_agent_loop currently appends screenshots to the conversation; implement a pruning strategy for very long tasks.
Accessibility Overlay: Enhance the overlay.js in the extension to high-contrast highlight elements the AI is "looking at" based on vision tokens (if supported).
🤝 Collaboration Protocol
When taking over:

Run git pull origin main.
Start backend: cd backend && source venv/bin/activate && uvicorn app.main:app --port 8080 --reload.
Start frontend: cd frontend && npm run dev.
Check task.md for the current checklist status.