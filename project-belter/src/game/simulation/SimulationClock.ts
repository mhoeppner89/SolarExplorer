export interface SimulationClockStats {
  steps: number;
  interpolationAlpha: number;
  droppedSeconds: number;
}

export class SimulationClock {
  private accumulatorSeconds = 0;
  private readonly fixedDeltaSeconds: number;
  private readonly maxFrameDeltaSeconds: number;
  private readonly maxStepsPerFrame: number;

  public constructor(
    simulationHz: number,
    maxFrameDeltaMs: number,
    maxStepsPerFrame: number,
  ) {
    this.fixedDeltaSeconds = 1 / simulationHz;
    this.maxFrameDeltaSeconds = maxFrameDeltaMs / 1000;
    this.maxStepsPerFrame = maxStepsPerFrame;
  }

  public advance(realDeltaMs: number, step: (fixedDeltaSeconds: number) => void): SimulationClockStats {
    const clampedDelta = Math.min(Math.max(realDeltaMs, 0), this.maxFrameDeltaSeconds * 1000) / 1000;
    this.accumulatorSeconds += clampedDelta;

    let steps = 0;
    while (this.accumulatorSeconds >= this.fixedDeltaSeconds && steps < this.maxStepsPerFrame) {
      step(this.fixedDeltaSeconds);
      this.accumulatorSeconds -= this.fixedDeltaSeconds;
      steps += 1;
    }

    let droppedSeconds = 0;
    if (this.accumulatorSeconds >= this.fixedDeltaSeconds) {
      droppedSeconds = this.accumulatorSeconds - (this.accumulatorSeconds % this.fixedDeltaSeconds);
      this.accumulatorSeconds %= this.fixedDeltaSeconds;
    }

    return {
      steps,
      interpolationAlpha: this.accumulatorSeconds / this.fixedDeltaSeconds,
      droppedSeconds,
    };
  }

  public reset(): void {
    this.accumulatorSeconds = 0;
  }

  public get fixedStepSeconds(): number {
    return this.fixedDeltaSeconds;
  }
}
