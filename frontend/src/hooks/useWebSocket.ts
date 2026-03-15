import { useState, useEffect, useCallback, useRef } from 'react';
import { AgentStatus, AgentAction, SafetyConfirmRequest, PausePromptData } from '../lib/types';

let _audioCtx: AudioContext | null = null;
function getAudioContext(sampleRate = 24000): AudioContext {
    if (!_audioCtx || _audioCtx.state === "closed") {
        _audioCtx = new AudioContext({ sampleRate });
    }
    // Browser requires user gesture to resume — handle suspended state
    if (_audioCtx.state === "suspended") {
        _audioCtx.resume();
    }
    return _audioCtx;
}


interface UseWebSocketReturn {
    isConnected: boolean;
    status: AgentStatus;
    statusDetail: string;
    step: number;
    screenshot: string | null;
    actions: { step: number; data: AgentAction }[];
    narration: string;
    safetyRequest: SafetyConfirmRequest | null;
    pausePrompt: PausePromptData | null;
    taskSummary: string | null;
    error: string | null;
    startTask: (task: string, start_url: string, patienceMode?: boolean, grandparentsMode?: boolean, narrationEnabled?: boolean) => void;
    sendSafetyResponse: (request_id: string, approved: boolean) => void;
    cancelTask: () => void;
}

