import React from 'react';

export function HowItWorks() {
  return (
    <div className="how-it-works-panel">
      <h4>HOW RECOVERAI WORKS</h4>
      <div className="stepper-horizontal">
        <div className="step">
          <div className="step-icon">1</div>
          <div className="step-content">
            <b>Payment Failure</b>
            <small>Failed payment detected via webhook.</small>
          </div>
        </div>
        <div className="step-arrow">→</div>
        <div className="step">
          <div className="step-icon">2</div>
          <div className="step-content">
            <b>ML Prediction</b>
            <small>Predicts likelihood of successful recovery.</small>
          </div>
        </div>
        <div className="step-arrow">→</div>
        <div className="step">
          <div className="step-icon">3</div>
          <div className="step-content">
            <b>Policy Engine</b>
            <small>Applies deterministic business rules.</small>
          </div>
        </div>
        <div className="step-arrow">→</div>
        <div className="step">
          <div className="step-icon">4</div>
          <div className="step-content">
            <b>AI Advisor</b>
            <small>Provides explainable recommendation.</small>
          </div>
        </div>
        <div className="step-arrow">→</div>
        <div className="step">
          <div className="step-icon">5</div>
          <div className="step-content">
            <b>Automatic Recovery</b>
            <small>Executes when policy authorizes action.</small>
          </div>
        </div>
        <div className="step-arrow">→</div>
        <div className="step">
          <div className="step-icon">6</div>
          <div className="step-content">
            <b>Recovered</b>
            <small>Customer payment completes successfully.</small>
          </div>
        </div>
      </div>
    </div>
  );
}
