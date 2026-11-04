import { Notice, setIcon } from "obsidian";
import type { ReaderView } from "./readerView";
import { el } from "../utils/dom";
import { openPdfPagePicker } from "./pageImport";
import { isPageImage, PAGE_IMAGE_ACCEPT } from "./imagePages";
import { hasNativePhotoPicker, pickNativePhotos, pickNativeCamera } from "./nativePhotoPicker";

/** Page controls stay over the paper, matching the native page editing workflow. */
export function openPdfPageEditor(reader: ReaderView): () => void {
  const scroll = reader.getScrollContainer(), path = reader.getFilePath(), mode = reader.getHandwritingMode();
  let closed = false, busy = false, closePicker: (() => void) | null = null;
  let disposeMenu: (() => void) | null = null;
  let nativeImageRequest: AbortController | null = null;
  const closeMenu = () => { disposeMenu?.(); disposeMenu = null; };
  const input = el("input",{type:"file",accept:`.pdf,application/pdf,${PAGE_IMAGE_ACCEPT}`,"aria-label":"Choose PDF Pages File",class:"ms-pdf-import-input"}); input.hidden = true; scroll.append(input);
  const photosInput = el("input",{type:"file",accept:PAGE_IMAGE_ACCEPT,"aria-label":"Choose Photo Pages Files",class:"ms-pdf-import-input"}); photosInput.hidden = true; photosInput.multiple = true; scroll.append(photosInput);
  let importAfterPage = 1;
  let closeCamera: (() => void) | null = null;
  const insertImages = async (files: File[]) => {
    if (closed || busy || !files.length) return;
    busy = true; scroll.querySelectorAll<HTMLButtonElement>(".ms-pdf-page-editor button").forEach(node=>node.disabled=true);
    try { await reader.insertImagePages(importAfterPage,files); }
    catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
    finally { busy = false; render(); }
  };
  photosInput.addEventListener("change",()=>{const files=[...photosInput.files??[]];photosInput.value="";void insertImages(files);});
  const openCameraCapture = (capture: (file: File) => void) => {
    const overlay = el("div", { class: "ms-pdf-camera-bg", role: "dialog", "aria-label": "Camera Capture" });
    const dialog = el("div", { class: "ms-pdf-camera-dialog" });
    const title = el("div", { class: "ms-pdf-camera-title", text: "Take Photo" });
    const video = el("video", { class: "ms-pdf-camera-video" });
    video.autoplay = true; video.muted = true; video.playsInline = true;
    const deviceSelect = el("select", { class: "ms-pdf-camera-device", "aria-label": "Camera Device" });
    const status = el("div", { class: "ms-pdf-camera-status", text: "Starting camera..." });
    const cancel = el("button", { text: "Cancel", "aria-label": "Cancel Camera" });
    const shot = el("button", { text: "Capture", "aria-label": "Capture Page", class: "mod-cta" });
    shot.disabled = true;
    const actions = el("div", { class: "ms-pdf-camera-actions" }, [cancel, shot]);
    dialog.append(title, video, deviceSelect, status, actions);
    overlay.append(dialog);
    document.body.append(overlay);
    let stream: MediaStream | null = null;
    let done = false;
    let cameraRevision = 0;
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); dispose(); } };
    const dispose = () => {
      if (done) return;
      done = true; cameraRevision++;
      stream?.getTracks().forEach(track => track.stop());
      stream = null;
      video.pause(); video.srcObject = null;
      document.removeEventListener("keydown", key);
      overlay.remove();
      if (closeCamera === dispose) closeCamera = null;
    };
    const fail = (message: string) => {
      status.textContent = message;
      new Notice(message);
      dispose();
    };
    const listDevices = async (revision: number) => {
      try {
        const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === "videoinput");
        if (done || revision !== cameraRevision) return;
        const previous = deviceSelect.value;
        while (deviceSelect.firstChild) deviceSelect.removeChild(deviceSelect.firstChild);
        for (const [index, device] of inputs.entries()) {
          deviceSelect.append(el("option", { value: device.deviceId, text: device.label || `Camera ${index + 1}` }));
        }
        const current = stream?.getVideoTracks()[0]?.getSettings().deviceId || "";
        if (inputs.some(device => device.deviceId === previous)) deviceSelect.value = previous;
        else if (current) deviceSelect.value = current;
      } catch { /* device labels become available after the permission prompt */ }
    };
    const start = async () => {
      const revision = ++cameraRevision;
      shot.disabled = true;
      status.textContent = "Requesting camera access...";
      if (!navigator.mediaDevices?.getUserMedia) {
        fail("This device does not expose a camera to Obsidian.");
        return;
      }
      stream?.getTracks().forEach(track => track.stop());
      stream = null;
      video.pause(); video.srcObject = null;
      try {
        const started = await navigator.mediaDevices.getUserMedia({
          video: deviceSelect.value ? { deviceId: { exact: deviceSelect.value } } : true,
          audio: false
        });
        if (done || revision !== cameraRevision) { started.getTracks().forEach(track=>track.stop()); return; }
        stream = started;
        video.srcObject = stream;
        void listDevices(revision);
        status.textContent = "Starting camera preview...";
        await video.play();
        if (done || revision !== cameraRevision) return;
        shot.disabled = false;
        status.textContent = "Camera ready";
      } catch (error) {
        if (!done && revision === cameraRevision) fail("Unable to open camera: " + (error instanceof Error ? error.message : String(error)));
      }
    };
    document.addEventListener("keydown", key);
    cancel.addEventListener("click", dispose);
    deviceSelect.addEventListener("change", () => { void start(); });
    overlay.addEventListener("pointerdown", event => { if (event.target === overlay) dispose(); });
    shot.addEventListener("click", () => {
      if (done || shot.disabled || !stream?.getVideoTracks().some(track => track.readyState === "live")) return;
      if (!video.videoWidth || !video.videoHeight) {
        status.textContent = "Camera is not ready yet.";
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) {
        fail("Unable to capture the camera frame.");
        return;
      }
      context.drawImage(video, 0, 0);
      canvas.toBlob(blob => {
        canvas.width = 0; canvas.height = 0;
        if (done) return;
        if (!blob) {
          fail("Unable to encode the captured photo.");
          return;
        }
        const file = new File([blob], `camera-page-${Date.now()}.png`, { type: "image/png" });
        dispose();
        capture(file);
      }, "image/png");
    });
    closeCamera = dispose;
    void start();
  };
  input.addEventListener("change",()=>{
    const file = input.files?.[0]; input.value = "";
    if (closed || !file) return; closePicker?.();
    if (isPageImage(file)) { void insertImages([file]); return; }
    closePicker = openPdfPagePicker(reader,importAfterPage,file,async action=>{ if (closed || busy) return; busy = true; try { await action(); } catch (error) { new Notice(error instanceof Error ? error.message : String(error)); } finally { busy = false; render(); } });
  });
  reader.setHandwritingMode("off"); scroll.classList.add("ms-pdf-editing");
  const close = () => {
    if (closed) return; closed = true; scroll.classList.remove("ms-pdf-editing");
    nativeImageRequest?.abort(); closeMenu(); closePicker?.(); closeCamera?.(); input.remove(); photosInput.remove();
    stopPageChanges(); scroll.removeEventListener("dblclick", doubleClick); document.removeEventListener("keydown", key);
    scroll.querySelectorAll(".ms-pdf-page-editor").forEach(node => node.remove());
    if (reader.getFilePath() === path) reader.setHandwritingMode(mode);
  };
  const doubleClick = (event: MouseEvent) => { if (!(event.target as HTMLElement).closest("button,input")) close(); };
  const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !document.querySelector(".ms-pdf-import-bg,.ms-pdf-camera-bg")) { event.preventDefault(); close(); } };
  const render = () => {
    if (closed || reader.getFilePath() !== path) return;
    closeMenu();
    if (!input.isConnected) scroll.append(input);
    if (!photosInput.isConnected) scroll.append(photosInput);
    for (const page of reader.getPageNumbers()) {
      const record = reader.getPageRecord(page); if (!record) continue;
      const sheet = el("div", { class: "ms-pdf-page-editor", "aria-label": `Edit PDF Page ${page}` });
      const actions = el("div", { class: "ms-pdf-page-edit-actions" });
      const action = (label: string, execute: () => Promise<void>, disabled = false) => {
        const button = el("button", { text: label, "aria-label": label }); button.disabled = disabled;
        const run = async () => {
          if (busy || closed) return; busy = true;
          scroll.querySelectorAll<HTMLButtonElement>(".ms-pdf-page-editor button").forEach(node => node.disabled = true);
          try { await execute(); }
          catch (error) { new Notice(String(error instanceof Error ? error.message : error)); }
          finally { busy = false; render(); }
        };
        button.addEventListener("click", event => {
          event.stopPropagation(); if (busy || closed) return;
          if (label !== "Add Page") { void run(); return; }
          closeMenu();
          const menu = el("div", {class:"ms-pdf-add-page-menu",role:"menu","aria-label":"Add Page"});
          const blank = el("button", {text:"Add Blank Page","aria-label":"Add Blank Page",role:"menuitem"});
          const title = el("div",{class:"ms-pdf-add-page-title",text:"Select Page Type"});
          const files = el("button",{text:"Add Page From Files","aria-label":"Add Page From Files",role:"menuitem"});
          files.addEventListener("click",next=>{next.stopPropagation();closeMenu();importAfterPage=page;input.click();});
          const photos = el("button",{text:"Add Page From Photos","aria-label":"Add Page From Photos",role:"menuitem"});
          photos.addEventListener("click",next=>{
            next.stopPropagation(); closeMenu(); importAfterPage=page;
            if (!hasNativePhotoPicker(reader.app)) { photosInput.click(); return; }
            void runNativeImages(pickNativePhotos);
          });
          const runNativeImages = async (pick: typeof pickNativePhotos) => {
            if (busy || closed) return;
            busy = true; nativeImageRequest = new AbortController();
            scroll.querySelectorAll<HTMLButtonElement>(".ms-pdf-page-editor button").forEach(node=>node.disabled=true);
            try {
              const files = await pick(reader.app, nativeImageRequest.signal);
              if (!closed && reader.getFilePath() === path && files.length) await reader.insertImagePages(page, files);
            } catch (error) { if (!closed) new Notice(error instanceof Error ? error.message : String(error)); }
            finally { nativeImageRequest = null; busy = false; render(); }
          };
          const cameraButton = el("button",{text:"Add Page From Camera","aria-label":"Add Page From Camera",role:"menuitem"});
          cameraButton.addEventListener("click",next=>{
            next.stopPropagation();closeMenu();importAfterPage=page;
            if (hasNativePhotoPicker(reader.app)) { void runNativeImages(pickNativeCamera); return; }
            closeCamera?.();openCameraCapture(file=>{if(!closed)void insertImages([file]);});
          });
          blank.addEventListener("click", next => { next.stopPropagation(); closeMenu(); void run(); });
          menu.append(title,blank,files,photos,cameraButton); sheet.append(menu);
          record.wrapper.classList.add("ms-pdf-page-menu-open");
          const place = () => {
            const viewport = scroll.getBoundingClientRect(), paper = sheet.getBoundingClientRect(), anchor = button.getBoundingClientRect();
            const left = Math.max(viewport.left, 0) + 4, right = Math.min(viewport.right, window.innerWidth) - 4;
            const top = Math.max(viewport.top, 0) + 4, bottom = Math.min(viewport.bottom, window.innerHeight) - 4;
            menu.style.maxWidth = `${Math.max(0, right - left)}px`;
            menu.style.maxHeight = `${Math.max(0, bottom - top)}px`;
            const size = menu.getBoundingClientRect();
            const x = Math.max(left, Math.min(anchor.left, right - size.width));
            const above = anchor.top - size.height - 6;
            const y = Math.max(top, Math.min(above >= top ? above : anchor.bottom + 6, bottom - size.height));
            menu.style.left = `${x - paper.left}px`; menu.style.top = `${y - paper.top}px`;
          };
          const outside = (event: PointerEvent) => { if (!menu.contains(event.target as Node) && !button.contains(event.target as Node)) closeMenu(); };
          const resize = new ResizeObserver(place); resize.observe(scroll);
          scroll.addEventListener("scroll", place, { passive: true }); window.addEventListener("resize", place); document.addEventListener("pointerdown", outside);
          disposeMenu = () => { resize.disconnect(); scroll.removeEventListener("scroll", place); window.removeEventListener("resize", place); document.removeEventListener("pointerdown", outside); record.wrapper.classList.remove("ms-pdf-page-menu-open"); menu.remove(); };
          place(); blank.focus({ preventScroll: true });
        }); actions.append(button);
      };
      action("Add Page", () => reader.insertBlankPage(page));
      action("Remove Page", () => reader.removePdfPage(page), page === 1);
      action("Up", () => reader.movePdfPage(page, page - 1), page === 1);
      action("Down", () => reader.movePdfPage(page, page + 1), page === reader.getPageNumbers().length);
      const rotate = el("button", { class: "ms-pdf-page-rotate", "aria-label": "Rotate Page", title: "Rotate Page" }); setIcon(rotate, "rotate-cw");
      rotate.addEventListener("click", async event => {
        event.stopPropagation(); if (busy || closed) return; busy = true;
        scroll.querySelectorAll<HTMLButtonElement>(".ms-pdf-page-editor button").forEach(node => node.disabled = true);
        try { await reader.rotatePdfPage(page); } catch (error) { new Notice(String(error)); } finally { busy = false; render(); }
      });
      sheet.append(rotate);
      sheet.append(actions, el("div", { class: "ms-pdf-page-edit-hint", text: "Double click on the blank area to exit editing" }));
      record.wrapper.querySelector(".ms-pdf-page-editor")?.remove(); record.wrapper.append(sheet);
    }
  };
  const stopPageChanges = reader.subscribePageChanges(render);
  scroll.addEventListener("dblclick", doubleClick); document.addEventListener("keydown", key); render();
  return close;
}
