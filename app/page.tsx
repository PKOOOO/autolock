'use client';

import { useState, useEffect, useCallback } from 'react';

interface Session {
    id: string;
    locker_id: string;
    phone: string;
    status: string;
    started_at: string | null;
    ended_at: string | null;
    created_at: string;
    amount_final: number;
    minutes_used: number;
    current_cost: number;
}

interface DashboardData {
    success: boolean;
    count: number;
    sessions: Session[];
}

function formatDuration(startedAt: string): string {
    const start = new Date(startedAt).getTime();
    const now = Date.now();
    const diffMs = now - start;
    const totalSec = Math.floor(diffMs / 1000);
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;

    if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
}

function formatTime(dateStr: string | null): string {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function getLiveCost(startedAt: string): number {
    const start = new Date(startedAt).getTime();
    const now = Date.now();
    const mins = Math.max(1, Math.ceil((now - start) / 60000));
    return mins;
}

export default function DashboardPage() {
    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [tick, setTick] = useState(0);

    const fetchData = useCallback(async () => {
        try {
            const res = await fetch('/api/dashboard');
            const json = await res.json();
            setData(json);
            setLastUpdated(new Date());
        } catch (err) {
            console.error('Failed to fetch dashboard:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    // Fetch on mount + every 10 seconds
    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 10000);
        return () => clearInterval(interval);
    }, [fetchData]);

    // Tick every second for live timer updates
    useEffect(() => {
        const interval = setInterval(() => setTick(t => t + 1), 1000);
        return () => clearInterval(interval);
    }, []);

    const sessions = data?.sessions || [];
    const activeSessions = sessions.filter(s => s.status === 'active' || s.status === 'pending_payment' || s.status === 'paid');
    const endedSessions = sessions.filter(s => s.status === 'ended');
    const totalRevenue = sessions.reduce((sum, s) => sum + (s.amount_final || 0), 0);
    const activeRevenue = activeSessions.reduce((sum, s) => {
        if (s.started_at) return sum + getLiveCost(s.started_at);
        return sum;
    }, 0);

    // Force using tick to prevent tree-shaking
    void tick;

    return (
        <>
            {/* Header */}
            <header className="header">
                <div className="header-inner">
                    <div className="header-brand">
                        <div className="header-logo">🔐</div>
                        <div className="header-text">
                            <h1>Ngala Memorial Girls — Watamu</h1>
                            <p>AutoLock Smart Storage System</p>
                        </div>
                    </div>
                    <div className="header-badge">
                        <span className="dot"></span>
                        System Online
                    </div>
                </div>
                <div className="header-accent"></div>
            </header>

            {/* Main Content */}
            <main className="main">
                {/* Stats Grid */}
                <div className="stats-grid">
                    <div className="stat-card blue">
                        <div className="stat-icon blue">📦</div>
                        <div className="stat-label">Active Lockers</div>
                        <div className="stat-value">{activeSessions.length}</div>
                        <div className="stat-sub">Items currently stored</div>
                    </div>

                    <div className="stat-card red">
                        <div className="stat-icon red">💰</div>
                        <div className="stat-label">Running Fees</div>
                        <div className="stat-value">KES {activeRevenue}</div>
                        <div className="stat-sub">Accumulating now</div>
                    </div>

                    <div className="stat-card green">
                        <div className="stat-icon green">✅</div>
                        <div className="stat-label">Completed</div>
                        <div className="stat-value">{endedSessions.length}</div>
                        <div className="stat-sub">Sessions today</div>
                    </div>

                    <div className="stat-card amber">
                        <div className="stat-icon amber">📊</div>
                        <div className="stat-label">Total Revenue</div>
                        <div className="stat-value">KES {totalRevenue + activeRevenue}</div>
                        <div className="stat-sub">All sessions</div>
                    </div>
                </div>

                {/* Sessions Table */}
                <div className="table-container">
                    <div className="table-header">
                        <h2>Storage Sessions</h2>
                        <button
                            className={`refresh-btn ${loading ? 'loading' : ''}`}
                            onClick={() => { setLoading(true); fetchData(); }}
                        >
                            🔄 {loading ? 'Loading...' : 'Refresh'}
                        </button>
                    </div>

                    {sessions.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-icon">📭</div>
                            <p>No sessions yet</p>
                            <div className="sub">Sessions will appear here when customers store items</div>
                        </div>
                    ) : (
                        <>
                            <table>
                                <thead>
                                    <tr>
                                        <th>Locker</th>
                                        <th>Status</th>
                                        <th>Duration</th>
                                        <th>Fee (KES)</th>
                                        <th>Phone</th>
                                        <th>Started</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sessions.map((session) => {
                                        const isActive = session.status === 'active' || session.status === 'pending_payment' || session.status === 'paid';
                                        const liveCost = session.started_at ? getLiveCost(session.started_at) : 0;
                                        const displayCost = isActive ? liveCost : (session.amount_final || 0);
                                        const displayDuration = session.started_at
                                            ? (isActive ? formatDuration(session.started_at) : `${session.minutes_used || 0}m`)
                                            : '—';

                                        return (
                                            <tr key={session.id} className={isActive ? 'active-row' : ''}>
                                                <td>
                                                    <span className="locker-badge">
                                                        <span className="locker-icon">{isActive ? '🔒' : '🔓'}</span>
                                                        {session.locker_id}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className={`status-badge ${session.status}`}>
                                                        <span className="status-dot"></span>
                                                        {session.status === 'pending_payment' ? 'Paying' : session.status}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className={`time-cell ${isActive ? 'active-time' : ''}`}>
                                                        {displayDuration}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className={`fee-cell ${isActive ? 'active-fee' : ''}`}>
                                                        {displayCost}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className="phone-cell">
                                                        {session.phone || '—'}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className="phone-cell">
                                                        {session.started_at ? formatDate(session.started_at) : '—'}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            <div className="last-updated">
                                Auto-refreshes every 10s · Last updated: {lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}
                            </div>
                        </>
                    )}
                </div>
            </main>
        </>
    );
}
