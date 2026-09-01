import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { EdgeTTS, VoicesManager, createVTT } from 'edge-tts-universal';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'docs', 'onboarding-tour');
const outputDir = path.join(root, 'public', 'onboarding');

// Narration for the live in-app demo (src/features/onboarding/LiveDemo.tsx), which
// drives the real workflow UI against a sample BOQ instead of playing a rendered video.
const languages = {
  en: {
    locale: 'en-US',
    preferredVoice: 'en-US-GuyNeural',
    rate: '-12%',
  },
  ar: {
    locale: 'ar-EG',
    preferredVoice: 'ar-EG-ShakirNeural',
    rate: '-5%',
  },
};

async function synthesize(language, config) {
  const text = (await readFile(path.join(sourceDir, `SCRIPT.${language}.txt`), 'utf8'))
    .replace(/\r?\n+/g, ' ')
    .trim();
  const manager = await VoicesManager.create();
  const available = manager.find({ Locale: config.locale, Gender: 'Male' });
  const voice = available.find((item) => item.ShortName === config.preferredVoice)
    ?? available[0];
  if (!voice) throw new Error(`No male ${config.locale} voice is available`);

  const tts = new EdgeTTS(text, voice.ShortName, { rate: config.rate, volume: '+0%' });
  const result = await tts.synthesize();
  await writeFile(
    path.join(outputDir, `tawreed-tour-${language}.mp3`),
    Buffer.from(await result.audio.arrayBuffer()),
  );
  await writeFile(
    path.join(outputDir, `tawreed-tour-${language}.vtt`),
    `${createVTT(result.subtitle).trimEnd()}\n`,
  );
}

await mkdir(outputDir, { recursive: true });
for (const [language, config] of Object.entries(languages)) {
  await synthesize(language, config);
}
