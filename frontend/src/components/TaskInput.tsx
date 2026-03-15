import { useState } from 'react';
import { Play, Link2, MessageSquare, Volume2, VolumeX } from 'lucide-react';

interface TaskInputProps {
    onStart: (task: string, startUrl: string, narrationEnabled: boolean) => void;
    disabled: boolean;
}

export function TaskInput({ onStart, disabled }: TaskInputProps) {
    const [task, setTask] = useState('');
    const [url, setUrl] = useState('');
    const [narrationEnabled, setNarrationEnabled] = useState(true);

    const handleStart = () => {
        if (!task.trim()) return;
        onStart(task.trim(), url.trim(), narrationEnabled);
    };

    const handleExampleClick = (exampleTask: string, exampleUrl: string) => {
        setTask(exampleTask);
        setUrl(exampleUrl);
    };

    return (
        <div className="glass-card" style={{ flex: '0 0 auto' }}>
            <div className="card-title">
                <MessageSquare size={20} className="text-accent-cyan" />
                New Mission
            </div>

            <div>
                <label className="input-label" htmlFor="url-input">Target URL (Optional)</label>
                <div style={{ position: 'relative' }}>
                    <Link2 size={18} style={{ position: 'absolute', top: '15px', left: '16px', color: 'var(--text-muted)' }} />
                    <input
                        id="url-input"
                        type="text"
                        className="input-field"
                        style={{ paddingLeft: '44px' }}
                        placeholder="e.g. google.com"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        disabled={disabled}
                    />
                </div>
            </div>

            <div>
                <label className="input-label" htmlFor="task-input">Agent Instructions</label>
                <textarea
                    id="task-input"
                    className="input-field"
                    placeholder="Describe perfectly what the agent should accomplish..."
                    value={task}
                    onChange={(e) => setTask(e.target.value)}
                    disabled={disabled}
                />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                <button
                    className="btn-primary"
                    onClick={handleStart}
                    disabled={disabled || !task.trim()}
                    style={{ flex: 1 }}
                >
                    <Play fill="currentColor" size={20} />
                    Execute Mission
                </button>

                <button
                    type="button"
                    className={`btn-secondary ${narrationEnabled ? 'active' : ''}`}
                    onClick={() => setNarrationEnabled(!narrationEnabled)}
                    title={narrationEnabled ? "Narration: ON" : "Narration: OFF"}
                    style={{
                        flex: '0 0 48px',
                        padding: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderColor: narrationEnabled ? 'var(--accent-cyan)' : 'var(--border-color)',
                        color: narrationEnabled ? 'var(--accent-cyan)' : 'var(--text-muted)'
                    }}
                >
                    {narrationEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
                </button>
            </div>

            <div style={{ marginTop: '0.5rem' }}>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Quick Starts:</p>
                <div className="example-chips">
                    <span
                        className="chip"
                        onClick={() => handleExampleClick("Search for weather in Bangalore today", "https://google.com")}
                    >
                        Weather Search
                    </span>
                    <span
                        className="chip"
                        onClick={() => handleExampleClick("Find the latest tech news and summarize headlines", "https://news.ycombinator.com")}
                    >
                        Hacker News Reader
                    </span>
                    <span
                        className="chip"
                        onClick={() => handleExampleClick("Look up flights from SFO to JFK for next Friday", "https://flights.google.com")}
                    >
                        Book Flights
                    </span>
                </div>
            </div>
        </div>
    );
}
