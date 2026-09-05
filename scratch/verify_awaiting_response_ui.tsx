import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CaseDetail } from '../frontend/src/components/CaseDetail';

const BASE_URL = 'http://127.0.0.1:8000';

async function fetchJSON(path: string, options?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, options);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HTTP ${res.status}: ${err}`);
  }
  return res.json();
}

async function runVerification() {
  console.log('='.repeat(70));
  console.log('VERIFYING AWAITING RESPONSE UI/UX STATE & CTA DECISION MODEL');
  console.log('='.repeat(70));

  // 1. Reset demo
  console.log('\n1. Resetting demo to clean baseline...');
  await fetchJSON('/api/demo/reset', { method: 'POST' });

  // 2. Fetch DEMO-A-AUTO
  const cases = await fetchJSON('/api/cases?limit=1000');
  const demoA = cases.find((c: any) => c.case_number === 'DEMO-A-AUTO');
  const caseId = demoA.id;

  // 3. Track link click (Attempt 1 -> LINK_CLICKED)
  console.log('\n2. Tracking customer link click (Attempt 1 -> LINK_CLICKED)...');
  await fetchJSON(`/api/cases/${caseId}/track-click`, { method: 'POST' });

  // Check UI state after click (Next Action: RETRY_SAME_CHANNEL)
  {
    const caseA = await fetchJSON(`/api/cases/${caseId}`);
    const expA = await fetchJSON(`/api/cases/${caseId}/explanation`);
    const auditA = await fetchJSON(`/api/cases/${caseId}/audit`);

    const html = renderToStaticMarkup(
      React.createElement(CaseDetail, {
        selected: caseA,
        explanation: expA,
        audit: auditA,
        execution: null,
        detailLoading: false,
        actionLoading: null,
        analyze: async () => {},
        execute: async () => {},
        setNotice: () => {},
      })
    );

    console.log('\nChecking UI when Next Action is RETRY_SAME_CHANNEL:');
    const hasRetryButton = html.includes('Simulate Next Recovery Step');
    console.log(`- 'Simulate Next Recovery Step' button present: ${hasRetryButton}`);
    if (!hasRetryButton) {
      throw new Error("Expected 'Simulate Next Recovery Step' button when next_action is RETRY_SAME_CHANNEL");
    }
  }

  // 4. Simulate Next Recovery Step (Attempt 1 -> Attempt 2, AWAIT_RESPONSE)
  console.log('\n3. Triggering Next Recovery Step (Attempt 1 -> Attempt 2, outcome: AWAITING_RESPONSE)...');
  const stepRes = await fetchJSON(`/api/cases/${caseId}/next-step`, { method: 'POST' });
  console.log(`  Step response: action=${stepRes.action}, channel=${stepRes.channel}, attempt=${stepRes.attempt}`);

  // Fetch updated data for Attempt 2
  const case2 = await fetchJSON(`/api/cases/${caseId}`);
  const exp2 = await fetchJSON(`/api/cases/${caseId}/explanation`);
  const audit2 = await fetchJSON(`/api/cases/${caseId}/audit`);

  const followup = exp2.channel_intelligence.followup_decision;
  const journey = exp2.channel_intelligence.communication_journey;

  console.log(`\nAuthoritative backend state:`);
  console.log(`- Status: ${case2.status}`);
  console.log(`- Retry count: ${case2.retry_count} of ${case2.max_retries}`);
  console.log(`- Journey attempts: ${journey.length}`);
  console.log(`- Attempt 1: ${journey[0].channel} -> ${journey[0].outcome}`);
  console.log(`- Attempt 2: ${journey[1].channel} -> ${journey[1].outcome}`);
  console.log(`- Follow-up next action: ${followup.next_action}`);
  console.log(`- Follow-up wait: ${followup.recommended_wait_period}`);

  // Render CaseDetail to HTML
  const html2 = renderToStaticMarkup(
    React.createElement(CaseDetail, {
      selected: case2,
      explanation: exp2,
      audit: audit2,
      execution: null,
      detailLoading: false,
      actionLoading: null,
      analyze: async () => {},
      execute: async () => {},
      setNotice: () => {},
    })
  );

  console.log('\nVerifying Observation Period Active UI (Requirement 8):');

  // Check 1: Observation Period Active title
  const hasObsTitle = html2.includes('Observation Period Active');
  console.log(`1. 'Observation Period Active' visible: ${hasObsTitle}`);
  if (!hasObsTitle) throw new Error("Missing 'Observation Period Active' title in rendered HTML");

  // Check 2: Dynamic message
  const expectedMsg = 'WhatsApp reminder was sent successfully. RecoverAI is waiting for customer activity during the recommended observation period before deciding whether another recovery attempt is necessary.';
  const hasExpectedMsg = html2.includes(expectedMsg);
  console.log(`2. Main message with dynamic channel visible: ${hasExpectedMsg}`);
  if (!hasExpectedMsg) throw new Error(`Missing expected message: ${expectedMsg}`);

  // Check 3: Recommended wait ("24 hours")
  const hasWait = html2.includes('24 hours');
  console.log(`3. Recommended wait '24 hours' visible: ${hasWait}`);
  if (!hasWait) throw new Error("Missing '24 hours' wait in rendered HTML");

  // Check 4: Remaining attempts ("1 communication attempt remains")
  const hasRemaining = html2.includes('1 communication attempt remains');
  console.log(`4. Remaining attempts '1 communication attempt remains' visible: ${hasRemaining}`);
  if (!hasRemaining) throw new Error("Missing '1 communication attempt remains' in rendered HTML");

  // Check 5: Current status ("Awaiting Customer Response")
  const hasStatus = html2.includes('Awaiting Customer Response');
  console.log(`5. Current status 'Awaiting Customer Response' visible: ${hasStatus}`);
  if (!hasStatus) throw new Error("Missing 'Awaiting Customer Response' in rendered HTML");

  // Check 6: NO "Check Recovery Status" button
  const hasCheckButton = html2.includes('Check Recovery Status');
  console.log(`6. 'Check Recovery Status' button NOT present: ${!hasCheckButton}`);
  if (hasCheckButton) throw new Error("Found prohibited 'Check Recovery Status' button in rendered HTML!");

  // Check 7: NO "Simulate Next Recovery Step" button in observation state
  const hasSimulateButton = html2.includes('Simulate Next Recovery Step');
  console.log(`7. 'Simulate Next Recovery Step' button NOT present: ${!hasSimulateButton}`);
  if (hasSimulateButton) throw new Error("Found prohibited 'Simulate Next Recovery Step' button in observation state!");

  // Check 8: No misleading clickable CTA inside the Follow-up card
  const fdCardMatch = html2.match(/followup-intelligence-card[\s\S]*?(?=ai-advisor-card|payment-recovery-card|<\/div>\s*<\/div>\s*<\/div>)/);
  if (fdCardMatch) {
    const fdHtml = fdCardMatch[0];
    const hasAnyButton = fdHtml.includes('<button');
    console.log(`8. Zero buttons inside Follow-Up Decision card during observation: ${!hasAnyButton}`);
    if (hasAnyButton) throw new Error("Found unexpected <button> in Follow-Up Decision card during active observation!");
  }

  // 5. Test Channel Switch Scenario (Unengaged case -> SMS)
  console.log('\n4. Testing Channel Switch Scenario (Unengaged case -> SWITCH_CHANNEL)...');
  await fetchJSON('/api/demo/reset', { method: 'POST' });
  const cases2 = await fetchJSON('/api/cases?limit=1000');
  const demoA2 = cases2.find((c: any) => c.case_number === 'DEMO-A-AUTO');

  // Case initially has attempt 1 WhatsApp delivered with no click -> followup is SWITCH_CHANNEL to SMS
  const caseSwitch = await fetchJSON(`/api/cases/${demoA2.id}`);
  const expSwitch = await fetchJSON(`/api/cases/${demoA2.id}/explanation`);
  const auditSwitch = await fetchJSON(`/api/cases/${demoA2.id}/audit`);

  const htmlSwitch = renderToStaticMarkup(
    React.createElement(CaseDetail, {
      selected: caseSwitch,
      explanation: expSwitch,
      audit: auditSwitch,
      execution: null,
      detailLoading: false,
      actionLoading: null,
      analyze: async () => {},
      execute: async () => {},
      setNotice: () => {},
    })
  );

  const hasSwitchButton = htmlSwitch.includes('Simulate Channel Switch');
  console.log(`- 'Simulate Channel Switch' button present for SWITCH_CHANNEL: ${hasSwitchButton}`);
  if (!hasSwitchButton) throw new Error("Expected 'Simulate Channel Switch' button when next_action is SWITCH_CHANNEL");

  // 6. Test Terminal Case Scenario (Recovered -> No CTA)
  console.log('\n5. Testing Terminal Case Scenario (Payment Captured -> No CTA)...');
  const demoB = cases2.find((c: any) => c.case_number === 'DEMO-B-HUMAN' || c.status === 'recovered');
  if (demoB) {
    const caseRecovered = { ...demoA2, status: 'recovered' };
    const htmlRecovered = renderToStaticMarkup(
      React.createElement(CaseDetail, {
        selected: caseRecovered,
        explanation: expSwitch,
        audit: auditSwitch,
        execution: null,
        detailLoading: false,
        actionLoading: null,
        analyze: async () => {},
        execute: async () => {},
        setNotice: () => {},
      })
    );
    const hasRecoveredButton = htmlRecovered.includes('Simulate Next Recovery Step') || htmlRecovered.includes('Simulate Channel Switch') || htmlRecovered.includes('Observation Period Active');
    console.log(`- Terminal case has no recovery CTA or observation panel: ${!hasRecoveredButton}`);
    if (hasRecoveredButton) throw new Error("Terminal case should not render recovery CTA or observation panel");
  }

  // 7. Reset demo
  await fetchJSON('/api/demo/reset', { method: 'POST' });
  console.log('\n' + '='.repeat(70));
  console.log('>>> ALL AWAITING RESPONSE UI/UX VERIFICATIONS PASSED PERFECTLY! <<<');
  console.log('='.repeat(70));
}

runVerification().catch(err => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
