"use client";

import React, { useState, useEffect, useRef } from 'react';

interface VoiceInputProps {
    onTranscript: (text: string) => void;
    disabled?: boolean;
}

export function VoiceInput({ onTranscript, disabled }: VoiceInputProps) {
    const [isRecording, setIsRecording] = useState(false);
    const [hasSupport, setHasSupport] = useState(true);
    const recognitionRef = useRef<any>(null);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
            if (SpeechRecognition) {
                const recognition = new SpeechRecognition();
                recognition.continuous = false;
                recognition.interimResults = false;
                // recognition.lang = 'en-US'; // Use browser default

                recognition.onresult = (event: any) => {
                    const transcript = event.results[0][0].transcript;
                    onTranscript(transcript);
                    setIsRecording(false);
                };

                recognition.onerror = (event: any) => {
                    console.error("Speech recognition error", event.error);
                    setIsRecording(false);
                };

                recognition.onend = () => {
                    setIsRecording(false);
                };

                recognitionRef.current = recognition;
            } else {
                setHasSupport(false);
            }
        }
    }, [onTranscript]);

    const toggleRecording = (e: React.MouseEvent) => {
        e.preventDefault();
        if (!hasSupport) {
            alert("Voice input is not supported in this browser.");
            return;
        }

        if (isRecording) {
            recognitionRef.current?.stop();
        } else {
            try {
                recognitionRef.current?.start();
                setIsRecording(true);
            } catch (err) {
                console.error("Failed to start recording:", err);
            }
        }
    };

    if (!hasSupport) {
        return (
            <div className="absolute bottom-4 right-4 text-slate-300 flex items-center gap-1.5 pointer-events-none">
                <span className="material-symbols-outlined text-[18px]">mic_off</span>
                <span className="text-[11px] sm:text-xs font-bold uppercase tracking-wider">Not Supported</span>
            </div>
        );
    }

    return (
        <button
            onClick={toggleRecording}
            disabled={disabled}
            type="button"
            className={`absolute bottom-3 right-3 flex items-center justify-center gap-1.5 transition-all p-2 rounded-lg 
        ${isRecording
                    ? 'bg-red-500 text-white animate-pulse shadow-md focus:outline-none'
                    : 'text-slate-400 focus-within:text-primary group-focus-within:text-primary hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/50'
                } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            title={isRecording ? "Stop recording" : "Speak your task"}
        >
            <span className="material-symbols-outlined text-[20px]">{isRecording ? "graphic_eq" : "mic"}</span>
            <span className="text-[11px] sm:text-xs font-bold uppercase tracking-wider hidden sm:inline">
                {isRecording ? "Listening..." : "Voice Input"}
            </span>
        </button>
    );
}
