import React from 'react';

interface TopNavProps {
  demoMode: boolean;
}

export function TopNav({ demoMode }: TopNavProps) {
  return (
    <header className="topnav">
      <div className="topnav-left">
        <div className="logo">
          <div className="logo-icon">R</div>
          <div className="logo-text">
            <b>RecoverAI</b>
            <small>Payment Recovery Intelligence</small>
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
