import React from 'react';

/**
 * Explanatory assumed-claim process stepper. The claim status plus the loss
 * advice, reserve, cash call, recovery, and commutation records already loaded
 * for the workbench decide which milestones are complete; the stepper never
 * gates or performs an action.
 */
const STEPS = [
  { id: 'advice', label: 'Advice', purpose: 'Cedent loss notice captured.' },
  { id: 'validation', label: 'Validation', purpose: 'Advice checked against the contract.' },
  { id: 'reserving', label: 'Reserving', purpose: 'Ceded reserves set and current.' },
  { id: 'cash-call', label: 'Cash Call', purpose: 'Funding requested for the loss.' },
  { id: 'recovery', label: 'Recovery', purpose: 'Recoverables pursued and booked.' },
  { id: 'commutation', label: 'Commutation', purpose: 'Optional negotiated close-out.' },
  { id: 'closed', label: 'Closed', purpose: 'Record closed and archived.' }
];

/** First unfinished milestone implied by the current claim status. */
const STATUS_FRONTIER = {
  NOTIFIED: 0,
  OPEN: 1,
  RESERVED: 3,
  IN_ADJUSTMENT: 3,
  DISPUTED: 3,
  SETTLED: 4,
  PAYMENT_PENDING: 4,
  PAID: 5,
  COMMUTED: 6,
  CLOSED: 7,
  DENIED: 1,
  WITHDRAWN: 6,
  REOPENED: 1
};

const VALIDATED_ADVICE_STATUSES = ['VALIDATED', 'POSTED'];
const COMPLETED_CASH_CALL_STATUSES = ['APPROVED', 'PAID'];
const ENDED_STATUSES = ['WITHDRAWN'];

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function asRecord(value) {
  return value && !Array.isArray(value) ? value : null;
}

function upper(value) {
  return String(value || '').toUpperCase();
}

function stateText(step) {
  if (step.state === 'denied') return 'Denied';
  if (step.complete) return 'Completed';
  if (step.state === 'current') return 'Current step';
  return 'Upcoming';
}

/**
 * Builds the seven-step model from the claim status and the workbench resource
 * collections. Record evidence can advance the frontier past a status that has
 * not been updated yet (for example a posted advice on a notified claim).
 */
