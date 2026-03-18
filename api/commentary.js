export default async function handler(req, res) {
  if(req.method !== "POST") { res.status(405).end(); return; }
  const { text } = req.body;
  if(!text) { res.status(400).json({ error:"no text" }); return; }
  try {
    const elRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/mR1dRpBxfiThJHgub8nr/stream`,
      {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_turbo_v2",
          voice_settings: { stability:0.45, similarity_boost:0.82, style:0.35, use_speaker_boost:true }
        })
      }
    );
    if(!elRes.ok) {
      const err = await elRes.text();
      res.status(elRes.status).json({ error: err });
      return;
    }
    const buffer = await elRes.arrayBuffer();
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(Buffer.from(buffer));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
