"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useSpeech } from "@/hooks/useSpeech";
import { SafetyConfirmModal } from "@/components/SafetyConfirmModal";
import { PausePromptModal } from "@/components/PausePromptModal";
import { VoiceInput } from "@/components/VoiceInput";

export default function Home() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [taskInput, setTaskInput] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [patienceMode, setPatienceMode] = useState(false);
  const [grandparentsMode, setGrandparentsMode] = useState(false);
  const [narrationEnabled, setNarrationEnabled] = useState(true);
  const [displayText, setDisplayText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const narrationQueue = useRef<string[]>([]);
  const isDisplaying = useRef(false);

  const {
    isConnected,
    status,
    statusDetail,
    step,
    screenshot,
    actions,
    narration,
    safetyRequest,
    pausePrompt,
    error,
    startTask,
    sendSafetyResponse,
    cancelTask,
  } = useWebSocket(sessionId);

  // Generate a new session ID on mount
  useEffect(() => {
    if (!sessionId) {
      setSessionId(Math.random().toString(36).substring(2, 10));
    }
  }, [sessionId]);

  const handleStartTask = () => {
    if (!taskInput.trim()) return;
    startTask(taskInput.trim(), urlInput.trim(), patienceMode, grandparentsMode, narrationEnabled);
  };

  const isAgentActive = ["started", "navigating", "thinking", "executing", "confirming"].includes(status);

  // Text-to-Speech for narration
  const { speak, stop } = useSpeech(narrationEnabled);

  // Display narration with a queue to avoid flickering
  const displayNextNarration = useCallback(() => {
    if (narrationQueue.current.length === 0) {
      isDisplaying.current = false;
      return;
    }
    isDisplaying.current = true;
    const next = narrationQueue.current.shift()!;
    setDisplayText(next);
    if (narrationEnabled) {
      speak(next);
    }

    // Hold each message for at least 3 seconds
    setTimeout(displayNextNarration, 3000);
  }, [narrationEnabled, speak]);

  useEffect(() => {
    if (narration) {
      narrationQueue.current.push(narration);
      if (!isDisplaying.current) {
        displayNextNarration();
      }
    }
  }, [narration, displayNextNarration]);

  // Stop speech when task ends
  useEffect(() => {
    if (['completed', 'error', 'cancelled', 'idle'].includes(status)) {
      stop();
    }
  }, [status, stop]);

  // Auto scroll actions
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [actions]);

  return (
    <div className="layout-container flex flex-col min-h-screen bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100 font-display">
      {/* Top Navigation Bar */}
      <header className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 md:px-10 py-4 sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center size-10 rounded-xl bg-primary text-white shadow-sm shadow-primary/30">
            <span className="material-symbols-outlined text-3xl">accessibility</span>
          </div>
          <h1 className="text-xl md:text-2xl font-extrabold tracking-tight">HandOff: Universal Accessibility Agent</h1>
        </div>
        <div className="flex items-center gap-4">
          <button aria-label="Settings" className="flex items-center justify-center size-10 md:size-12 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <span className="material-symbols-outlined text-2xl text-slate-500">settings</span>
          </button>
          <button aria-label="Help" className="flex items-center justify-center size-10 md:size-12 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <span className="material-symbols-outlined text-2xl text-slate-500">help_outline</span>
          </button>
          <div className="h-10 w-[1px] bg-slate-200 dark:bg-slate-700 mx-2 hidden sm:block"></div>
          <div className="flex items-center gap-3 sm:pl-2">
            <div className="hidden md:block text-right">
              <p className="text-sm font-bold">Admin User</p>
              <p className="text-xs text-slate-500">Session ID: {sessionId}</p>
            </div>
            <div className="size-10 rounded-full bg-primary/20 border-2 border-primary overflow-hidden flex items-center justify-center">
              <span className="material-symbols-outlined text-primary">person</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-8 lg:p-12 max-w-7xl mx-auto w-full">
        {/* Welcome Header */}
        <div className="mb-8 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-end">
          <div>
            <h2 className="text-3xl md:text-4xl font-black mb-2 tracking-tight">Agent Dashboard</h2>
            <p className="text-lg text-slate-600 dark:text-slate-400 max-w-2xl">Control your device with natural language and real-time screen analysis.</p>
          </div>
          {isAgentActive && (
            <button
              onClick={cancelTask}
              className="flex items-center gap-2 px-5 py-3 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded-xl font-bold hover:bg-red-200 transition-colors shadow-sm"
            >
              <span className="material-symbols-outlined text-lg">stop_circle</span>
              Abort Mission
            </button>
          )}
        </div>

        {/* Main Interaction Card */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 bg-white dark:bg-slate-900 rounded-3xl p-6 md:p-10 shadow-xl border border-slate-100 dark:border-slate-800">

          {/* Left: Screen Capture Section */}
          <div className="lg:col-span-7 flex flex-col gap-6">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg sm:text-xl font-bold flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">screen_share</span>
                  Live Screen Capture Preview Panel
                </h3>
                <span className={`px-3 py-1 text-[10px] sm:text-xs font-bold rounded-full uppercase tracking-wider ${status === 'completed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                  isAgentActive ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 animate-pulse' :
                    status === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                      'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  }`}>
                  {status === 'idle' ? 'READY' : status.toUpperCase()}
                </span>
              </div>

              {/* Video Preview / Screenshot */}
              <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-[#0a0f1a] group border-4 border-slate-100 dark:border-slate-800 shadow-inner flex items-center justify-center">
                {screenshot ? (
                  <img
                    src={`data:image/png;base64,${screenshot}`}
                    alt="Agent Live Viewport"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-4 opacity-30 select-none pointer-events-none">
                    <span className="material-symbols-outlined text-white text-6xl">monitor</span>
                    <p className="text-white font-medium tracking-wide">Awaiting Visual Telemetry...</p>
                  </div>
                )}

                {step > 0 && (
                  <div className="absolute bottom-4 right-4 flex gap-2">
                    <div className="bg-black/80 backdrop-blur-md px-3 py-1.5 rounded-lg text-slate-300 text-xs font-mono border border-white/10 shadow-lg">Frame {step}</div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                  className="flex items-center justify-center gap-3 h-14 sm:h-16 rounded-2xl bg-primary text-white font-bold text-base sm:text-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/30 active:scale-95 disabled:opacity-50 disabled:active:scale-100"
                  onClick={handleStartTask}
                  disabled={isAgentActive || !isConnected || !taskInput.trim()}
                >
                  <span className="material-symbols-outlined">{isAgentActive ? 'sync' : 'videocam'}</span>
                  {isAgentActive ? 'Streaming Feed...' : 'Start Screen Capture'}
                </button>
                <button className="flex relative items-center justify-center h-14 sm:h-16 rounded-2xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-bold text-base sm:text-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-all active:scale-95 border-2 border-slate-200 dark:border-slate-700 overflow-hidden px-4">
                  {/* Tiny action feed overlay */}
                  {actions.length > 0 ? (
                    <div className="flex items-center gap-3 w-full">
                      <span className="material-symbols-outlined text-primary shrink-0 opacity-70">history</span>
                      <span className="truncate w-full text-left text-sm font-medium text-slate-600 dark:text-slate-300">
                        {actions[actions.length - 1].data.action}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col w-full text-center">
                      <span className="text-sm">Upload Screenshot</span>
                    </div>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Right: Command Input Section */}
          <div className="lg:col-span-5 flex flex-col gap-6 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 pt-8 lg:pt-0 lg:pl-8">
            <div className="flex flex-col h-full gap-4">
              <h3 className="text-lg sm:text-xl font-bold flex items-center gap-2 shrink-0">
                <span className="material-symbols-outlined text-primary">keyboard_command_key</span>
                Natural Language Commands
              </h3>

              <div className="flex flex-col shrink-0 mt-2">
                <label className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-2" htmlFor="url-input">Target URL (Optional)</label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">link</span>
                  <input
                    id="url-input"
                    type="text"
                    className="w-full py-4 pr-4 pl-12 rounded-xl bg-slate-50 dark:bg-slate-950 border-2 border-slate-200 dark:border-slate-700 focus:border-primary dark:focus:border-primary focus:ring-4 focus:ring-primary/20 focus:outline-none font-medium transition-all placeholder:text-slate-400 placeholder:font-normal"
                    placeholder="e.g. google.com"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    disabled={isAgentActive}
                  />
                </div>
              </div>

              <div className="flex flex-col shrink-0 mt-2">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="patience-mode"
                      checked={patienceMode}
                      onChange={(e) => setPatienceMode(e.target.checked)}
                      disabled={isAgentActive}
                      className="w-4 h-4 text-primary bg-slate-100 border-slate-300 rounded focus:ring-primary dark:focus:ring-primary dark:ring-offset-slate-800 focus:ring-2 dark:bg-slate-700 dark:border-slate-600 cursor-pointer"
                    />
                    <label htmlFor="patience-mode" className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest cursor-pointer">
                      Patience Mode (Slower execution)
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="grandparents-mode"
                      checked={grandparentsMode}
                      onChange={(e) => setGrandparentsMode(e.target.checked)}
                      disabled={isAgentActive}
                      className="w-4 h-4 text-primary bg-slate-100 border-slate-300 rounded focus:ring-primary dark:focus:ring-primary dark:ring-offset-slate-800 focus:ring-2 dark:bg-slate-700 dark:border-slate-600 cursor-pointer"
                    />
                    <label htmlFor="grandparents-mode" className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest cursor-pointer">
                      Grandparents Mode (Simple narration & UI)
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="narration-tts"
                      checked={narrationEnabled}
                      onChange={(e) => setNarrationEnabled(e.target.checked)}
                      disabled={isAgentActive}
                      className="w-4 h-4 text-primary bg-slate-100 border-slate-300 rounded focus:ring-primary dark:focus:ring-primary dark:ring-offset-slate-800 focus:ring-2 dark:bg-slate-700 dark:border-slate-600 cursor-pointer"
                    />
                    <label htmlFor="narration-tts" className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest cursor-pointer">
                      🔊 Speak Narration (Text-to-Speech)
                    </label>
                  </div>
                </div>
              </div>

              <div className="flex-1 flex flex-col gap-2 min-h-[180px]">
                <label className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mt-2" htmlFor="command-input">Instruction</label>
                <div className="relative flex-1 group">
                  <textarea
                    id="command-input"
                    className="w-full h-full p-5 sm:p-6 rounded-2xl bg-white dark:bg-slate-950 border-2 border-slate-200 dark:border-slate-700 focus:border-primary dark:focus:border-primary focus:ring-4 focus:ring-primary/20 focus:outline-none text-lg sm:text-xl font-medium transition-all placeholder:text-slate-400 dark:placeholder:text-slate-600 resize-none shadow-sm shadow-slate-200/50 dark:shadow-none"
                    placeholder='Tell the agent what to do... e.g., "Search for weather in Bangalore"'
                    value={taskInput}
                    onChange={(e) => setTaskInput(e.target.value)}
                    disabled={isAgentActive}
                  />
                  <VoiceInput
                    onTranscript={(text: string) => setTaskInput(prev => prev ? prev + " " + text : text)}
                    disabled={isAgentActive}
                  />
                </div>
              </div>

              <button
                className="flex items-center justify-center gap-3 h-16 sm:h-20 w-full shrink-0 rounded-2xl bg-primary text-white font-black text-xl sm:text-2xl hover:bg-primary/90 transition-all shadow-[0_10px_20px_-10px_rgba(67,135,244,0.6)] active:scale-[0.98] mt-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
                onClick={handleStartTask}
                disabled={isAgentActive || !isConnected || !taskInput.trim()}
              >
                <span className="material-symbols-outlined text-3xl">play_circle</span>
                RUN TASK
              </button>

              <div className={`p-4 rounded-xl shrink-0 mt-3 transition-colors ${error ? 'bg-red-50 border border-red-200 dark:bg-red-900/10' :
                isAgentActive ? 'bg-indigo-50 border border-indigo-200 dark:bg-indigo-900/20' :
                  'bg-blue-50/50 border border-blue-100 dark:bg-blue-900/10 dark:border-blue-900/30'
                }`}>
                {error ? (
                  <p className="text-sm font-medium text-red-700 dark:text-red-400 flex items-start gap-2">
                    <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
                    {error}
                  </p>
                ) : isAgentActive && (statusDetail || narration) ? (
                  <div className="flex items-start gap-2">
                    <span className="material-symbols-outlined text-[18px] text-indigo-600 dark:text-indigo-400 mt-0.5 animate-pulse shrink-0">psychiatry</span>
                    <div>
                      <p className="text-sm font-bold text-indigo-700 dark:text-indigo-400">{statusDetail}</p>
                      {displayText && <p className="text-xs text-indigo-600/80 dark:text-indigo-300/80 mt-1 italic font-medium leading-relaxed tracking-wide">"{displayText}"</p>}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 cursor-pointer group" onClick={() => setTaskInput("Search for weather in Bangalore today")}>
                    <span className="material-symbols-outlined text-[18px] shrink-0 text-primary group-hover:text-primary/80 transition-colors">info</span>
                    <p className="text-xs sm:text-sm font-medium text-slate-600 dark:text-slate-400 group-hover:text-primary transition-colors">
                      Pro Tip: You can chain multiple commands using "and then". <span className="underline decoration-primary/30 underline-offset-2">(Try an example)</span>
                    </p>
                  </div>
                )}
              </div>

            </div>
          </div>

        </div>
      </main>

      {/* Stats/History Strip */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center gap-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="size-14 shrink-0 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 flex items-center justify-center border border-blue-100 dark:border-blue-900/30">
            <span className="material-symbols-outlined text-3xl">history</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-1">Last Task</p>
            <p className="text-base sm:text-lg font-bold text-slate-800 dark:text-white truncate">
              {taskInput ? `"${taskInput}"` : "None"}
            </p>
            <p className="text-xs text-green-600 dark:text-green-500 font-bold tracking-wide mt-1">{status === 'completed' ? 'Completed successfully' : isAgentActive ? 'In Progress...' : 'Waiting'}</p>
          </div>
        </div>

        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center gap-5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
          <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-white dark:from-slate-900 to-transparent z-10 pointer-events-none"></div>
          <div className="size-14 shrink-0 rounded-xl bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 flex items-center justify-center border border-purple-100 dark:border-purple-900/30">
            <span className="material-symbols-outlined text-3xl">bolt</span>
          </div>
          <div className="min-w-0 flex-1 relative h-[60px] cursor-ns-resize">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-1 sticky top-0 bg-white dark:bg-slate-900 z-20">Confidence Score & Logs</p>

            <div
              className="overflow-y-auto scroll-smooth absolute inset-x-0 bottom-0 h-[44px] pb-1 scroll-area opacity-0 group-hover:opacity-100 transition-opacity"
              ref={scrollRef}
            >
              {actions.length > 0 ? (
                <div className="flex flex-col gap-1.5 justify-end min-h-full">
                  {actions.map((a, i) => (
                    <p key={i} className="text-[11px] text-slate-500 font-mono truncate leading-tight border-l-2 border-primary/30 pl-2">
                      {a.data.action}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-slate-400 italic">No telemetry logs recorded yet...</p>
              )}
            </div>

            <div className="absolute inset-x-0 bottom-1 opacity-100 group-hover:opacity-0 transition-opacity flex flex-col justify-end h-[44px]">
              <p className="text-base sm:text-lg font-bold text-slate-800 dark:text-white truncate">98.4% Accuracy</p>
              <p className="text-xs text-slate-400 tracking-wide mt-0.5">Based on last 50 tasks</p>
            </div>
          </div>
        </div>

        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center gap-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="size-14 shrink-0 rounded-xl bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 flex items-center justify-center border border-orange-100 dark:border-orange-900/30">
            <span className="material-symbols-outlined text-3xl">visibility</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-1">Active Overlays</p>
            <p className="text-base sm:text-lg font-bold text-slate-800 dark:text-white truncate">3 Accessibility Layers</p>
            <p className="text-xs text-slate-400 tracking-wide mt-1 truncate">Color correction: Tritanopia</p>
          </div>
        </div>
      </div>

      {/* Contextual Help Footer */}
      <footer className="mt-auto px-6 py-5 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/60 backdrop-blur-md">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-slate-500 text-sm">
          <div className="flex items-center gap-6">
            <a className="hover:text-primary transition-colors font-medium cursor-pointer">Privacy Policy</a>
            <a className="hover:text-primary transition-colors font-medium cursor-pointer">Keyboard Shortcuts</a>
            <a className="hover:text-primary transition-colors font-medium cursor-pointer">API Status</a>
          </div>
          <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 shadow-sm shadow-slate-200/50 dark:shadow-none">
            <span className="relative flex h-2 w-2">
              {isConnected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75"></span>}
              <span className={`relative inline-flex rounded-full h-2 w-2 ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></span>
            </span>
            <span className="font-bold text-[11px] uppercase tracking-wider text-slate-700 dark:text-slate-300">
              {isConnected ? 'Agent V2.4 Connected' : 'Backend Disconnected'}
            </span>
          </div>
        </div>
      </footer>

      {/* Safety Modal */}
      {safetyRequest && (
        <SafetyConfirmModal
          request={safetyRequest}
          onRespond={sendSafetyResponse}
        />
      )}

      {/* Pause Prompt Modal */}
      {pausePrompt && (
        <PausePromptModal
          prompt={pausePrompt}
          onRespond={sendSafetyResponse}
        />
      )}
    </div>
  );
}
