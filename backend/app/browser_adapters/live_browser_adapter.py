"""Live Browser Adapter for communicating with the Chrome Extension."""

import asyncio
import base64
import logging
from typing import Any

from app.browser_adapters.base_adapter import BrowserAdapter

logger = logging.getLogger(__name__)

class LiveBrowserAdapter(BrowserAdapter):
    """Adapter that delegates browser actions to a connected Chrome Extension via WebSocket."""

    def __init__(self, session_id: str):
        self.session_id = session_id
        self._latest_screenshot_bytes: bytes | None = None
        self._action_result_future: asyncio.Future | None = None
        self._page = None 
        self._context = None
        self._playwright = None

    @property
    def page(self):
        return self._page

    async def get_current_url(self) -> str:
        res = await self.execute_action("get_current_url", {})
        return res.get("url", "")


    async def launch(self, start_url: str = ""):
        """Launch a new tab in the user's existing default OS browser."""
        import urllib.parse
        import webbrowser
        
        # Determine the base URL
        if not start_url:
            base_url = "https://www.google.com"
        else:
            base_url = start_url
            
        # Parse existing URL to safely append our session query parameter
        parsed_url = urllib.parse.urlparse(base_url)
        query_params = urllib.parse.parse_qs(parsed_url.query)
        query_params['udaa_session_id'] = [self.session_id]
        
        new_query = urllib.parse.urlencode(query_params, doseq=True)
        final_url = parsed_url._replace(query=new_query).geturl()
        
        logger.info(f"Opening native browser tab: {final_url}")
        
        # Opens in a new tab in the user's default active browser
        # Note: Must be run on the main thread, or since it's an async function, 
        # using asyncio.to_thread if it blocks, but webbrowser.open is usually non-blocking.
        await asyncio.to_thread(webbrowser.open, final_url, new=2)
            
        logger.info(f"Triggered Live Chrome Native Tab for session {self.session_id}")

    async def capture_screenshot(self) -> bytes:
        """Wait for and return the latest screenshot from the extension stream."""
        # Wait up to 30 seconds for the extension to inject and stream
        for _ in range(300):
            if self._latest_screenshot_bytes:
                return self._latest_screenshot_bytes
            await asyncio.sleep(0.1)
        
        logger.warning(f"Timeout waiting for screenshot from extension for {self.session_id}")
        return getattr(self, "_latest_screenshot_bytes", b"") or b""

    def update_screenshot(self, b64_frame: str):
        """Called by the websocket handler when a new frame arrives."""
        try:
            self._latest_screenshot_bytes = base64.b64decode(b64_frame)
        except Exception as e:
            logger.error(f"Failed to decode extension frame: {e}")

    def complete_action(self, result: dict):
        """Called by the websocket handler when an action result arrives."""
        if self._action_result_future and not self._action_result_future.done():
            self._action_result_future.set_result(result)

    async def execute_action(self, action_name: str, args: dict[str, Any]) -> dict:
        """Send an action to the extension and wait for the result."""
        from app.websocket import manager as ws_manager
        
        # Extension is stateless, we just send standard actions
        ext_msg = {
            "type": "execute_action",
            "action": action_name,
            **args
        }
        
        self._action_result_future = asyncio.Future()
        
        # We need a way to send to the Extension WS.
        # Assuming the new endpoint registers the extension ws or we broadcast.
        await ws_manager.send_to_extension(self.session_id, ext_msg)
        
        try:
            # Wait for extension to reply with 'action_result'
            ext_result = await asyncio.wait_for(self._action_result_future, timeout=10.0)
            return ext_result
        except asyncio.TimeoutError:
            logger.warning(f"Extension action timeout for {action_name}")
            return {"action": action_name, "success": False, "detail": "Extension timeout"}
        except Exception as e:
            logger.error(f"Extension action error: {e}")
            return {"action": action_name, "success": False, "detail": str(e)}

    async def close(self):
        """Cleanup resources."""
        # Stop the stream visually on the extension
        from app.websocket import manager as ws_manager
        try:
            await ws_manager.send_to_extension(self.session_id, {"type": "stop_stream"})
        except Exception:
            pass
            
        self._latest_screenshot_bytes = None
        logger.info(f"LiveBrowserAdapter closed for {self.session_id}")
