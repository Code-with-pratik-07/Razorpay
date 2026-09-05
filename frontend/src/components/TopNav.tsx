import React from 'react';

interface TopNavProps {
  demoMode: boolean;
}

export function TopNav({ demoMode }: TopNavProps) {
  return (
    <header className="topnav">
      <div className="topnav-left">
        <div className="logo">
          <div className="logo-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 21h5v-5" />
            </svg>
          </div>
          <div className="logo-text">
            <b>RecoverAI</b>
          </div>
        </div>
        <nav className="topnav-links">
          <a className="active" href="#overview">Overview</a>
          <a href="#recovery-queue">Recovery Queue</a>
        </nav>
      </div>

      <div className="topnav-right">
        {demoMode && (
          <div className="demo-badge">
            <strong>DEMO MODE</strong> · Razorpay Test Environment
          </div>
        )}
        <div className="system-status">
          <span className="status-dot" /> Operational
        </div>
      </div>
    </header>
  );
}
