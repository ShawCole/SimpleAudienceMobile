/**
 * State Machine for Audience Creation Workflow
 * Manages the deterministic flow of audience creation
 */

import logger from '../utils/logger';
import { AudienceStatus } from '../../../shared/types';

export type AudienceState =
  | 'idle'
  | 'building_filters'
  | 'setting_location'
  | 'setting_intent'
  | 'previewing'
  | 'ready_to_generate'
  | 'generating'
  | 'monitoring_status'
  | 'completed'
  | 'failed';

export interface StateTransition {
  from: AudienceState;
  to: AudienceState;
  action: string;
}

export interface StateMachineContext {
  audienceId?: string;
  currentStep?: string;
  error?: string;
  retryCount: number;
  metadata?: Record<string, any>;
}

export class AudienceStateMachine {
  private currentState: AudienceState = 'idle';
  private context: StateMachineContext = {
    retryCount: 0,
  };
  private transitions: StateTransition[] = [];
  private maxRetries = 3;

  constructor(initialState: AudienceState = 'idle') {
    this.currentState = initialState;
  }

  /**
   * Get the current state
   */
  getState(): AudienceState {
    return this.currentState;
  }

  /**
   * Get the context
   */
  getContext(): StateMachineContext {
    return this.context;
  }

  /**
   * Update context
   */
  updateContext(updates: Partial<StateMachineContext>): void {
    this.context = { ...this.context, ...updates };
    logger.debug('State machine context updated', this.context);
  }

  /**
   * Transition to a new state
   */
  transition(
    newState: AudienceState,
    action: string,
    contextUpdates?: Partial<StateMachineContext>
  ): void {
    const transition: StateTransition = {
      from: this.currentState,
      to: newState,
      action,
    };

    this.transitions.push(transition);

    logger.info(`State transition: ${this.currentState} -> ${newState} (${action})`);

    this.currentState = newState;

    if (contextUpdates) {
      this.updateContext(contextUpdates);
    }
  }

  /**
   * Check if we can transition to a specific state
   */
  canTransitionTo(targetState: AudienceState): boolean {
    const validTransitions: Record<AudienceState, AudienceState[]> = {
      idle: ['building_filters'],
      building_filters: ['setting_location', 'setting_intent', 'previewing'],
      setting_location: ['building_filters', 'setting_intent', 'previewing'],
      setting_intent: ['building_filters', 'previewing'],
      previewing: ['ready_to_generate', 'building_filters', 'failed'],
      ready_to_generate: ['generating', 'building_filters'],
      generating: ['monitoring_status', 'failed'],
      monitoring_status: ['completed', 'failed', 'monitoring_status'],
      completed: ['idle'],
      failed: ['idle', 'building_filters'],
    };

    return validTransitions[this.currentState]?.includes(targetState) || false;
  }

  /**
   * Safely transition with validation
   */
  safeTransition(
    newState: AudienceState,
    action: string,
    contextUpdates?: Partial<StateMachineContext>
  ): boolean {
    if (!this.canTransitionTo(newState)) {
      logger.warn(
        `Invalid state transition: ${this.currentState} -> ${newState}`
      );
      return false;
    }

    this.transition(newState, action, contextUpdates);
    return true;
  }

  /**
   * Handle an error and potentially retry
   */
  handleError(error: Error | string): void {
    const errorMessage = error instanceof Error ? error.message : error;

    logger.error(`State machine error in state ${this.currentState}:`, errorMessage);

    this.updateContext({
      error: errorMessage,
      retryCount: this.context.retryCount + 1,
    });

    if (this.context.retryCount >= this.maxRetries) {
      this.transition('failed', 'max_retries_exceeded', {
        error: `Failed after ${this.maxRetries} retries: ${errorMessage}`,
      });
    }
  }

  /**
   * Reset the state machine
   */
  reset(): void {
    this.currentState = 'idle';
    this.context = { retryCount: 0 };
    this.transitions = [];
    logger.info('State machine reset');
  }

  /**
   * Get state machine history
   */
  getHistory(): StateTransition[] {
    return [...this.transitions];
  }

  /**
   * Check if the state machine is in a terminal state
   */
  isTerminal(): boolean {
    return this.currentState === 'completed' || this.currentState === 'failed';
  }

  /**
   * Get a summary of the current state
   */
  getSummary(): {
    state: AudienceState;
    context: StateMachineContext;
    historyLength: number;
    isTerminal: boolean;
  } {
    return {
      state: this.currentState,
      context: this.context,
      historyLength: this.transitions.length,
      isTerminal: this.isTerminal(),
    };
  }
}

export default AudienceStateMachine;
