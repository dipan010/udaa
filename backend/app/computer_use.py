"""Gemini Computer Use agent loop — the core of the project."""

import asyncio
import base64
import logging
import uuid
from typing import Any

from google import genai
from google.genai import types

from app.config import get_settings
from app.browser_adapters.base_adapter import BrowserAdapter
from app.websocket import manager as ws_manager
from app.storage import upload_screenshot
from app.firestore_client import update_session_state
from app.pubsub import publish_action

logger = logging.getLogger(__name__)
settings = get_settings()

async def _signal_extension_complete(session_id: str, manager):
    """Send completed status directly to the extension overlay."""
    await manager.broadcast_to_extension(session_id, {
        "type": "UDAA_STATUS",
        "payload": { "status": "completed", "message": "Task done." }
    })

from app.pause_gate import get_or_create as get_gate

SENSITIVE_DOMAINS = [
    "accounts.google.com", "login.", "signin.", "auth.",
    "paypal.com", "pay.", "checkout.", "payment.",
    "facebook.com/login", "twitter.com/login", "netflix.com/login",
]

def _is_login_wall(url: str) -> bool:
    if not url: return False
    return any(d in url for d in SENSITIVE_DOMAINS)

def _action_to_plain_english(action_name: str, args: dict) -> str:
    if action_name in ["click_at", "click", "left_click"]:
        return "Click a button or link"
    elif action_name in ["type_text_at", "type"]:
        text = args.get("text", "...")
        if len(text) > 15:
            return "Type a message"
        return f"Type '{text}'"
    elif action_name == "navigate":
        return f"Open website: {args.get('url', '...')}"
    elif action_name in ["scroll", "scroll_document", "scroll_at"]:
        dir = args.get("direction", "down")
        return f"Scroll {dir} the page"
    elif action_name == "key_combination":
        keys = args.get("keys", [])
        return f"Press shortcut: {'+'.join(keys) if isinstance(keys, list) else keys}"
    elif action_name == "hover_at":
        return "Point at an element"
    return "Prepare to take action"

async def _pause_and_wait(
    session_id: str,
    reason: str,
    prompt_text: str,
    ws_manager,
    needs_input: bool = False,
) -> tuple[bool, str | None]:
    """Pause the agent, surface a prompt to the user, await their response."""
    gate = get_gate(session_id)
    gate.event.clear()
    gate.reason = reason

    # Tell frontend to show the pause prompt
    await ws_manager.send_pause_prompt(session_id, {
        "reason": reason,
        "prompt": prompt_text,
        "needs_input": needs_input,
    })

    # Block here — no timeout, agent waits as long as the human needs
    await gate.event.wait()
    return gate.approved, gate.user_input


