/** A peek only changes the view; card text and stored occlusion flags stay intact. */
export function revealAt(revealed: Set<string>, id: string, singlePeek: boolean): void {
  if (singlePeek) revealed.clear();
  revealed.add(id);
}

/** Work on rendered emphasis so code and ordinary asterisks are never treated as answers. */
export function maskEmphasis(container: HTMLElement, onReveal: (index: number) => void, preserveLayout = false, revealed?: ReadonlySet<number>): void {
  const elements = [...container.querySelectorAll<HTMLElement>("strong, mark")];
  let index = 0;
  for (const element of elements) {
    if (element.closest("code, pre") || element.parentElement?.closest("strong, mark")) continue;
    const current = index++;
    if (revealed?.has(current)) continue;
    const button = document.createElement("button");
    button.className = "ms-cloze";
    button.textContent = "•••";
    button.type = "button";
    button.setAttribute("aria-label", "揭晓强调内容");
    button.addEventListener("click", (event) => { event.stopPropagation(); onReveal(current); });
    if (preserveLayout) {
      const wrapper = document.createElement("span");
      wrapper.style.position = "relative";
      wrapper.style.display = "inline";
      element.replaceWith(wrapper);
      element.style.visibility = "hidden";
      element.setAttribute("aria-hidden", "true");
      Object.assign(button.style, { position: "absolute", inset: "0", width: "100%", height: "100%", padding: "0" });
      wrapper.append(element, button);
    } else element.replaceWith(button);
  }
}
