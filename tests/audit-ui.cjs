// PLAYWRIGHT_MODULE and TEST_IMAGE_DIR can point to an existing local test installation.
// All auth/AI calls are mocked; no real accounts, photos or generation credits are used.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:8082';
const imageDir = process.env.TEST_IMAGE_DIR || '/tmp';
const images = ['photo-1549298916-b41d501d3772', 'photo-1598033129183-c4f50c736f10', 'photo-1551028719-00167b16eac5']
  .map(name => 'data:image/jpeg;base64,' + fs.readFileSync(path.join(imageDir, name + '.jpg')).toString('base64'));
const item = { id: 'audit-coat', name: 'AUDIT COAT', category: 'Плащ', section: 'Верхняя одежда', color: 'Чёрный', season: 'Круглый год', pattern: 'Однотонный', tags: [], imageUri: images[0] };
const look = { id: 'audit-look', name: 'AUDIT LOOK', title: 'AUDIT LOOK', itemIds: [item.id], createdAt: 1, tryOnImageUri: images[1] };

async function seed(page, { legacy = false, corrupt = false, lang = 'ru', dark = false } = {}) {
  await page.addInitScript(({ images, item, look, legacy, corrupt, lang, dark }) => {
    if (localStorage.getItem('audit-seeded')) return;
    const prefix = legacy ? '' : 'account:alice:';
    const data = { 'audit-seeded': true, onboardingSeen: true, authSession: { token: 'alice-test', login: 'alice', displayName: 'Alice' },
      [prefix + 'profileState']: { displayName: 'Alice', gender: 'male', modelUri: images[0] },
      [prefix + 'wardrobeItems']: corrupt ? [null] : [item], [prefix + 'savedLooks']: [look], [prefix + 'favoriteLooks']: [look] };
    for (const [key, value] of Object.entries(data)) localStorage.setItem(key, JSON.stringify(value));
    if (!legacy) localStorage.setItem('account:alice:storageVersion', '1');
    localStorage.setItem('appLanguage', lang);
    localStorage.setItem('themeMode', dark ? 'dark' : 'light');
  }, { images, item, look, legacy, corrupt, lang, dark });
}
const read = (page, key) => page.evaluate(async key => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('stylist-local-data', 1);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const raw = await new Promise((resolve, reject) => {
    const transaction = db.transaction('collections', 'readonly');
    const request = transaction.objectStore('collections').get(key);
    transaction.oncomplete = () => resolve(request.result); transaction.onabort = () => reject(transaction.error);
  });
  db.close();
  return JSON.parse(raw ?? localStorage.getItem(key) ?? 'null');
}, key);
const eventually = async callback => {
  let error;
  for (let i = 0; i < 40; i++) { try { return await callback(); } catch (e) { error = e; await new Promise(resolve => setTimeout(resolve, 100)); } }
  throw error;
};
async function mocks(page, stall = false) {
  // Catch all API traffic first so tests can never accidentally call the paid service.
  await page.route('https://62.60.238.183.nip.io/**', route => route.fulfill({ status: 503, json: { detail: 'Unmocked test request' } }));
  await page.route('**/auth/me', route => stall ? undefined : route.fulfill({ json: { displayName: 'Test' } }));
  await page.route('**/auth/logout', route => route.fulfill({ json: { ok: true } }));
  await page.route('**/auth/login', route => {
    const login = route.request().postDataJSON().login;
    return route.fulfill({ json: { login, token: login + '-test', displayName: login } });
  });
}
async function logout(page) {
  await page.getByRole('tab', { name: 'Профиль', exact: true }).click();
  await page.getByText('Выйти из аккаунта', { exact: true }).click();
  await page.getByRole('button', { name: 'Войти', exact: true }).waitFor();
}
async function login(page, name) {
  await page.getByRole('textbox', { name: 'Логин', exact: true }).fill(name);
  await page.getByRole('textbox', { name: 'Пароль', exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  let page;
  const errors = [];
  const newPage = async (width = 390, height = 844) => {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(15000);
    return page;
  };
  try {
    page = await newPage(320, 740);
    await seed(page, { legacy: true }); await mocks(page);
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.getByRole('button', { name: 'Перенести мой гардероб', exact: true }).waitFor();
    await page.screenshot({ path: '/tmp/fixed-migration-320.png' });
    await page.getByRole('button', { name: 'Перенести мой гардероб', exact: true }).click();
    await page.getByRole('button', { name: item.name, exact: true }).waitFor();
    await logout(page); await login(page, 'bobby');
    await page.getByText('Мужской', { exact: true }).click();
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
    await page.getByRole('tab', { name: 'Гардероб', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: item.name, exact: true }).count(), 0);
    assert.deepEqual(await read(page, 'account:bobby:wardrobeItems'), []);
    assert.equal((await read(page, 'account:alice:profileState')).modelUri, images[0]);
    await logout(page); await login(page, 'alice');
    await page.getByRole('button', { name: item.name, exact: true }).waitFor();
    assert.equal((await read(page, 'account:alice:favoriteLooks'))[0].id, look.id);
    const adapter = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/keyValueStorage.web.ts'), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    await page.evaluate(async source => {
      const module = { exports: {} };
      const storage = { getItem: async key => localStorage.getItem(key), setItem: async (key, value) => localStorage.setItem(key, value), removeItem: async key => localStorage.removeItem(key) };
      new Function('require', 'module', 'exports', source)(() => ({ default: storage }), module, module.exports);
      const key = 'account:large-test:photos';
      const data = 'x'.repeat(7 * 1024 * 1024);
      await module.exports.default.setItem(key, data);
      if ((await module.exports.default.getItem(key)).length !== data.length) throw new Error('Large collection did not survive IndexedDB');
      if (localStorage.getItem(key) !== null) throw new Error('Photo collection must not consume localStorage');
    }, adapter);
    console.log('PASS UI: legacy claim, account isolation, logout and return preserve profile and collections');
    console.log('PASS UI: real IndexedDB stores a 7 MB collection outside localStorage');
    await page.close();

    page = await newPage(); await seed(page, { corrupt: true }); await mocks(page, true);
    const started = Date.now();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.getByRole('tab', { name: 'Гардероб', exact: true }).waitFor({ timeout: 5000 });
    assert.ok(Date.now() - started < 7000, 'local data must not wait for auth timeout');
    await eventually(async () => assert.equal((await read(page, 'account:alice:favoriteLooks'))[0].id, look.id));
    assert.deepEqual(await read(page, 'account:alice:wardrobeItems'), [null]);
    assert.equal((await read(page, 'account:alice:savedLooks'))[0].id, look.id);
    console.log('PASS UI: stalled auth does not block startup; semantic corruption leaves other collections intact');
    await page.close();

    page = await newPage(); await seed(page); await mocks(page);
    let calls = 0;
    let release = false;
    const jobs = new Map();
    await page.route('**/tryon-generate-look', route => {
      const id = /name="request_id"\r\n\r\n([^\r]+)/.exec(route.request().postData())[1];
      calls++;
      jobs.set(id, { index: calls, status: 'succeeded', jobId: id, updatedAt: Date.now() + calls * 1000, outputUrl: images[calls % images.length] });
      return route.fulfill({ status: 202, json: { status: 'processing', jobId: id } });
    });
    await page.route('**/tryon-jobs/*', route => {
      const id = route.request().url().split('/').pop();
      const job = jobs.get(id);
      return route.fulfill({ json: job.index >= 3 && !release ? { status: 'processing', jobId: id } : job });
    });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Примерка', exact: true }).click();
    await page.getByRole('checkbox', { name: item.name, exact: true }).click();
    await page.getByRole('button', { name: 'К примерке', exact: true }).click();
    await page.getByRole('button', { name: 'Примерить', exact: true }).click();
    await page.getByRole('button', { name: 'Перегенерировать', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Перегенерировать', exact: true }).click();
    await eventually(async () => assert.equal(await page.getByRole('button', { name: /^Примерка от / }).count(), 2));
    assert.equal(new Set(jobs.keys()).size, 2);
    await page.getByRole('button', { name: /^Примерка от / }).nth(1).click();
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.getByRole('button', { name: 'Сохранить образ', exact: true }).click();
    await eventually(async () => assert.equal((await read(page, 'account:alice:savedLooks'))[0].tryOnImageUri, images[1]));
    console.log('PASS UI: two new variants, deduplicated history, chosen old frame is saved');

    await page.getByRole('button', { name: 'Перегенерировать', exact: true }).click();
    await eventually(async () => assert.equal(calls, 3));
    await page.getByRole('button', { name: 'Закрыть примерку', exact: true }).click();
    await page.getByRole('tab', { name: 'Гардероб', exact: true }).click();
    release = true;
    await eventually(async () => assert.equal((await read(page, 'account:alice:tryOnJobs'))[0].status, 'succeeded'));
    await page.getByRole('tab', { name: 'Примерка', exact: true }).click();
    await page.getByText('Недавние примерки', { exact: true }).waitFor();
    await page.getByRole('button', { name: `Открыть примерку: ${item.name}`, exact: true }).first().click();
    await page.getByRole('button', { name: 'Сохранить образ', exact: true }).click();
    await eventually(async () => assert.equal((await read(page, 'account:alice:savedLooks'))[0].tryOnImageUri, images[0]));
    await page.getByRole('button', { name: 'Закрыть примерку', exact: true }).click();
    console.log('PASS UI: generation survives navigation and is savable from recent jobs');

    await page.getByRole('checkbox', { name: item.name, exact: true }).click();
    await page.getByRole('button', { name: 'К примерке', exact: true }).click();
    release = false;
    await page.getByRole('button', { name: 'Перегенерировать', exact: true }).click();
    await eventually(async () => assert.equal(calls, 4));
    await eventually(async () => assert.equal((await read(page, 'account:alice:tryOnJobs'))[0].status, 'pending'));
    release = true;
    await page.reload({ waitUntil: 'networkidle' });
    await eventually(async () => assert.equal((await read(page, 'account:alice:tryOnJobs'))[0].status, 'succeeded'));
    assert.equal(calls, 4);
    console.log('PASS UI: browser reload restores pending task without submitting again');

    await page.getByRole('button', { name: item.name, exact: true }).click();
    await page.getByRole('button', { name: 'История вещи: 5', exact: true }).click();
    await page.getByRole('tab', { name: 'История', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^Открыть генерацию:/ }).count(), 5);
    await page.getByRole('button', { name: `Открыть генерацию: ${item.name}`, exact: true }).first().click();
    await page.getByRole('button', { name: `Открыть вещь: ${item.name}`, exact: true }).click();
    await page.getByText('Детали вещи', { exact: true }).waitFor();
    assert.equal(calls, 4, 'opening history and linked garment never generates again');
    console.log('PASS UI: new generations and legacy result are in history; item-to-history navigation works both ways');
    await page.getByRole('button', { name: 'Удалить', exact: true }).click();
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    assert.equal((await read(page, 'account:alice:wardrobeItems')).length, 1);
    await page.getByRole('button', { name: 'Удалить', exact: true }).click();
    await page.getByRole('button', { name: 'Удалить', exact: true }).last().click();
    await eventually(async () => assert.deepEqual(await read(page, 'account:alice:wardrobeItems'), []));
    await page.getByRole('tab', { name: 'Примерка', exact: true }).click();
    await page.getByRole('tab', { name: 'История', exact: true }).click();
    await page.getByRole('button', { name: `Открыть генерацию: ${item.name}`, exact: true }).first().click();
    await page.getByText('Удалена из гардероба', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: `Открыть вещь: ${item.name}`, exact: true }).count(), 0);
    assert.equal((await read(page, 'account:alice:tryOnJobs')).length, 5);
    console.log('PASS UI: web delete cancel and confirm both work');
    console.log('PASS UI: deleting a garment keeps all generations and displays its snapshot without a broken link');
    await page.close();

    for (const width of [320, 390, 1440]) {
      page = await newPage(width, width === 320 ? 740 : 900);
      await seed(page, { dark: width === 390 }); await mocks(page);
      await page.addInitScript(({ image }) => {
        if (localStorage.getItem('history-seeded')) return;
        localStorage.setItem('history-seeded', '1');
        const old = JSON.parse(localStorage.getItem('account:alice:savedLooks'));
        localStorage.setItem('account:alice:savedLooks', JSON.stringify([...old, {
          id: 'other-look', name: 'OTHER LOOK', itemIds: ['other-item'], createdAt: 1234567, tryOnImageUri: image
        }]));
      }, { image: images[2] });
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: 'Примерка', exact: true }).click();
      await page.getByRole('tab', { name: 'История', exact: true }).click();
      await page.getByRole('button', { name: 'Открыть генерацию: OTHER LOOK', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: /^Открыть генерацию:/ }).count(), 2);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const tabs = await page.getByRole('tablist').first().getByRole('tab').evaluateAll(nodes => nodes.map(node => {
        const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, height: r.height };
      }));
      assert.equal(tabs.length, 4);
      assert.ok(tabs.every(tab => tab.left >= 0 && tab.right <= width && tab.height >= 44), JSON.stringify(tabs));
      await page.waitForTimeout(800);
      await page.screenshot({ path: `/tmp/history-${width}.png` });
      await page.getByRole('button', { name: 'Вещь в образе: Все вещи', exact: true }).click();
      await page.getByRole('radio', { name: item.name, exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Открыть генерацию: OTHER LOOK', exact: true }).count(), 0);
      await page.getByRole('button', { name: `Открыть генерацию: ${look.name}`, exact: true }).click();
      await page.getByRole('button', { name: 'Увеличить результат', exact: true }).click();
      await page.getByRole('button', { name: 'К деталям', exact: true }).click();
      await page.getByRole('button', { name: `Открыть вещь: ${item.name}`, exact: true }).click();
      await page.getByRole('button', { name: 'История вещи: 1', exact: true }).waitFor();
      await page.getByRole('button', { name: 'История вещи: 1', exact: true }).scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);
      await page.screenshot({ path: `/tmp/history-item-${width}.png` });
      await page.getByRole('button', { name: 'История вещи: 1', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: /^Открыть генерацию:/ }).count(), 1);
      await page.getByRole('button', { name: `Открыть генерацию: ${look.name}`, exact: true }).click();
      await page.getByRole('button', { name: 'Примерить снова', exact: true }).click();
      await page.getByRole('button', { name: 'Примерить', exact: true }).waitFor();
      await page.close();
    }
    console.log('PASS UI: history filter, legacy import, zoom and repeat selection at 320/390/1440px in light/dark themes');

    page = await newPage(); await seed(page); await mocks(page);
    const analyzedPhotos = [];
    await page.route('**/analyze', async route => {
      const form = await new Response(route.request().postDataBuffer(), { headers: { 'Content-Type': route.request().headers()['content-type'] } }).formData();
      const file = form.get('file');
      const photo = 'data:image/jpeg;base64,' + Buffer.from(await file.arrayBuffer()).toString('base64');
      const size = await page.evaluate(async uri => {
        const bitmap = await createImageBitmap(await (await fetch(uri)).blob());
        const size = { width: bitmap.width, height: bitmap.height }; bitmap.close(); return size;
      }, photo);
      analyzedPhotos.push(size);
      await route.fulfill({ json: { category: 'Плащ', season: 'Демисезон', pattern: 'Однотонный', needsReview: false } });
    });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const originalSize = await page.evaluate(async uri => {
      const bitmap = await createImageBitmap(await (await fetch(uri)).blob());
      const size = { width: bitmap.width, height: bitmap.height }; bitmap.close(); return size;
    }, images[2]);
    await page.getByRole('button', { name: 'Добавить вещь', exact: true }).click();
    await page.getByRole('button', { name: 'Закрыть выбор фото', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Открыть справку', exact: true }).count(), 1);
    for (const source of ['Из галереи', 'Снять фото']) {
      await page.getByRole('button', { name: 'Добавить вещь', exact: true }).click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: '/tmp/photo-source-picker.png' });
      const chooserPromise = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: source, exact: true }).click();
      const chooser = await chooserPromise;
      assert.equal(await chooser.element().getAttribute('capture'), source === 'Снять фото' ? 'camera' : null);
      await chooser.setFiles(path.join(imageDir, 'photo-1551028719-00167b16eac5.jpg'));
      await page.getByRole('button', { name: 'Отменить обрезку', exact: true }).waitFor();
      await page.waitForTimeout(500);
      assert.equal(await page.getByRole('button', { name: 'Готово', exact: true }).isEnabled(), true);
      const renderedPhoto = await page.getByTestId('crop-image').evaluate(node => {
        const img = node.tagName === 'IMG' ? node : node.querySelector('img');
        const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
        const context = canvas.getContext('2d'); context.drawImage(img, 0, 0, 32, 32);
        const data = context.getImageData(0, 0, 32, 32).data;
        const shades = new Set(); for (let i = 0; i < data.length; i += 4) shades.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
        return { width: img.naturalWidth, height: img.naturalHeight, shades: shades.size };
      });
      assert.deepEqual([renderedPhoto.width, renderedPhoto.height], [originalSize.width, originalSize.height]);
      assert.ok(renderedPhoto.shades > 100, 'crop preview contains image detail, not a tiny stretched placeholder');
      const handle = await page.getByTestId('crop-se').boundingBox();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(handle.x + handle.width / 2 - 60, handle.y + handle.height / 2 - 60, { steps: 8 });
      await page.mouse.up();
      await page.screenshot({ path: '/tmp/photo-camera-crop.png' });
      const previous = analyzedPhotos.length;
      await page.getByRole('button', { name: 'Готово', exact: true }).click();
      await eventually(async () => assert.equal(analyzedPhotos.length, previous + 1));
      assert.ok(analyzedPhotos.at(-1).width < originalSize.width && analyzedPhotos.at(-1).height < originalSize.height, 'analysis receives cropped pixels');
      await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Добавить вещь', exact: true }).click();
    const cancelChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Снять фото', exact: true }).click();
    await (await cancelChooserPromise).setFiles(path.join(imageDir, 'photo-1551028719-00167b16eac5.jpg'));
    await page.getByRole('button', { name: 'Отменить обрезку', exact: true }).click();
    await page.getByRole('button', { name: 'Добавить вещь', exact: true }).click();
    await page.getByRole('button', { name: 'Из галереи', exact: true }).waitFor();
    assert.equal(analyzedPhotos.length, 2, 'canceling crop does not analyze or add a garment');
    assert.equal((await read(page, 'account:alice:wardrobeItems')).length, 1);
    await page.close();
    console.log('PASS UI: plus offers gallery/camera; both crop before analysis; cancellation and reopening work');

    page = await newPage(); await seed(page); await mocks(page);
    await page.addInitScript(({ item }) => {
      localStorage.setItem('account:alice:wardrobeItems', JSON.stringify([{ ...item, section: 'Верх', category: 'Футболка' }]));
    }, { item });
    const fitRequests = [];
    await page.route('**/tryon-generate-look', async route => {
      const form = await new Response(route.request().postDataBuffer(), { headers: { 'Content-Type': route.request().headers()['content-type'] } }).formData();
      fitRequests.push(form.get('tuck_mode'));
      await route.fulfill({ json: { status: 'succeeded', outputUrl: images[fitRequests.length % images.length], updatedAt: Date.now() } });
    });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Примерка', exact: true }).click();
    await page.getByRole('checkbox', { name: item.name, exact: true }).click();
    await page.getByRole('button', { name: 'К примерке', exact: true }).click();
    await page.getByRole('button', { name: 'Настройки примерки', exact: true }).click();
    for (const [label, mode] of [['Заправить', 'tucked'], ['Навыпуск', 'untucked']]) {
      await page.getByRole('radio', { name: label, exact: true }).click();
      assert.equal(await page.getByRole('radio', { name: label, exact: true }).getAttribute('aria-checked'), 'true');
      await page.getByRole('button', { name: fitRequests.length ? 'Перегенерировать' : 'Примерить', exact: true }).click();
      await eventually(async () => {
        const jobs = await read(page, 'account:alice:tryOnJobs');
        assert.equal(jobs[0].status, 'succeeded'); assert.equal(jobs[0].result.tuckMode, mode);
      });
    }
    assert.deepEqual(fitRequests, ['tucked', 'untucked']);
    await page.close();
    console.log('PASS UI: tucked/untucked selection reaches API and persists with each generated variant');

    for (const width of [320, 390, 1440]) {
      page = await newPage(width, width === 320 ? 740 : 900);
      await seed(page, { lang: 'zh', dark: width === 390 }); await mocks(page);
      await page.goto(BASE, { waitUntil: 'networkidle' });
      // Simulate OS insets at the web provider's CSS measurement boundary.
      const safeTop = width === 1440 ? 0 : width === 390 ? 59 : 20;
      await page.addStyleTag({ content: `div[style*="safe-area-inset-top"] { padding-top: ${safeTop}px !important; padding-bottom: ${safeTop ? 34 : 0}px !important; }` });
      await page.getByRole('button', { name: '打开帮助', exact: true }).click();
      const checkHelpToolbar = async () => {
        await eventually(async () => {
          assert.equal(await page.locator('div[style*="safe-area-inset-top"]').count(), 2, 'the modal owns its safe-area provider');
          const box = await page.getByRole('button', { name: '关闭帮助', exact: true }).boundingBox();
          assert.ok(box && box.y >= safeTop && box.y < safeTop + 68, 'toolbar clears system inset exactly once');
        });
      };
      await checkHelpToolbar();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `/tmp/help-safe-area-${width}.png` });
      await page.getByRole('button', { name: '如何拍摄鞋子', exact: true }).click();
      await checkHelpToolbar();
      assert.ok((await page.locator('body').innerText()).includes('鞋带'));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `/tmp/fixed-help-${width}.png` });
      await page.getByRole('button', { name: '返回帮助目录', exact: true }).click();
      await checkHelpToolbar();
      await page.getByRole('button', { name: '关闭帮助', exact: true }).click();
      await page.getByRole('tab', { name: '灵感', exact: true }).click();
      await page.getByText('今天穿什么', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '打开帮助', exact: true }).count(), 0);
      assert.equal(/[А-Яа-яЁё]/.test(await page.locator('body').innerText()), false, 'new recommendations fully translated');
      await page.screenshot({ path: `/tmp/fixed-ideas-${width}.png` });
      await page.getByRole('tab', { name: '试穿', exact: true }).click();
      await page.getByRole('tab', { name: '历史', exact: true }).click();
      await page.getByText('生成历史', { exact: true }).waitFor();
      assert.equal(/[А-Яа-яЁё]/.test(await page.locator('body').innerText()), false, 'history fully translated');
      await page.close();
    }
    console.log('PASS UI: Chinese help and recommendations, 320/390/1440px, modal safe-area insets 0/20/59px, contextual help visibility');
    assert.deepEqual(errors, [], 'no uncaught browser errors');
  } catch (error) {
    if (page && !page.isClosed()) {
      console.error((await page.locator('body').innerText()).slice(0, 5000));
      await page.screenshot({ path: '/tmp/fixed-ui-failure.png' }).catch(() => {});
    }
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
