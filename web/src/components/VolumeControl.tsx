import { useState } from "react";
import {
  loadAudioSettings,
  saveAudioSettings,
  type AudioSettings,
} from "../audio/settings";
import { setMuted, setMusicEnabled, setVolume } from "../audio/sfx";
import "./volume.css";

/** Speaker toggle + slider. Applies immediately, persists across visits. */
export function VolumeControl() {
  const [settings, setSettings] = useState<AudioSettings>(loadAudioSettings);

  const update = (next: AudioSettings) => {
    setSettings(next);
    saveAudioSettings(next);
    setVolume(next.volume);
    setMuted(next.muted);
    setMusicEnabled(next.music);
  };

  const silent = settings.muted || settings.volume === 0;
  return (
    <div className="volume" aria-label="Sound">
      <button
        type="button"
        className="volume-mute"
        aria-label={settings.muted ? "Unmute sounds" : "Mute sounds"}
        aria-pressed={settings.muted}
        onClick={() => update({ ...settings, muted: !settings.muted })}
      >
        {silent ? "🔇" : "🔊"}
      </button>
      <button
        type="button"
        className="volume-music"
        data-on={settings.music}
        aria-label={settings.music ? "Turn music off" : "Turn music on"}
        aria-pressed={settings.music}
        onClick={() => update({ ...settings, music: !settings.music })}
      >
        ♪
      </button>
      <input
        type="range"
        className="volume-slider"
        min={0}
        max={100}
        step={5}
        value={Math.round(settings.volume * 100)}
        aria-label="Volume"
        onChange={(e) =>
          update({ ...settings, volume: Number(e.target.value) / 100, muted: false })
        }
      />
    </div>
  );
}