export function buildAssumedProgress(claim, resources = {}) {
  const status = upper(claim?.status) || 'NOTIFIED';
  const advices = asList(resources.advices);
  const reserves = asList(resources.reserves);
  const cashCalls = asList(resources.cashCalls);
  const recoveries = asList(resources.recoveries);
  const commutation = asRecord(resources.commutation);
  const financials = asRecord(resources.financials);

  const validationDenied = status === 'DENIED';
  const closed = status === 'CLOSED';
  const ended = ENDED_STATUSES.includes(status);

  let frontier = STATUS_FRONTIER[status] ?? 0;

  if (!closed && !validationDenied && !ended) {
    if (advices.length > 0) {
      const allValidated = advices.every((advice) =>
        VALIDATED_ADVICE_STATUSES.includes(upper(advice.status)));
      frontier = Math.max(frontier, allValidated ? 2 : 1);
    }
    if (financials && (financials.lastAdviceAt || Number(financials.advisedLossAmount) > 0)) {
      frontier = Math.max(frontier, 1);
    }

    if (reserves.length > 0 || Number(financials?.cededReserveAmount) > 0) {
      frontier = Math.max(frontier, 3);
    }

    const cashCallStatuses = cashCalls.map((call) => upper(call.status));
    if (cashCallStatuses.some((value) => COMPLETED_CASH_CALL_STATUSES.includes(value))) {
      frontier = Math.max(frontier, 4);
    } else if (cashCalls.length > 0 || Number(financials?.cashCallAmount) > 0) {
      frontier = Math.max(frontier, 3);
    }

    if (recoveries.some((recovery) => upper(recovery.status) === 'RECEIVED')) {
      frontier = Math.max(frontier, 5);
    } else if (recoveries.length > 0) {
      frontier = Math.max(frontier, 4);
    }
    if (Number(financials?.cededRecoveryAmount) > 0) {
      frontier = Math.max(frontier, 5);
    }

    if (commutation) {
      frontier = Math.max(
        frontier,
        upper(commutation.status) === 'EXECUTED' ? 6 : 5
      );
    }
  }

  if (validationDenied) frontier = 1;
  if (ended) frontier = 6;
  if (closed) frontier = STEPS.length;

  const last = STEPS.length - 1;
  const currentIndex = closed ? last : Math.min(frontier, last);

  const steps = STEPS.map((step, index) => {
    let state;
    let complete = closed ? true : index < frontier;

    if (index === 1 && validationDenied) {
      state = 'denied';
      complete = false;
    } else if (closed) {
      state = index === last ? 'current' : 'completed';
    } else if (index < frontier) {
      state = 'completed';
    } else if (index === currentIndex) {
      state = 'current';
    } else {
      state = 'upcoming';
    }

    return {
      ...step,
      state,
      complete,
      current: index === currentIndex && !(validationDenied && index !== 1)
    };
  });

  const current = steps[currentIndex];
  let next;

  if (closed) {
    next = 'The claim is closed; the audit trail and ceded financial summary remain available.';
  } else if (validationDenied) {
    next = 'The claim is denied; the record can be closed with the denial retained in the audit trail.';
  } else if (ended) {
    next = 'The cedent has withdrawn the claim; close the record to retire it from active handling.';
  } else if (current.id === 'advice') {
    next = 'Record the cedent loss advice with reported and outstanding amounts; validation follows.';
  } else if (current.id === 'validation') {
    next = 'Validate the advice against the assumed contract, then post it to drive reserving and cash calls.';
  } else if (current.id === 'reserving') {
    next = 'Set ceded case, IBNR, and expense reserves from the validated advice.';
  } else if (current.id === 'cash-call') {
    next = 'Request the cash call that funds the cedent’s reported loss; approved calls release funding.';
  } else if (current.id === 'recovery') {
    next = 'Pursue retrocession, salvage, or other recoveries and record each receipt against the claim.';
  } else if (current.id === 'commutation') {
    if (commutation && upper(commutation.status) === 'EXECUTED') {
      next = 'The commutation is executed; close the claim when the release is confirmed.';
    } else if (commutation) {
      next = 'Approve and execute the commutation, then close the claim on its effective date.';
    } else {
      next = 'Commutation is optional: propose a negotiated close-out, or close the claim through the normal settlement path.';
    }
  } else if (commutation && upper(commutation.status) === 'EXECUTED') {
    next = 'The commutation is executed; close the claim when the release is confirmed.';
  } else if (commutation) {
    next = 'The commutation is in progress; close the claim once it is executed.';
  } else {
    next = 'Close the claim once the recovery position and any commutation are settled.';
  }

  return {
    steps,
    currentIndex,
    next,
    stageLabel: `${current.label} · step ${currentIndex + 1} of ${STEPS.length}`
  };
}

export default function ClaimProgress({ claim, resources }) {
  const model = buildAssumedProgress(claim, resources);

  return (
    <section className="eia-process" aria-label="Claim progress" data-testid="claim-progress">
      <div className="eia-process-head">
        <h3 className="eia-process-title">Claim progress</h3>
        <span className="eia-process-stage" data-testid="process-stage">{model.stageLabel}</span>
      </div>
      <ol
        className="eia-process-track"
        aria-label="Claim process steps"
        style={{ '--eia-process-steps': model.steps.length }}
      >
        {model.steps.map((step, index) => (
          <li
            key={step.id}
            className="eia-process-step"
            data-testid={`process-step-${step.id}`}
            data-state={step.state}
            data-complete={step.complete ? 'true' : 'false'}
            data-current={step.current ? 'true' : 'false'}
            aria-current={step.current ? 'step' : undefined}
          >
            <span className="eia-process-marker" aria-hidden="true">
              {step.state === 'denied' ? '✕' : step.complete ? '✓' : index + 1}
            </span>
            <span className="eia-process-copy">
              <span className="eia-visually-hidden">{stateText(step)}. </span>
              <span className="eia-process-label">{step.label}</span>
              <span className="eia-process-purpose">{step.purpose}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="eia-process-next" data-testid="process-next">
        <b>What happens next:</b>
        <span>{model.next}</span>
      </p>
    </section>
  );
}