export function useWebSocket(sessionId: string | null): UseWebSocketReturn {
    const [isConnected, setIsConnected] = useState(false);
    const [status, setStatus] = useState<AgentStatus>('idle');
    const [statusDetail, setStatusDetail] = useState('');
    const [step, setStep] = useState(0);
    const [screenshot, setScreenshot] = useState<string | null>(null);
    const [actions, setActions] = useState<{ step: number; data: AgentAction }[]>([]);
    const [narration, setNarration] = useState('');
    const [safetyRequest, setSafetyRequest] = useState<SafetyConfirmRequest | null>(null);
    const [pausePrompt, setPausePrompt] = useState<PausePromptData | null>(null);
    const [taskSummary, setTaskSummary] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const reconnectAttempts = useRef(0);
    const intentionalClose = useRef(false);

    const audioQueue = useRef<AudioBuffer[]>([]);
    const isPlayingAudio = useRef(false);

    const playNext = useCallback(() => {
        if (isPlayingAudio.current || audioQueue.current.length === 0) return;
        const ctx = getAudioContext();
        if (ctx.state === 'suspended') ctx.resume();

        const buffer = audioQueue.current.shift();
        if (!buffer) return;

        isPlayingAudio.current = true;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.onended = () => {
            isPlayingAudio.current = false;
            playNext();
        };
        source.start();
    }, []);

    const connect = useCallback(() => {
        if (!sessionId) return;

        // Reset state on new connection attempt (but keep history if just reconnecting)
        if (reconnectAttempts.current === 0) {
            setStatus('idle');
            setStatusDetail('');
            setStep(0);
            setScreenshot(null);
            setActions([]);
            setNarration('');
            setSafetyRequest(null);
            setPausePrompt(null);
            setTaskSummary(null);
            setError(null);
        }

        const wsUrl = `ws://localhost:8080/ws/${sessionId}`;
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log(`WebSocket connected to ${sessionId}`);
            setIsConnected(true);
            setError(null);
            reconnectAttempts.current = 0;
            intentionalClose.current = false;
        };

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                const { type, data } = message;

                switch (type) {
                    case 'status_update':
                        setStatus(data.status);
                        if (data.detail) setStatusDetail(data.detail);
                        break;

                    case 'screenshot_update':
                        setScreenshot(data.screenshot);
                        setStep(data.step);
                        break;

                    case 'action_executed':
                        setActions((prev) => [...prev, { step: data.step, data: data.action }]);
                        break;

                    case 'narration':
                        setNarration(data.text);
                        break;

                    case 'safety_confirm':
                        setStatus('confirming');
                        setStatusDetail('Waiting for user confirmation');
                        setSafetyRequest({
                            request_id: data.request_id,
                            action: data.action,
                        });
                        break;

                    case 'pause_prompt':
                        setStatus('confirming');
                        setStatusDetail('Waiting for your input');
                        setPausePrompt(data);
                        break;

                    case 'task_complete':
                        setStatus('completed');
                        setStatusDetail('Task finished');
                        setTaskSummary(data.summary);
                        break;

                    case "audio_narration": {
                        const { audio, sample_rate } = message.data;

                        try {
                            // Decode base64
                            const raw = atob(audio);
                            if (raw.length < 2) break;

                            const buf = new ArrayBuffer(raw.length);
                            const view = new Uint8Array(buf);
                            for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);

                            const pcm = new Int16Array(buf);
                            if (pcm.length === 0) break;

                            const float32 = new Float32Array(pcm.length);
                            for (let i = 0; i < pcm.length; i++) {
                                float32[i] = pcm[i] / 32768.0;
                            }

                            const ctx = getAudioContext(sample_rate ?? 24000);

                            // Validate before creating buffer
                            if (!isFinite(float32.length) || float32.length === 0) break;

                            const audioBuf = ctx.createBuffer(1, float32.length, ctx.sampleRate);
                            audioBuf.copyToChannel(float32, 0);

                            // Push to queue instead of playing immediately
                            audioQueue.current.push(audioBuf);
                            playNext();
                        } catch (e) {
                            console.warn("Audio chunk skipped:", e);
                        }
                        break;
                    }


                    case 'error':
                        setStatus('error');
                        setError(data.message);
                        break;

                    default:
                        console.warn(`Unknown message type: ${type}`);
                }
            } catch (err) {
                console.error('Failed to parse WebSocket message', err);
            }
        };

        ws.onclose = () => {
            setIsConnected(false);

            // Auto-reconnect with exponential backoff if not explicitly completed/cancelled
            if (status !== 'completed' && status !== 'cancelled' && status !== 'error') {
                const timeout = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
                console.log(`WebSocket disconnected. Reconnecting in ${timeout}ms...`);
                reconnectAttempts.current += 1;

                reconnectTimeoutRef.current = setTimeout(() => {
                    connect();
                }, timeout);
            }
        };

        ws.onerror = (err) => {
            // Avoid logging errors during intentional cleanup
            if (!intentionalClose.current) {
                console.error('WebSocket error:', err);
            }
        };

        wsRef.current = ws;
    }, [sessionId]); // removed status since we use refs/functional updates where needed

    // Connect on mount or sessionId change
    useEffect(() => {
        intentionalClose.current = false;
        connect();

        return () => {
            intentionalClose.current = true;
            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
            if (wsRef.current) {
                // Prevent onclose from triggering a reconnect loop after unmount
                wsRef.current.onclose = null;
                wsRef.current.onerror = null;
                wsRef.current.close();
            }
        };
    }, [connect]);


    // --- Actions ---

    const startTask = useCallback((task: string, start_url: string, patienceMode: boolean = false, grandparentsMode: boolean = false, narrationEnabled: boolean = true) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            setError('Not connected to backend');
            return;
        }

        // Reset state for new task if reusing session
        setStep(0);
        setScreenshot(null);
        setActions([]);
        setNarration('');
        setSafetyRequest(null);
        setPausePrompt(null);
        setTaskSummary(null);
        setError(null);

        wsRef.current.send(JSON.stringify({
            type: 'task_start',
            data: { task, start_url, execution_mode: "live", patience_mode: patienceMode, grandparents_mode: grandparentsMode, narration_enabled: narrationEnabled }
        }));
    }, []);

    const sendSafetyResponse = useCallback((request_id: string, approved: boolean) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        wsRef.current.send(JSON.stringify({
            type: 'safety_response',
            data: { request_id, approved }
        }));

        setSafetyRequest(null);
        setPausePrompt(null);
        setStatus('thinking');
        setStatusDetail('Resuming execution...');
    }, []);

    const cancelTask = useCallback(() => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        wsRef.current.send(JSON.stringify({
            type: 'cancel_task',
            data: {}
        }));

        setStatus('cancelled');
        setStatusDetail('Task cancelled by user');
    }, []);

    return {
        isConnected,
        status,
        statusDetail,
        step,
        screenshot,
        actions,
        narration,
        safetyRequest,
        pausePrompt,
        taskSummary,
        error,
        startTask,
        sendSafetyResponse,
        cancelTask,
    };
}
