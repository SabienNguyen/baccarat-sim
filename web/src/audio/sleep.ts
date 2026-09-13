import { startAmbience, stopAmbience, suspendAudio, resumeAudio, isAmbiencePlaying } from "./sfx";

/**
 * Backgrounding the tab (or locking the phone) must not leave the Web Audio
 * graph rendering, or the felt's CSS animations painting, forever — browsers
 * throttle timers and rAF in the background but not audio, and a standalone
 * PWA has no browser tab to throttle anything at all.
 *
 * One `visibilitychange` listener: on hidden, stop the ambience bed and
 * suspend the AudioContext, and flag `<html class="hidden">` so
 * `.hidden * { animation-play-state: paused }` (theme.css) freezes every
 * CSS animation in one shot. On visible, resume the context and restart the
 * ambience only if it had actually been running before we hid it.
 *
 * Returns an uninstall function that removes the listener.
 */
export function installSleepOnHide(): () => void {
  let wasAmbient = false;

  const onVisibilityChange = () => {
    const hidden = document.hidden;
    document.documentElement.classList.toggle("hidden", hidden);
    if (hidden) {
      wasAmbient = isAmbiencePlaying();
      stopAmbience();
      suspendAudio();
    } else {
      resumeAudio();
      if (wasAmbient) startAmbience();
    }
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  return () => document.removeEventListener("visibilitychange", onVisibilityChange);
}
