import { useState } from 'react';
import { PausePromptData } from '../lib/types';
import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react';

interface PausePromptModalProps {
    prompt: PausePromptData;
    onRespond: (request_id: string, approved: boolean, userInput?: string) => void;
}

export function PausePromptModal({ prompt, onRespond }: PausePromptModalProps) {
    const [inputValue, setInputValue] = useState("");

    return (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[1000] flex items-center justify-center animate-[fadeIn_0.2s_ease]">
            <div className="bg-white dark:bg-slate-900 border border-primary/40 rounded-3xl p-8 w-[90%] max-w-[500px] shadow-[0_0_50px_rgba(67,135,244,0.15)] flex flex-col gap-6">
                <div className="flex items-center gap-4 text-primary">
                    <AlertTriangle size={32} />
                    <h2 className="text-2xl font-black tracking-tight">Agent Paused</h2>
                </div>

                <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
                    <p className="text-slate-800 dark:text-slate-200 font-medium text-lg leading-relaxed">{prompt.prompt}</p>
                    {prompt.reason && (
                        <p className="text-slate-500 text-xs uppercase tracking-wider font-bold mt-4">Reason: {prompt.reason}</p>
                    )}
                </div>

                {prompt.needs_input && (
                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Your Input</label>
                        <input
                            type="text"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            className="w-full py-4 px-4 rounded-xl bg-slate-50 dark:bg-slate-950 border-2 border-slate-200 dark:border-slate-700 focus:border-primary focus:ring-4 focus:ring-primary/20 outline-none font-medium transition-all"
                            placeholder="Type your response here..."
                            autoFocus
                        />
                    </div>
                )}

                <div className="flex gap-4 mt-2">
                    <button
                        className="flex-1 px-4 py-4 rounded-xl border-2 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors font-bold flex items-center justify-center gap-2"
                        onClick={() => onRespond("pause_gate", false)}
                    >
                        <XCircle size={18} />
                        Cancel Task
                    </button>

                    <button
                        className="flex-1 px-4 py-4 rounded-xl bg-primary text-white hover:bg-primary/90 transition-all shadow-lg active:scale-95 font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => onRespond("pause_gate", true, inputValue)}
                        disabled={prompt.needs_input && !inputValue.trim()}
                    >
                        <CheckCircle size={18} />
                        {prompt.needs_input ? "Submit & Continue" : "Continue"}
                    </button>
                </div>
            </div>
        </div>
    );
}
