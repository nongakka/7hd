const { chromium } = require('playwright');
const fs = require('fs-extra');
const { execSync } = require('child_process');
const isCI = process.env.GITHUB_ACTIONS === 'true';
// ===== CONFIG =====
const CATEGORIES = [
  {
    name: 'หนังใหม่ 2026',
    file: 'newmovie-2026',
    url: 'https://7-hd.com/newmovie-2026/'
  },
  {
    name: 'หนังใหม่ 2025',
    file: 'movie-2025',
    url: 'https://7-hd.com/movie-2025/'
  },
  {
    name: 'หนัง action',
    file: 'action',
    url: 'https://7-hd.com/action/'
  },
  {
    name: 'หนังไทย',
    file: 'thai-movie',
    url: 'https://7-hd.com/thai-movie/'
  },
 {
    name: 'หนังฝรั่ง',
    file: 'inter',
    url: 'https://7-hd.com/international/'
  },
  {
    name: 'หนังเกาหลี',
    file: 'korean',
    url: 'https://7-hd.com/korean-movie/'
  },
  {
    name: 'หนังจีน',
    file: 'chinese',
    url: 'https://7-hd.com/chinese-movie/'
  },
  {
    name: 'หนังญี่ปุ่น',
    file: 'japanese',
    url: 'https://7-hd.com/japanese-movie/'
  },
  {
    name: 'หนัง Netflix',
    file: 'netflix',
    url: 'https://7-hd.com/netflix/'
  },
  {
    name: 'หนัง Marvel',
    file: 'marvel',
    url: 'https://7-hd.com/marvel-universe/'
  },
  {
    name: 'หนัง DC',
    file: 'dc',
    url: 'https://7-hd.com/dc-universe/'
  },
  
];

// ===== RESUME =====
function loadProgress(file) {
  if (fs.existsSync(file)) {
    return fs.readJsonSync(file);
  }
  return { done: [] };
}

function saveProgress(file, data) {
  fs.writeJsonSync(file, data, { spaces: 2 });
}

// ===== GIT =====
function gitCommit(msg) {
  try {
    execSync('git add .');

    // commit (ถ้ามีการเปลี่ยนแปลง)
    execSync(`git commit -m "${msg}" || echo "no changes"`);

    // ❗ push เฉพาะตอน local
    if (!process.env.GITHUB_ACTIONS) {
      execSync('git push');
      console.log('🚀 pushed (local)');
    } else {
      console.log('📦 commit only (CI)');
    }

  } catch (e) {
    console.log('⚠️ git skip');
  }
}

// ===== HELPERS =====
function extractId(embedUrl) {
  const match = embedUrl.match(/embed\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function buildStreams(embedUrl) {
  const id = extractId(embedUrl);
  if (!id) return null;

  return {
    m3u8: `https://media.vdohls.com/${id}/playlist.m3u8`,
    embed: embedUrl
  };
}

// ===== SCRAPE LIST =====
async function scrapeList(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  return await page.$$eval('a[aria-label]', (els) => {
    return els.map(a => ({
      title:
        a.querySelector('.p2')?.innerText.trim() ||
        a.getAttribute('aria-label'),
      link: a.href,
      poster: a.querySelector('img')?.src || null
    }));
  });
}

// ===== SCRAPE MOVIE =====
async function scrapeMovie(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  let embed = await page.$eval(
    'a.player-1-btn-link',
    el => el.href
  ).catch(() => null);

  if (!embed) {
    embed = await page.$eval(
      'iframe',
      el => el.src
    ).catch(() => null);
  }

  return embed;
}

// ===== MAIN =====
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  for (const cat of CATEGORIES) {
    console.log(`\n📂 Category: ${cat.name}`);

    const progressFile = `./progress-${cat.file}.json`;
    const progress = loadProgress(progressFile);

    const list = await scrapeList(page, cat.url);
    const results = [];

    for (const movie of list) {
      console.log(`🎬 ${movie.title}`);

      // ===== RESUME SKIP =====
      if (progress.done.includes(movie.link)) {
        console.log('⏩ skip');
        continue;
      }

      const embed = await scrapeMovie(page, movie.link);
      if (!embed) {
        console.log('❌ no embed');
        continue;
      }

      const streams = buildStreams(embed);
      if (!streams) {
        console.log('❌ no streams');
        continue;
      }

      // ===== FORMAT =====
      results.push({
        name: movie.title,
        image: movie.poster,
        servers: [
          {
            name: "⚡ M3U8",
            url: streams.m3u8
          },
          {
            name: "🎬 Embed",
            url: streams.embed
          }
        ]
      });

      // ===== SAVE PROGRESS =====
      progress.done.push(movie.link);
      saveProgress(progressFile, progress);

      // ===== AUTO COMMIT EVERY 20 =====
      if (results.length % 20 === 0) {
        gitCommit(`progress ${cat.file}`);
      }
    }

    // ===== SAVE JSON =====
    const jsonData = {
      name: cat.name,
      stations: results
    };

    await fs.writeJson(`./${cat.file}.json`, jsonData, {
      spaces: 2
    });

    console.log(`💾 Saved ${cat.file}.json`);

    // ===== SAVE M3U (WITH LOGO) =====
    let m3u = '#EXTM3U\n';

    for (const m of results) {
      const m3u8 = m.servers.find(s => s.name.includes('M3U8'))?.url;
      if (!m3u8) continue;

      m3u += `#EXTINF:-1 tvg-logo="${m.image}",${m.name}\n`;
      m3u += `${m3u8}\n`;
    }

    await fs.writeFile(`./${cat.file}.m3u`, m3u);

    console.log(`📺 Saved ${cat.file}.m3u`);

    // ===== FINAL COMMIT =====
    gitCommit(`update ${cat.file}`);
  }

  await browser.close();
})();
