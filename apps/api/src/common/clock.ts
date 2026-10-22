/**
 * Time source. Everything time-dependent (expiry, rate-limit windows, token lifetimes)
 * reads the clock instead of `new Date()`, so tests can move time.
 */
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}

export class FakeClock extends Clock {
  private t: number;

  constructor(start: Date = new Date('2026-10-21T08:00:00.000Z')) {
    super();
    this.t = start.getTime();
  }

  now(): Date {
    return new Date(this.t);
  }

  advance(ms: number): void {
    this.t += ms;
  }

  /** Jumps to `date`, also backwards (e.g. to replay test vectors with fixed timestamps). */
  set(date: Date): void {
    this.t = date.getTime();
  }
}
