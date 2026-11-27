# Race audio

Custom assets generated with ElevenLabs for The Track on November 27, 2026.

- `announcer.mp3`: David Wolfe — Radio Announcer, the same voice as the existing site. Expressive short calls using the Eleven v4 model. Timed cue offsets are in `src/broadcast/voice.json`; reverse-order dice pairs share a call.
- `gate-intro.mp3`: the same David Wolfe voice welcomes the field, describes clear/rain/fog conditions, then calls the horses to the gate. Three short cues fit inside the 20-second final odds countdown; offsets are in `src/broadcast/intro-plan.mjs`. The existing race reel supplies “And they're off!” at the start. Generated with Eleven v4; normalized to -17 LUFS / -2 dBTP. Source flow: https://elevenlabs.io/app/flows/PqP6veJiE8xcz7Byuh79
- `crowd.mp3`: outdoor race crowd atmosphere, looped quietly and raised in the home stretch.
- `pulse.mp3`: 136 BPM sports percussion with short strings and brass accents, without vocals. Reduced before decisive rolls and under commentary; fades after the finish.
- `hooves.mp3`: short packed-dirt gallop, triggered only for actual movement.
- `roar.mp3`: the full finish cheer.
- `race-calls.mp3`: 76 additional David Wolfe calls, including alternate basic dice phrases, urgent dice takes, lead/winner variations and short reactions to hurdles, turns, weather, gaps and missed chances. Eleven v4; -17 LUFS / -2 dBTP. Word-aligned offsets in `src/broadcast/voice-variety.json`. Basic calls remain on every eligible two-dice roll; selection uses current race facts and avoids consecutive identical phrasing. No real-time speech service is required.
- `dice-rattle.mp3` / `dice-land.mp3`: short resin-dice and felt-tray foley, synchronized with roll and settle.
- `cheer.mp3` / `ooh.mp3`: distinct lead/jump and missed-chance crowd reactions. Missed chances have a three-roll cooldown; finishes take priority.
- `victory.mp3`: a compact warm-brass finish flourish beneath the caller. New effects use -20 LUFS / -3 dBTP and the shared ducking/mute controls.

Polish asset source flow: https://elevenlabs.io/app/flows/eFk0tagdK02B5UTBZgJ9

All stems are normalized with headroom. Browser playback remains opt-in. Pause, mute, replay jumps, hidden tabs and unmount stop current playback. Audio never changes race results or roll timing.

Source flow: https://elevenlabs.io/app/flows/O7O6vET2DC8o9oN5Ax1g
