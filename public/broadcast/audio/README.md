# Race audio

Custom assets generated with ElevenLabs for The Track on November 27, 2026.

- `announcer.mp3`: David Wolfe — Radio Announcer, the same voice as the existing site. Expressive short calls using the Eleven v4 model. Timed cue offsets are in `src/broadcast/voice.json`; reverse-order dice pairs share a call.
- `crowd.mp3`: outdoor race crowd atmosphere, looped quietly and raised in the home stretch.
- `pulse.mp3`: 136 BPM sports percussion with short strings and brass accents, without vocals. Reduced before decisive rolls and under commentary; fades after the finish.
- `hooves.mp3`: short packed-dirt gallop, triggered only for actual movement.
- `roar.mp3`: finish cheer; quieter short accents after settled lead changes.

All stems are normalized with headroom. Browser playback remains opt-in. Pause, mute, replay jumps, hidden tabs and unmount stop current playback. Audio never changes race results or roll timing.

Source flow: https://elevenlabs.io/app/flows/O7O6vET2DC8o9oN5Ax1g
