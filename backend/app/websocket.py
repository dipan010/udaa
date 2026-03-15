"""WebSocket connection manager and message routing."""

import json
import logging
from typing import Any
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manages WebSocket connections per session."""

    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}
        self.extension_connections: dict[str, WebSocket] = {}

    async def connect(self, session_id: str, websocket: WebSocket):
        """Accept and register a WebSocket connection."""
        await websocket.accept()
        self.active_connections[session_id] = websocket
        logger.info(f"WebSocket connected: session={session_id}")

    def disconnect(self, session_id: str):
        """Remove a WebSocket connection."""
        if session_id in self.active_connections:
            del self.active_connections[session_id]
            logger.info(f"WebSocket disconnected: session={session_id}")

    def get_connection(self, session_id: str) -> WebSocket | None:
        """Get the WebSocket for a session."""
        return self.active_connections.get(session_id)

    async def connect_extension(self, session_id: str, websocket: WebSocket):
        """Accept and register a WebSocket connection from the Chrome Extension."""
        await websocket.accept()
        self.extension_connections[session_id] = websocket
        logger.info(f"Extension WebSocket connected: session={session_id}")

    def disconnect_extension(self, session_id: str):
        """Remove an Extension WebSocket connection."""
        if session_id in self.extension_connections:
            del self.extension_connections[session_id]
            logger.info(f"Extension WebSocket disconnected: session={session_id}")

    async def send_to_extension(self, session_id: str, message: dict[str, Any]):
        """Send a JSON command to the Chrome Extension."""
        ws = self.extension_connections.get(session_id)
        if ws:
            try:
                await ws.send_json(message)
            except Exception as e:
                logger.error(f"Failed to send to extension {session_id}: {e}")
                self.disconnect_extension(session_id)

    async def broadcast_to_extension(self, session_id: str, message: dict):
        """Broadcast a message as JSON text to the Chrome Extension."""
        ws = self.extension_connections.get(session_id)
        if ws:
            try:
                await ws.send_text(json.dumps(message))
            except Exception as e:
                logger.error(f"Failed to broadcast to extension {session_id}: {e}")
                self.disconnect_extension(session_id)

    async def send_message(self, session_id: str, message: dict[str, Any]):
        """Send a JSON message to a specific session."""
        ws = self.active_connections.get(session_id)
        if ws:
            try:
                await ws.send_json(message)
            except Exception as e:
                logger.error(f"Failed to send to session {session_id}: {e}")
                self.disconnect(session_id)

    async def send_screenshot(self, session_id: str, screenshot_b64: str, step: int):
        """Send a screenshot update to the frontend."""
        await self.send_message(session_id, {
            "type": "screenshot_update",
            "data": {
                "screenshot": screenshot_b64,
                "step": step,
            }
        })

    async def send_action(self, session_id: str, action: dict, step: int):
        """Send an action execution update."""
        await self.send_message(session_id, {
            "type": "action_executed",
            "data": {
                "action": action,
                "step": step,
            }
        })

    async def send_narration(self, session_id: str, text: str):
        """Send live narration text from the Live API."""
        await self.send_message(session_id, {
            "type": "narration",
            "data": {"text": text}
        })

    async def send_audio_narration(self, session_id: str, audio_b64: str):
        """Send live audio narration chunk (base64) from the Live API."""
        await self.send_message(session_id, {
            "type": "audio_narration",
            "data": {"audio": audio_b64,
                     "encoding": "pcm",
                     "sample_rate": 24000,
                     }
        })

    async def send_action_preview(self, session_id: str, preview_text: str):
        """Send a plain English preview of the next action before it executes."""
        await self.send_message(session_id, {
            "type": "action_preview",
            "data": {"text": preview_text}
        })
        await self.send_to_extension(session_id, {
            "type": "action_preview",
            "text": preview_text
        })

    async def send_status(self, session_id: str, status: str, detail: str = "", grandparents_mode: bool = False):
        """Send agent status update."""
        # Send to main frontend UI
        await self.send_message(session_id, {
            "type": "status_update",
            "data": {"status": status, "detail": detail}
        })
        # Extension — FIXED: was "type": "status", now "type": "UDAA_STATUS"
        # content_script.js listens for "UDAA_STATUS" — "status" was silently ignored
        await self.broadcast_to_extension(session_id, {
            "type": "UDAA_STATUS",
            "payload": {
                "status": status,
                "message": detail,
                "grandparents_mode": grandparents_mode
            }
        })

    async def send_safety_confirm(self, session_id: str, action: dict, request_id: str):
        """Request user confirmation for a safety-flagged action."""
        await self.send_message(session_id, {
            "type": "safety_confirm",
            "data": {
                "action": action,
                "request_id": request_id,
            }
        })

    async def send_task_complete(self, session_id: str, summary: str):
        """Notify the frontend that the task is complete."""
        # 1. Dashboard
        await self.send_message(session_id, {
            "type": "task_complete",
            "data": {"summary": summary}
        })
        # 2. Extension overlay — use UDAA_STATUS which content_script.js listens for
        await self.broadcast_to_extension(session_id, {
            "type": "UDAA_STATUS",
            "payload": {
                "status": "completed",
                "message": f"All done! {summary}" if summary else "Task complete.",
                "grandparents_mode": False
            }
        })

    async def send_error(self, session_id: str, error: str):
        """Send an error message."""
        await self.send_message(session_id, {
            "type": "error",
            "data": {"message": error}
        })


    async def send_pause_prompt(self, session_id: str, data: dict):
        """Send a prompt that pauses the loop and waits for user input."""
        await self.send_message(session_id, {
            "type": "pause_prompt",
            "data": data,
        })
        # Extension — FIXED: was "type": "status", now "type": "UDAA_STATUS"
        await self.broadcast_to_extension(session_id, {
            "type": "UDAA_STATUS",
            "payload": {
                "status": "active",
                "message": "Waiting for your input...",
                "grandparents_mode": False
            }
        })

# Singleton connection manager
manager = ConnectionManager()
