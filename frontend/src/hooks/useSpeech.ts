"use client";

import { useRef, useCallback, useEffect } from 'react';

/**
 * A hook that wraps the Web SpeechSynthesis API for speaking text aloud.
 * - Cancels the previous utterance before speaking a new one (no queue buildup)
 * - Gracefully no-ops if the browser doesn't support speech synthesis
 * - Cleans up on unmount
 */
export function useSpeech(enabled: boolean) {
    const synthRef = useRef<SpeechSynthesis | null>(null);
    const lastSpokenRef = useRef<string>('');

    useEffect(() => {
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            synthRef.current = window.speechSynthesis;
        }
        return () => {
            // Cancel any in-progress speech on unmount
            synthRef.current?.cancel();
        };
    }, []);

    const speak = useCallback((text: string) => {
        if (!enabled || !synthRef.current || !text.trim()) return;

        // Skip duplicate narrations (Gemini sometimes repeats)
        const trimmed = text.trim();
        if (trimmed === lastSpokenRef.current) return;
        lastSpokenRef.current = trimmed;

        // Cancel any in-progress speech so narration stays current
        synthRef.current.cancel();

        const utterance = new SpeechSynthesisUtterance(trimmed);
        utterance.rate = 0.95;   // Slightly slower for accessibility
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        synthRef.current.speak(utterance);
    }, [enabled]);

    const stop = useCallback(() => {
        synthRef.current?.cancel();
        lastSpokenRef.current = '';
    }, []);

    return { speak, stop };
}
