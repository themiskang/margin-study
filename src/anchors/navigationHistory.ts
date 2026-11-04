/** View-local navigation history. The stack never mutates document data. */
export class NavigationHistory<T> {
  private previous: T[] = [];
  private next: T[] = [];
  constructor(private same: (first: T, second: T) => boolean, private limit = 100) {}
  get canBack(): boolean { return this.previous.length > 0; }
  get canForward(): boolean { return this.next.length > 0; }
  clear(): void { this.previous = []; this.next = []; }
  record(current: T): void {
    if (!this.previous.length || !this.same(this.previous[this.previous.length - 1], current)) this.push(this.previous, current);
    this.next = [];
  }
  back(current: T): T | null { return this.move(this.previous, this.next, current); }
  forward(current: T): T | null { return this.move(this.next, this.previous, current); }
  private move(from: T[], to: T[], current: T): T | null {
    while (from.length && this.same(from[from.length - 1], current)) from.pop();
    const destination = from.pop();
    if (destination === undefined) return null;
    this.push(to, current); return destination;
  }
  private push(stack: T[], location: T): void {
    if (!stack.length || !this.same(stack[stack.length - 1], location)) stack.push(location);
    if (stack.length > this.limit) stack.splice(0, stack.length - this.limit);
  }
}
