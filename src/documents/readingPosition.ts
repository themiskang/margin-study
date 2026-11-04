export interface ReadingPosition { section?: string; sectionOffset?: number; block?: number; blockOffset?: number; ratio: number; }

/** Keeps the last usable viewport when the host hides or detaches a reader. */
export class ReadingPositionTracker {
  private scroll: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;
  private pending: ReadingPosition | null = null;
  private last: ReadingPosition = { ratio: 0 };
  private ready = false;
  private width = 0;

  connect(scroll: HTMLElement, body: HTMLElement): void {
    this.disconnect(); this.scroll = scroll; this.body = body; this.ready = false;
    scroll.addEventListener("scroll", this.record, { passive: true });
    this.width = scroll.clientWidth;
    this.observer = new ResizeObserver(() => {
      if(this.scroll&&this.width!==this.scroll.clientWidth){
        if(this.ready&&!this.pending)this.pending={...this.last};
        this.width=this.scroll.clientWidth;
      }
      this.apply();
    });
    this.observer.observe(scroll);
  }
  disconnect(): void {
    this.scroll?.removeEventListener("scroll", this.record);
    this.observer?.disconnect(); this.observer = null; this.scroll = null; this.body = null; this.ready = false;
  }
  set(value: unknown): void {
    const position = value as Partial<ReadingPosition> | null;
    this.pending = position && typeof position.ratio === "number" && Number.isFinite(position.ratio) ? {
      ratio: Math.max(0, Math.min(1, position.ratio)),
      section: typeof position.section === "string" ? position.section : undefined,
      sectionOffset: typeof position.sectionOffset === "number" && Number.isFinite(position.sectionOffset) ? position.sectionOffset : undefined,
      block: typeof position.block === "number" && Number.isInteger(position.block) && position.block>=0 ? position.block : undefined,
      blockOffset: typeof position.blockOffset === "number" && Number.isFinite(position.blockOffset) ? position.blockOffset : undefined,
    } : null;
    this.last = this.pending ? { ...this.pending } : { ratio: 0 };
  }
  get(): ReadingPosition {
    if (this.pending) return { ...this.pending };
    const scroll = this.scroll;
    if (this.ready && this.measurable() && scroll && scroll.clientWidth===this.width) {
      const top = scroll.getBoundingClientRect().top, sections = this.sections();
      const section = [...sections].reverse().find(node => node.getBoundingClientRect().top <= top + 30) ?? sections[0];
      const blocks=this.blocks(),block=[...blocks].reverse().find(node=>node.getBoundingClientRect().top<=top+5)??blocks[0];
      this.last = {
        ratio: scroll.scrollTop / Math.max(1, scroll.scrollHeight - scroll.clientHeight),
        section: section?.dataset.msSection,
        sectionOffset: section ? (top - section.getBoundingClientRect().top) / Math.max(1, section.getBoundingClientRect().height) : undefined,
        block:block?blocks.indexOf(block):undefined,
        blockOffset:block?(top-block.getBoundingClientRect().top)/Math.max(1,block.getBoundingClientRect().height):undefined,
      };
    }
    return { ...this.last };
  }
  beginDocument(): void {
    this.ready = false; this.last = this.pending ? { ...this.pending } : { ratio: 0 };
    if (this.scroll) this.scroll.scrollTop = 0;
  }
  restore(): void { this.width=this.scroll?.clientWidth??0;this.ready = true; this.apply();this.get(); }
  prepareNavigation(): void { this.width=this.scroll?.clientWidth??0;this.pending=null; }
  private sections(): HTMLElement[] { return Array.from(this.body?.querySelectorAll<HTMLElement>("[data-ms-section]") ?? []); }
  private blocks(): HTMLElement[] { return Array.from(this.body?.querySelectorAll<HTMLElement>("p,h1,h2,h3,h4,h5,h6,li,pre,blockquote")??[]).filter(node=>!node.closest('[data-ann-id],.ms-free-overlay')&&node.getBoundingClientRect().height>0); }
  private measurable(): boolean {
    return !!this.scroll?.isConnected && this.scroll.clientWidth > 0 && this.scroll.clientHeight > 0
      && /^(auto|scroll|overlay)$/.test(getComputedStyle(this.scroll).overflowY) && !!this.body?.getBoundingClientRect().height;
  }
  private record = (): void => { this.get(); };
  private apply(): void {
    if (!this.ready || !this.pending || !this.measurable() || !this.scroll) return;
    const position = this.pending, section = this.sections().find(node => node.dataset.msSection === position.section);
    const block=position.block!==undefined?this.blocks()[position.block]:undefined;
    if(block&&position.blockOffset!==undefined)this.scroll.scrollTop+=block.getBoundingClientRect().top-this.scroll.getBoundingClientRect().top+position.blockOffset*block.getBoundingClientRect().height;
    else if (section && position.sectionOffset !== undefined) this.scroll.scrollTop += section.getBoundingClientRect().top - this.scroll.getBoundingClientRect().top + position.sectionOffset * section.getBoundingClientRect().height;
    else this.scroll.scrollTop = position.ratio * Math.max(0, this.scroll.scrollHeight - this.scroll.clientHeight);
    this.pending = null; this.get();
  }
}
