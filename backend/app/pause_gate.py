import asyncio
from dataclasses import dataclass, field
from typing import Optional

@dataclass
class PauseGate:
    """Holds the pause/resume state for one agent session."""
    event: asyncio.Event = field(default_factory=asyncio.Event)
    user_input: Optional[str] = None   # text the user typed (password, etc.)
    approved: bool = False             # True = continue, False = cancel
    reason: str = ''                   # shown to user in frontend prompt

# Module-level registry keyed by session_id
_gates: dict[str, PauseGate] = {}

def get_or_create(session_id: str) -> PauseGate:
    if session_id not in _gates:
        _gates[session_id] = PauseGate()
    return _gates[session_id]

def release(session_id: str):
    _gates.pop(session_id, None)
