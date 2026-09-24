/** Server-owned approval boundary around a paused LangGraph task.
 * The LLM, request body and task state MUST NOT choose their own approver.
 */
import { review } from './graph.mjs';

const ID = /^[a-zA-Z0-9_-]{1,80}$/;

/**
 * taskRegistry.get(threadId) should return a verified record:
 * { projectId, approverIds: ['alice'], status: 'awaiting_approval' }.
 * The registry and identities must be controlled by your NestJS backend.
 */
export function createApprovalService({ taskRegistry, authorizeProject, auditSink = () => {} }) {
  if (!taskRegistry || typeof taskRegistry.get !== 'function' ||
      typeof authorizeProject !== 'function' || typeof auditSink !== 'function') {
    throw new TypeError('Server-owned task registry, authorization and audit are required');
  }
  return async function approveDelivery(graph, { threadId, approved, actor }) {
    if (typeof threadId !== 'string' || !ID.test(threadId) ||
        typeof approved !== 'boolean' || !actor ||
        typeof actor.userId !== 'string' || !ID.test(actor.userId)) {
      throw new TypeError('Invalid approval request');
    }
    const task = await taskRegistry.get(threadId);
    if (!task || typeof task.projectId !== 'string' ||
        !Array.isArray(task.approverIds) ||
        !task.approverIds.includes(actor.userId) ||
        !(await authorizeProject(actor, task.projectId, 'delivery:approve'))) {
      auditSink({ action: 'delivery.approval', actorId: actor.userId,
        threadId, outcome: 'denied' });
      throw new Error('Approval not permitted');
    }
    if (task.status !== 'awaiting_approval') {
      throw new Error('Task is not awaiting approval');
    }
    // Review only resumes the graph; the delivery adapter must independently
    // enforce Git/CI permissions and idempotency at the resource boundary.
    const result = await review(graph, { threadId, approved });
    auditSink({ action: 'delivery.approval', actorId: actor.userId,
      projectId: task.projectId, threadId,
      outcome: approved ? 'approved' : 'rejected' });
    return result;
  };
}
