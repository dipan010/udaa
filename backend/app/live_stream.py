"""Gemini Live API streaming for real-time narration."""

import asyncio
import base64
import hashlib
import logging
import time

from google import genai
from google.genai import types

from app.config import get_settings
from app.browser_adapters.base_adapter import BrowserAdapter
from app.websocket import manager as ws_manager

logger = logging.getLogger(__name__)
settings = get_settings()

# ── Timing constants ──────────────────────────────────────────────────────────
NARRATION_SCREENSHOT_INTERVAL = 6.0   # seconds between screenshots sent to Live API
MIN_NARRATION_GAP             = 5.0   # minimum seconds between narration text sends
ACTION_NARRATION_COOLDOWN     = 4.0   # suppress narration for N seconds after an action

NARRATION_PROMPT_GRANDPARENTS = (
    "You are a friendly, patient accessibility companion helping a senior citizen use a computer. "
    "You observe their screen and gently explain what the automated helper is doing in very simple, "
    "reassuring terms. Focus on comfort and clarity. Speak directly to them like a helpful grandchild. "
    "Keep sentences short and slow-paced. Never use technical jargon like 'agent', 'URL', 'clicking', 'DOM', or 'UI'. "
    "Example: 'I'm opening up the train booking website for you now. Just give me a moment to find the right page.'"
)

NARRATION_PROMPT_DEFAULT = (
    "You are a real-time screen narrator for a digital accessibility agent. "
    "You observe screenshots of a web browser and describe what you see "
    "in simple, clear language. Focus on: what is currently on screen, "
    "what the agent is doing, and what will happen next. "
    "Keep narrations short (1-2 sentences). "
    "Use friendly, encouraging language."
)


async def run_live_stream(
    session_id: str,
    task: str,
    browser: BrowserAdapter,
    grandparents_mode: bool = False,
    last_action_time_ref: list | None = None,
    completion_text_ref: list | None = None,
    live_session_ref: list | None = None,   # ← add
):
    client = genai.Client(api_key=settings.GOOGLE_API_KEY)
    prompt_text = NARRATION_PROMPT_GRANDPARENTS if grandparents_mode else NARRATION_PROMPT_DEFAULT

    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=types.Content(
            parts=[types.Part(text=prompt_text)]
        ),
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                    voice_name="Aoede"
                )
            )
        ),
    )

    try:
        async with client.aio.live.connect(
            model=settings.LIVE_MODEL,
            config=config,
        ) as session:
            logger.info(f"Live API session started (audio mode) for {session_id}")

            # Store so agent loop can push action narration into it
            if live_session_ref is not None:
                live_session_ref[0] = session

            await session.send_client_content(
                turns=types.Content(
                    parts=[types.Part(text=f"The user wants to: {task}")]
                )
            )

            # ── Narration state ───────────────────────────────────────────────
            last_narration_time = 0.0

            async def receive_narration():
                nonlocal last_narration_time
                try:
                    while True:
                        async for response in session.receive():
                            # Audio chunk → queue on frontend
                            if response.data:
                                audio_b64 = base64.b64encode(response.data).decode("utf-8")
                                await ws_manager.send_audio_narration(session_id, audio_b64)

                            # Text transcript — filter thought tokens, respect cooldowns
                            try:
                                if response.candidates:
                                    for candidate in response.candidates:
                                        if not candidate.content or not candidate.content.parts:
                                            continue
                                        for part in candidate.content.parts:
                                            # Skip internal reasoning tokens
                                            if getattr(part, 'thought', False):
                                                continue
                                            if not part.text:
                                                continue

                                            now = time.time()

                                            # Suppress during rapid action bursts
                                            if last_action_time_ref and \
                                               (now - last_action_time_ref[0]) < ACTION_NARRATION_COOLDOWN:
                                                logger.debug("Narration suppressed — action cooldown active")
                                                continue

                                            # Enforce minimum gap between narrations
                                            if now - last_narration_time < MIN_NARRATION_GAP:
                                                continue

                                            await ws_manager.send_narration(session_id, part.text)
                                            last_narration_time = now
                            except AttributeError:
                                pass

                except asyncio.CancelledError:
                    pass
                except Exception as e:
                    logger.error(f"Narration receive error: {e}")

            receiver = asyncio.create_task(receive_narration())

            try:
                last_screenshot_hash = None

                while True:
                    # Check if agent flagged completion
                    if completion_text_ref and completion_text_ref[0] is not None:
                        summary = completion_text_ref[0]
                        completion_text_ref[0] = None

                        speak_text = (
                            f"All done! {summary}"
                            if grandparents_mode
                            else f"Task complete. {summary}"
                        )
                        # Inject the result — Gemini will speak it in the same voice
                        await session.send_client_content(
                            turns=types.Content(
                                parts=[types.Part(text=speak_text)]
                            )
                        )
                        await asyncio.sleep(3.5)  # let audio generate and queue before stream cancels
                        break                     # exit cleanly — agent is done

                    if not browser.page:
                        await asyncio.sleep(1)
                        continue

                    try:
                        screenshot_bytes = await browser.capture_screenshot()

                        # Fix #3: Only send if screen actually changed
                        current_hash = hashlib.md5(screenshot_bytes).hexdigest()
                        if current_hash != last_screenshot_hash:
                            await session.send_realtime_input(
                                media=types.Blob(
                                    data=screenshot_bytes,
                                    mime_type="image/png",
                                )
                            )
                            last_screenshot_hash = current_hash
                        else:
                            logger.debug("Screenshot unchanged — skipping narration input")

                    except Exception as e:
                        logger.debug(f"Screenshot stream error: {e}")

                    await asyncio.sleep(NARRATION_SCREENSHOT_INTERVAL)

            except asyncio.CancelledError:
                logger.info(f"Live stream cancelled for {session_id}")
            finally:
                receiver.cancel()
                if live_session_ref is not None:
                    live_session_ref[0] = None
                try:
                    await receiver
                except asyncio.CancelledError:
                    pass

    except Exception as e:
        logger.error(f"Live API connection error: {e}")
        await ws_manager.send_narration(
            session_id,
            "Real-time narration is temporarily unavailable."
        )