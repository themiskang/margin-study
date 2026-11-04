import { Platform } from "obsidian";

/** 是否为触摸设备（平板/手机）。手写功能仅在此类设备上提供。 */
export function isTouch(): boolean {
  return Platform.isMobile;
}

/** 是否支持麦克风录音（MediaRecorder + getUserMedia）。 */
export function hasMic(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    !!navigator.mediaDevices.getUserMedia &&
    typeof (window as any).MediaRecorder !== "undefined"
  );
}