async def run_agent_loop(
    session_id: str,
    task: str,
    start_url: str,
    browser: BrowserAdapter,
    patience_mode: bool = False,
    grandparents_mode: bool = False,
):
    """Execute the Computer Use agent loop.

    1. Capture screenshot
    2. Send screenshot + task → Gemini Computer Use model
    3. Parse function_call actions
    4. Handle safety_decision (require_confirmation → ask user)
    5. Execute actions via Playwright or Live Extension
    6. Capture new screenshot
    7. Repeat until task complete or max turns reached
    """
    client = genai.Client(api_key=settings.GOOGLE_API_KEY)
    
    post_action_sleep = 2.0 if patience_mode else 0.5
    post_nav_sleep = 4.0 if patience_mode else 1.0

    # Configure Computer Use tool
    config = types.GenerateContentConfig(
        tools=[
            types.Tool(
                computer_use=types.ComputerUse(
                    environment=types.Environment.ENVIRONMENT_BROWSER
                )
            )
        ],
        system_instruction=(
            "You are a browser automation agent completing tasks step by step. "
            "Issue ONE action per response. Check action history before acting.\n\n"
            "COMPLETION RULES — output 'TASK COMPLETE: <summary>' when:\n"
            "- Search task: results page is visible with the searched term\n"
            "- Navigation task: the target URL/page has fully loaded\n"
            "- Form task: confirmation or success message is visible\n"
            "- Play/open task: the media or content is actively playing\n\n"
            "ACTION RULES:\n"
            "1. One action per response — never queue multiple actions.\n"
            "2. Action history is shown before each screenshot. Do NOT repeat any action already listed there.\n"
            "3. After pressing Enter or clicking Search, the next action must be TASK COMPLETE if results load.\n"
            "4. Use 'navigate' to go to a URL directly — never type URLs into search bars.\n"
            "5. For sensitive actions (passwords, payments) use 'require_confirmation'."
        ),
    )

    # Navigate to start URL
    if start_url:
        await ws_manager.send_status(session_id, "navigating", f"Opening {start_url}", grandparents_mode)
        page = browser.page
        if page:
            await page.goto(start_url, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(post_nav_sleep)

    # Build initial content with task
    contents: list[types.Content] = [
        types.Content(
            role="user",
            parts=[types.Part(text=f"Task: {task}")],
        )
    ]

    nudge_count = 0
    last_action_signature: str | None = None

    for turn in range(settings.MAX_AGENT_TURNS):
        logger.info(f"Agent turn {turn + 1}/{settings.MAX_AGENT_TURNS}")
        await ws_manager.send_status(
            session_id, "thinking", f"Step {turn + 1}: Analyzing screen...", grandparents_mode
        )

        # Capture screenshot
        screenshot_bytes = await browser.capture_screenshot()
        
        # If no screenshot is available yet (e.g. extension connecting), wait and retry
        if not screenshot_bytes:
            logger.warning("No screenshot available yet, waiting 1s...")
            await asyncio.sleep(1)
            continue
            
        screenshot_b64 = base64.b64encode(screenshot_bytes).decode("utf-8")

        # Send screenshot to frontend
        await ws_manager.send_screenshot(session_id, screenshot_b64, turn + 1)

        # Upload to Cloud Storage (async, non-blocking)
        asyncio.create_task(
            upload_screenshot(session_id, turn + 1, screenshot_bytes)
        )

        # Add screenshot to conversation
        contents.append(
            types.Content(
                role="user",
                parts=[
                    types.Part(
                        inline_data=types.Blob(
                            mime_type="image/png",
                            data=screenshot_bytes,
                        )
                    )
                ],
            )
        )

        # Call Gemini Computer Use model
        try:
            response = await asyncio.to_thread(
                client.models.generate_content,
                model=settings.COMPUTER_USE_MODEL,
                contents=contents,
                config=config,
            )
        except Exception as e:
            logger.error(f"Gemini API error: {e}")
            await ws_manager.send_error(session_id, f"AI model error: {str(e)}")
            break

        if not response or not response.candidates:
            logger.warning("Empty response from model")
            await ws_manager.send_error(session_id, "No response from AI model")
            break

        candidate = response.candidates[0]
        content = candidate.content

        # Add model response to conversation history
        contents.append(content)

        # Check for text response (task complete or reasoning)
        text_parts = [p.text for p in content.parts if p.text]
        if text_parts:
            combined_text = " ".join(text_parts)
            logger.info(f"Model text: {combined_text[:200]}")

            if "TASK COMPLETE:" in combined_text.upper():
                summary = combined_text.split("TASK COMPLETE:")[-1].strip() if "TASK COMPLETE:" in combined_text else combined_text
                await ws_manager.send_task_complete(session_id, summary)
                await update_session_state(session_id, "completed", summary)
                await _signal_extension_complete(session_id, ws_manager)
                logger.info(f"Task completed: {summary[:100]}")
                return

            # Send reasoning/narration to frontend
            await ws_manager.send_narration(session_id, combined_text)

        # Check for function calls (actions)
        function_calls = [p.function_call for p in content.parts if p.function_call]

        if not function_calls:
            if text_parts:
                combined_lower = " ".join(text_parts).lower()
                completion_words = ["complete", "finished", "done", "successfully", "found", "loaded"]
                if any(w in combined_lower for w in completion_words):
                    await ws_manager.send_task_complete(session_id, " ".join(text_parts))
                    await update_session_state(session_id, "completed", " ".join(text_parts))
                    await _signal_extension_complete(session_id, ws_manager)
                    return
            
            nudge_count += 1
            if nudge_count >= 2:
                await ws_manager.send_task_complete(session_id, "Task appears complete.")
                await update_session_state(session_id, "completed", "No-action stop")
                await _signal_extension_complete(session_id, ws_manager)
                return
            
            contents.append(
                types.Content(
                    role="user",
                    parts=[types.Part(text="Next single action? If done, say 'TASK COMPLETE: <summary>'.")],
                )
            )
            continue

        nudge_count = 0

        current_sig = str([
            (fc.name, dict(fc.args) if fc.args else {})
            for fc in function_calls
        ])
         
        if current_sig == last_action_signature:
            logger.warning(f"Identical actions on turn {turn+1} — stopping")
            await ws_manager.send_task_complete(
                session_id, "Task complete — repeated action guard triggered."
            )
            await update_session_state(session_id, "completed", "Dedup stop")
            await _signal_extension_complete(session_id, ws_manager)
            return
         
        last_action_signature = current_sig

        # Execute each action
        for fc in function_calls:
            action_name = fc.name
            action_args = dict(fc.args) if fc.args else {}

            if action_name == 'require_confirmation':
                prompt = action_args.get('message', 'The agent wants to perform a sensitive action.')
                approved, _ = await _pause_and_wait(
                    session_id,
                    reason='confirmation',
                    prompt_text=prompt,
                    ws_manager=ws_manager,
                    needs_input=False,
                )
                if not approved:
                    await ws_manager.send_status(session_id, 'cancelled', 'User declined.', grandparents_mode)
                    return
                continue  # re-enter loop, Gemini will proceed
            
            # Auto-detect login walls from current URL
            current_url = await browser.get_current_url()
            if _is_login_wall(current_url):
                approved, typed_text = await _pause_and_wait(
                    session_id,
                    reason='login_wall',
                    prompt_text='The page is asking you to log in. Please sign in, then click Continue.',
                    ws_manager=ws_manager,
                    needs_input=False,
                )
                if not approved:
                    await ws_manager.send_status(session_id, 'cancelled', 'User cancelled at login wall.', grandparents_mode)
                    return
                # After user signals ready, take a fresh screenshot and continue
                await asyncio.sleep(1)
                continue

            plain_action = _action_to_plain_english(action_name, action_args)
            logger.info(f"Action: {action_name}({action_args}) -> {plain_action}")
            
            # Use Plain English if Grandparents Mode is on
            status_msg = plain_action if grandparents_mode else f"Executing: {action_name}"

            # 1. PREVIEW: show what we are ABOUT to do (Section 6.2)
            await ws_manager.send_action_preview(session_id, plain_action)
            await asyncio.sleep(0.8) # 800ms preview delay

            # 2. STATUS: show we are doing it now
            await ws_manager.send_status(
                session_id, "executing", status_msg, grandparents_mode
            )

            # Publish to Pub/Sub (for audit trail)
            await publish_action(session_id, turn + 1, action_name, action_args)

            # Execute the action
            result = await browser.execute_action(action_name, action_args)

            # Send action result to frontend
            await ws_manager.send_action(session_id, result, turn + 1)

            # Update Firestore
            await update_session_state(
                session_id, "executing",
                f"Step {turn + 1}: {action_name}"
            )

            # Small delay between actions
            await asyncio.sleep(post_action_sleep)

        # Add action results as user message for next turn
        action_summary_lines = []
        for fc in function_calls:
            args = dict(fc.args) if fc.args else {}
            args_str = ", ".join(f"{k}={v}" for k, v in args.items())
            action_summary_lines.append(f"  - {fc.name}({args_str})")
         
        contents.append(types.Content(
            role="user",
            parts=[types.Part(text=(
                f"Turn {turn + 1} completed actions:\n"
                + "\n".join(action_summary_lines)
                + "\n\nUpdated screenshot attached. "
                + "If the task goal is now visibly achieved on screen, respond "
                + "'TASK COMPLETE: <summary>'. Otherwise, what is the ONE next action?"
            ))],
        ))

        # Brief wait for page to settle after actions
        await asyncio.sleep(post_nav_sleep)

    # Max turns reached
    await ws_manager.send_status(session_id, "timeout", "Maximum steps reached", grandparents_mode)
    await ws_manager.send_task_complete(
        session_id,
        f"Agent reached the maximum of {settings.MAX_AGENT_TURNS} steps. "
        "The task may be partially complete."
    )
    await update_session_state(session_id, "timeout", "Max turns reached")
    await _signal_extension_complete(session_id, ws_manager)
