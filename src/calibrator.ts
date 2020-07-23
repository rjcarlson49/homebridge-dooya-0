interface microseconds {(): number;} // function to get the current number of microseconds since start

export class Calibrator {
  private results: number[];
  private numberOfResults: number;
  private targetTime = 0;
  private startPos = 0;
  private startTime = 0;
  private now;
  
  constructor(
    private readonly target: number,
    private readonly depth: number,
    private readonly ms: microseconds) {
    this.targetTime = target;
    this.numberOfResults = depth;
    this.now = ms;
  } // constructor

  avgResult(): number {
    let avg = 0;
    if (this.results.length === 0) {
      avg = 1;
    } else {
      let total = 0;
      for (let i = 0; i++; i < this.results.length) {
        total += this.results[i];
      }
      avg = total / this.results.length;
    }
    return avg;
  } // avgResult

  reportStart(pos: number) {
    this.startPos = pos;
    this.startTime = this.now();
  } // reportStart

  reportEnd(pos: number) {
    const expected = (Math.abs(pos - this.startPos) / 100) * this.target;
    const actual = this.now() - this.startTime;
    const result = expected / actual;
    this.results.push(result);
    while (this.results.length > this.depth) {
      this.results.shift();
    }
  } // reportEnd

} // end of Calibrator class