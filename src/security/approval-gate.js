/**
 * ApprovalGate — wraps ExecApprovals to gate destructive actions.
 * Checks VALUES.md rules and risk level before allowing execution.
 */

import { log } from '../core/logger.js';

export class ApprovalGate {
  constructor(approvals, trustKernel) {
    this.approvals = approvals;
    this.trustKernel = trustKernel;
  }

  async check(agent, action, detail, riskLevel = 'medium') {
    // Low-risk actions pass through
    if (riskLevel === 'low') {
      log.debug(`ApprovalGate: auto-approved low-risk action: ${action}`);
      return { approved: true, auto: true };
    }

    // Trust kernel can block actions outright
    if (this.trustKernel && typeof this.trustKernel.evaluate === 'function') {
      const allowed = await this.trustKernel.evaluate(action, detail);
      if (!allowed) {
        log.warn(`ApprovalGate: Trust Kernel blocked action: ${action}`);
        return { approved: false, reason: 'Blocked by Trust Kernel' };
      }
    }

    // High/critical risk — require human approval
    if (riskLevel === 'high' || riskLevel === 'critical') {
      return this.approvals.request(agent, action, detail, riskLevel);
    }

    // Medium risk — auto-approve but log
    log.info(`ApprovalGate: auto-approved medium-risk action: ${action}`);
    return { approved: true, auto: true };
  }
}
