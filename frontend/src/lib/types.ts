export type AgentStatus = 'idle' | 'started' | 'navigating' | 'thinking' | 'executing' | 'confirming' | 'completed' | 'error' | 'timeout' | 'cancelled';

export interface Task {
    task: string;
    start_url?: string;
}

export interface AgentAction {
    action: string;
    args: Record<string, any>;
    success?: boolean;
    detail?: string;
    original_call_id?: string;
}

export interface SafetyConfirmRequest {
    request_id: string;
    action: AgentAction;
}

export interface PausePromptData {
    reason: string;
    prompt: string;
    needs_input: boolean;
}

export interface WSMessage {
    type: string;
    data: any;
}

export interface SessionInfo {
    session_id: string;
    task: string;
    start_url: string;
    status: string;
    created_at: string;
    summary?: string;
}
