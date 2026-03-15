"""FastAPI application — main entrypoint."""

import sys
if sys.platform == "win32":
    import asyncio
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

import asyncio
import json
import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google import genai
from google.genai import types

from app.config import get_settings
from app.websocket import manager as ws_manager
from app.browser_adapters.base_adapter import BrowserAdapter
from app.computer_use import run_agent_loop
from app.live_stream import run_live_stream
from app.firestore_client import create_session, get_session, list_sessions

logger = logging.getLogger(__name__)
settings = get_settings()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

# Standard Python logging (Cloud Logging removed to avoid billing)
logger.info("Using standard Python logging")


# Track active sessions
active_sessions: dict[str, dict] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan — startup and shutdown."""
    logger.info("🚀 UDAA Backend starting up...")
    yield
    # Cleanup active sessions on shutdown
    for sid, session in active_sessions.items():
        browser: BrowserAdapter = session.get("browser")
        if browser:
            await browser.close()
    logger.info("UDAA Backend shut down")


app = FastAPI(
    title="Universal Digital Accessibility Agent",
    description="AI agent that autonomously navigates digital interfaces",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- REST Endpoints ---

class TaskRequest(BaseModel):
    task: str
    start_url: str = ""


class TaskResponse(BaseModel):
    session_id: str
    task: str
    start_url: str
    status: str


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "udaa-backend",
        "version": "1.0.0",
        "active_sessions": len(active_sessions),
    }


@app.post("/tasks", response_model=TaskResponse)
async def create_task(request: TaskRequest):
    """Create a new task (REST alternative to WebSocket)."""
    session_id = str(uuid.uuid4())[:8]
    await create_session(session_id, request.task, request.start_url)
    return TaskResponse(
        session_id=session_id,
        task=request.task,
        start_url=request.start_url,
        status="created",
    )


@app.post("/voice-task")
async def transcribe_voice_task(audio: UploadFile = File(...)):
    """Transcribe voice audio to text using Gemini."""
    try:
        audio_bytes = await audio.read()
        client = genai.Client(api_key=settings.GOOGLE_API_KEY)
        response = await asyncio.to_thread(
            client.models.generate_content,
            model="gemini-2.5-flash",
            contents=[
                types.Content(
                    role="user",
                    parts=[
                        types.Part.from_bytes(data=audio_bytes, mime_type=audio.content_type or "audio/webm"),
                        types.Part.from_text("Transcribe the user's voice command accurately. Return ONLY the transcribed text. Do not include markdown or quotes.")
                    ]
                )
            ]
        )
        return {"text": response.text.strip()}
    except Exception as e:
        logger.error(f"Voice transcription error: {e}")
        raise HTTPException(status_code=500, detail=str(e))



@app.get("/tasks/{session_id}")
async def get_task(session_id: str):
    """Get task status."""
    session = await get_session(session_id)
    if session:
        return session
    # Check in-memory
    if session_id in active_sessions:
        return {
            "session_id": session_id,
            "status": "active",
        }
    raise HTTPException(status_code=404, detail="Session not found")


@app.get("/sessions")
async def get_sessions():
    """List recent sessions."""
    sessions = await list_sessions()
    return {"sessions": sessions}


# --- WebSocket Endpoint ---

@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    """Main WebSocket endpoint for real-time agent communication."""
    await ws_manager.connect(session_id, websocket)

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            msg_type = message.get("type", "")

            if msg_type == "task_start":
                task = message["data"]["task"]
                start_url = message["data"].get("start_url", "")
                execution_mode = message["data"].get("execution_mode", "remote")

                patience_mode = message["data"].get("patience_mode", False)
                grandparents_mode = message["data"].get("grandparents_mode", False)
                narration_enabled = message["data"].get("narration_enabled", True)

                logger.info(
                    f"Task start: session={session_id}, mode={execution_mode}, task='{task}', url='{start_url}', patience={patience_mode}, gp_mode={grandparents_mode}, narration={narration_enabled}"
                )

                # Create session in Firestore
                await create_session(session_id, task, start_url)

                # Initialize live browser adapter
                try:
                    from app.browser_adapters.live_browser_adapter import LiveBrowserAdapter
                    browser = LiveBrowserAdapter(session_id)
                    await browser.launch(start_url=start_url)
                except Exception as launch_err:
                    logger.error(f"Browser launch failed: {launch_err}")
                    await ws_manager.send_error(
                        session_id,
                        f"Failed to launch browser: {str(launch_err)}"
                    )
                    continue

                # Track session
                active_sessions[session_id] = {
                    "browser": browser,
                    "task": task,
                    "agent_task": None,
                    "live_task": None,
                }

                await ws_manager.send_status(
                    session_id, "started", "Agent is initializing..."
                )

                # Start agent loop & live stream in parallel
                last_action_time_ref = [0.0]
                completion_text_ref = [None]
                live_session_ref = [None]  # holds the live session so agent loop can push into it

                agent_task = asyncio.create_task(
                    run_agent_loop(session_id, task, start_url, browser, patience_mode, grandparents_mode, last_action_time_ref, completion_text_ref, live_session_ref)
                )
                
                # Only start narration stream if enabled
                live_task = None
                if narration_enabled:
                    live_task = asyncio.create_task(
                        run_live_stream(session_id, task, browser, grandparents_mode, last_action_time_ref, completion_text_ref, live_session_ref)
                    )

                active_sessions[session_id]["agent_task"] = agent_task
                active_sessions[session_id]["live_task"] = live_task
                active_sessions[session_id]["completion_text_ref"] = completion_text_ref
                active_sessions[session_id]["live_session_ref"] = live_session_ref

                # Monitor agent completion
                async def on_agent_done(t):
                    try:
                        await t
                    except asyncio.CancelledError:
                        logger.info(f"Agent loop cancelled: session={session_id}")
                    except Exception as e:
                        logger.error(f"Agent loop error: {e}")
                        try:
                            await ws_manager.send_error(session_id, str(e))
                        except Exception:
                            pass  # WebSocket may already be closed
                    finally:
                        # Cancel live stream when agent is done
                        session = active_sessions.pop(session_id, None)
                        if session:
                            lt = session.get("live_task")
                            if lt and not lt.done():
                                lt.cancel()
                            b = session.get("browser")
                            if b:
                                try:
                                    await b.close()
                                except Exception:
                                    pass

                asyncio.create_task(on_agent_done(agent_task))

            elif msg_type == "safety_response":
                # User approved or rejected a safety confirmation
                approved = message["data"].get("approved", False)
                user_input = message["data"].get("user_input", None)
                logger.info(
                    f"Safety response: approved={approved}, input={'provided' if user_input else 'none'}"
                )
                from app.pause_gate import get_or_create as get_gate
                gate = get_gate(session_id)
                gate.approved = approved
                gate.user_input = user_input
                gate.event.set()

            elif msg_type == "cancel_task":
                logger.info(f"Task cancelled: session={session_id}")
                if session_id in active_sessions:
                    session = active_sessions[session_id]
                    for key in ["agent_task", "live_task"]:
                        t = session.get(key)
                        if t and not t.done():
                            t.cancel()
                    browser = session.get("browser")
                    if browser:
                        await browser.close()
                    del active_sessions[session_id]
                await ws_manager.send_status(session_id, "cancelled", "Task cancelled")

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: session={session_id}")
        ws_manager.disconnect(session_id)
        # Clean up session
        if session_id in active_sessions:
            session = active_sessions[session_id]
            for key in ["agent_task", "live_task"]:
                t = session.get(key)
                if t and not t.done():
                    t.cancel()
            browser = session.get("browser")
            if browser:
                await browser.close()
            del active_sessions[session_id]
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        ws_manager.disconnect(session_id)

@app.websocket("/ws/live_ext/{session_id}")
async def extension_websocket_endpoint(websocket: WebSocket, session_id: str):
    """WebSocket endpoint for the Chrome Extension to stream frames and receive commands."""
    await ws_manager.connect_extension(session_id, websocket)

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            msg_type = message.get("type", "")

            if msg_type == "screen_frame":
                # Forward to dashboard immediately for smooth live viewer response
                b64_image = message.get("image", "")
                await ws_manager.send_screenshot(session_id, b64_image, 0)
                
                # If adapter is actively listening, update it
                session = active_sessions.get(session_id)
                if session and "browser" in session:
                    adapter = session["browser"]
                    if hasattr(adapter, "update_screenshot"):
                        adapter.update_screenshot(b64_image)

            elif msg_type == "action_result":
                session = active_sessions.get(session_id)
                if session and "browser" in session:
                    adapter = session["browser"]
                    if hasattr(adapter, "complete_action"):
                        adapter.complete_action(message.get("result", {}))

    except WebSocketDisconnect:
        logger.info(f"Extension WebSocket disconnected: session={session_id}")
        ws_manager.disconnect_extension(session_id)
    except Exception as e:
        logger.error(f"Extension WebSocket error: {e}")
        ws_manager.disconnect_extension(session_id)

if __name__ == "__main__":
    import uvicorn
    import sys
    import asyncio
    
    if sys.platform == "win32":
        # Force proactor event loop for Playwright before Uvicorn does anything
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
        # DO NOT use reload=True on Windows with Playwright, it breaks the subprocess transport
        uvicorn.run("app.main:app", host="127.0.0.1", port=8080)
    else:
        uvicorn.run("app.main:app", host="127.0.0.1", port=8080, reload=True)
