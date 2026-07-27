import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { EdgeTTS, VoicesManager, createVTT } from 'edge-tts-universal';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'docs', 'onboarding-tour');
const outputDir = path.join(root, 'public', 'onboarding');
const fontFile = 'C\\:/Windows/Fonts/segoeui.ttf';

const languages = {
  en: {
    locale: 'en-US',
    preferredVoice: 'en-US-GuyNeural',
    rate: '-12%',
    labels: [
      ['Choose your language', 'English     العربية'],
      ['Add your BOQ', 'Excel  ·  PDF  ·  CSV  ·  ODS'],
      ['Improve suggestions?', 'Continue offline      Improve suggestions'],
      ['Clear progress', 'Reading BOQ  ·  Preparing packages  ·  Creating files'],
      ['Review work packages', 'Items      % of BOQ      EGP value'],
      ['Approve and create', 'Master workbook + separate package files'],
      ['Simple settings', 'Language  ·  Processing  ·  Connection  ·  Guide'],
    ],
  },
  ar: {
    locale: 'ar-EG',
    preferredVoice: 'ar-EG-ShakirNeural',
    rate: '-5%',
    labels: [
      ['اختر لغة التطبيق', 'العربية     English'],
      ['أضف جدول الكميات', 'Excel  ·  PDF  ·  CSV  ·  ODS'],
      ['هل تريد تحسين الاقتراحات؟', 'المتابعة دون اتصال      تحسين الاقتراحات'],
      ['تقدم واضح', 'قراءة الجدول  ·  تجهيز الحزم  ·  إنشاء الملفات'],
      ['راجع حزم العمل', 'البنود      النسبة      القيمة'],
      ['اعتمد وأنشئ الملفات', 'ملف رئيسي وملفات منفصلة للحزم'],
      ['إعدادات بسيطة', 'اللغة  ·  المعالجة  ·  الاتصال  ·  الدليل'],
    ],
  },
};

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}`));
    });
  });
}

function capture(command, args) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const child = spawn(command, args, { cwd: root, windowsHide: true });
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.pipe(process.stderr);
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks).toString('utf8'));
      else reject(new Error(`${command} exited with ${code}`));
    });
  });
}

function esc(text) {
  return text
    .replaceAll('\\', '\\\\')
    .replaceAll(':', '\\:')
    .replaceAll("'", "\\'")
    .replaceAll(',', '\\,')
    .replaceAll('%', '\\%');
}

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
  const audioPath = path.join(outputDir, `tawreed-tour-${language}.mp3`);
  await writeFile(audioPath, Buffer.from(await result.audio.arrayBuffer()));
  await writeFile(
    path.join(outputDir, `tawreed-tour-${language}.vtt`),
    `${createVTT(result.subtitle).trimEnd()}\n`,
  );
  return audioPath;
}

async function render(language, config, audioPath) {
  const probe = JSON.parse(await capture('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'json',
    audioPath,
  ]));
  const duration = Number(probe.format.duration);
  const sceneLength = duration / config.labels.length;
  const filters = [
    'drawbox=x=55:y=45:w=1170:h=630:color=0xffffff:t=fill',
    'drawbox=x=55:y=45:w=1170:h=630:color=0xd4d4d8:t=2',
    'drawbox=x=55:y=45:w=1170:h=48:color=0xfafafa:t=fill',
    'drawbox=x=55:y=92:w=1170:h=2:color=0xf5a800:t=fill',
    `drawtext=fontfile='${fontFile}':text='Tawreed':x=86:y=62:fontsize=24:fontcolor=0x18181b:expansion=none`,
    `drawtext=fontfile='${fontFile}':text='●':x='92+mod(t*115\\,1030)':y=641:fontsize=18:fontcolor=0xf5a800:expansion=none`,
  ];

  config.labels.forEach(([title, detail], index) => {
    const start = index * sceneLength;
    const end = index === config.labels.length - 1 ? duration + 1 : (index + 1) * sceneLength;
    const enable = `between(t\\,${start.toFixed(2)}\\,${end.toFixed(2)})`;
    filters.push(
      `drawtext=fontfile='${fontFile}':text='${esc(title)}':x=(w-text_w)/2:y=160:fontsize=42:fontcolor=0x18181b:expansion=none:enable='${enable}'`,
      `drawtext=fontfile='${fontFile}':text='${esc(detail)}':x=(w-text_w)/2:y=225:fontsize=22:fontcolor=0x71717a:expansion=none:enable='${enable}'`,
      `drawbox=x=215:y=310:w=850:h=190:color=0xf7f7f7:t=fill:enable='${enable}'`,
      `drawbox=x=215:y=310:w=850:h=190:color=0xe4e4e7:t=2:enable='${enable}'`,
    );
    if (index === 0) {
      filters.push(
        `drawbox=x=285:y=360:w=300:h=88:color=0xffffff:t=fill:enable='${enable}'`,
        `drawbox=x=285:y=360:w=300:h=88:color=0xf5a800:t=2:enable='${enable}'`,
        `drawbox=x=695:y=360:w=300:h=88:color=0xffffff:t=fill:enable='${enable}'`,
      );
    } else if (index === 4) {
      [0, 1, 2].forEach((row) => {
        filters.push(
          `drawbox=x=275:y=${338 + row * 48}:w=${560 - row * 100}:h=8:color=0xf5a800:t=fill:enable='${enable}'`,
          `drawbox=x=850:y=${328 + row * 48}:w=120:h=28:color=0xffffff:t=fill:enable='${enable}'`,
        );
      });
    } else {
      filters.push(
        `drawbox=x=330:y=365:w=620:h=18:color=0xe4e4e7:t=fill:enable='${enable}'`,
        `drawbox=x=330:y=365:w=${Math.max(140, 580 - index * 50)}:h=18:color=0xf5a800:t=fill:enable='${enable}'`,
        `drawbox=x=470:y=420:w=340:h=50:color=0xf5a800:t=fill:enable='${enable}'`,
      );
    }
  });

  const output = path.join(outputDir, `tawreed-tour-${language}.mp4`);
  await run('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=0xf4f4f2:s=1280x720:r=30:d=${duration.toFixed(3)}`,
    '-i', audioPath,
    '-vf', filters.join(','),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '24',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-shortest',
    '-movflags', '+faststart',
    output,
  ]);
  await run('ffmpeg', [
    '-y',
    '-ss', '1',
    '-i', output,
    '-frames:v', '1',
    '-q:v', '2',
    path.join(outputDir, `tawreed-tour-${language}-poster.jpg`),
  ]);
}

await mkdir(outputDir, { recursive: true });
for (const [language, config] of Object.entries(languages)) {
  const audioPath = await synthesize(language, config);
  await render(language, config, audioPath);
  await rm(audioPath);
}
