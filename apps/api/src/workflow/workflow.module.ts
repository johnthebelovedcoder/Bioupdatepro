import { Global, Module } from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import { WorkflowRoutingService } from './workflow-routing.service';
import { DelegationService } from './delegation.service';
import { NotificationService } from './notification.service';
import { EscalationService } from './escalation.service';
import { GlPostingHandler } from './gl-posting.handler';
import { WORKFLOW_POSTING_HANDLERS } from './workflow.types';

/**
 * Rule 5: ONE workflow engine, available everywhere.
 *
 * Global for the same reason CoreModule is — a module that could construct its
 * own approval engine eventually would, and then there would be two sets of
 * approval rules to keep in step.
 *
 * Posting handlers are collected through a single injection token, so a module
 * adds its own by extending that array rather than by touching this file or the
 * engine.
 */
@Global()
@Module({
  providers: [
    WorkflowRoutingService,
    DelegationService,
    NotificationService,
    EscalationService,
    GlPostingHandler,
    {
      provide: WORKFLOW_POSTING_HANDLERS,
      useFactory: (gl: GlPostingHandler) => [gl],
      inject: [GlPostingHandler],
    },
    WorkflowService,
  ],
  exports: [
    WorkflowService,
    WorkflowRoutingService,
    DelegationService,
    NotificationService,
    EscalationService,
  ],
})
export class WorkflowModule {}
