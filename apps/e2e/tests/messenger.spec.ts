import {
  expect,
  request,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { BASE_URL, devEmail } from '../env';
import { devLogin, userIdOf } from '../support/auth';

/**
 * The messenger (ADR 0005): opening ENU Den lands in my default pet's room beside the town panel; I make a new
 * pet, write to it, and my own Claude Code answers through the pet channel (played here by a plain HTTP client
 * holding a paired `edc_` token). A colleague reads the same room afterwards: company messages, dates only.
 * Example roster (pseudonyms): L4a = owner, L4b = colleague.
 */

test.describe.configure({ mode: 'serial' });

const PET_NAME = '이투이 도우미';
const QUESTION = '오늘 배포 전에 확인할 것 세 가지만 알려 줘';
const REPLY =
  '마이그레이션 순서, 환경 변수 누락 여부, 롤백 절차 이렇게 세 가지를 먼저 확인해 보세요. 배포 후에는 오류율 그래프를 십 분 정도 지켜보면 좋아요.';

let owner: BrowserContext;
let colleague: BrowserContext;
let machine: APIRequestContext;
let ownerId: string;
let ownerPage: Page;
let petId: string;

test.beforeAll(async ({ browser }) => {
  owner = await browser.newContext();
  colleague = await browser.newContext();
  await devLogin(owner, devEmail('L4a'));
  await devLogin(colleague, devEmail('L4b'));
  ownerId = await userIdOf(owner);
  // The plugin's side: no browser, no cookies; only the bearer token it gets from pairing.
  machine = await request.newContext({ baseURL: BASE_URL });
});

test.afterAll(async () => {
  await machine?.dispose();
  await owner?.close();
  await colleague?.close();
});

test('opening ENU Den lands in my default pet room next to the town', async () => {
  ownerPage = await owner.newPage();
  await ownerPage.goto('/');
  await expect(ownerPage).toHaveURL(/\/pets\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  const nav = ownerPage.getByRole('navigation', { name: '대화 목록' });
  await expect(nav.getByRole('heading', { name: '내 펫' })).toBeVisible();
  await expect(nav.getByRole('link', { name: '전체 방' })).toBeVisible();
  // At 1440 px the town is a panel beside the conversation, never steered.
  const town = ownerPage.getByRole('complementary', { name: '타운' });
  await expect(town.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await expect(ownerPage.getByRole('textbox', { name: /에게 메시지 보내기$/ })).toBeVisible();
});

test('새 펫 만들기 creates a pet and opens its room', async () => {
  await ownerPage.getByRole('link', { name: '새 펫 만들기' }).click();
  await expect(ownerPage).toHaveURL(/\/pets\/new$/);
  await ownerPage.locator('#pet-name').fill(PET_NAME);
  await ownerPage.getByRole('button', { name: '다음' }).click(); // 모습: the first free look is preselected
  await ownerPage.getByRole('button', { name: '다음' }).click();
  await ownerPage.locator('#pet-role').fill('배포 체크리스트를 짧게 챙겨 줘.');
  await ownerPage.getByRole('button', { name: '다음' }).click();
  await expect(ownerPage.locator('#pet-route')).toHaveValue('both');
  await ownerPage.getByRole('button', { name: '다음' }).click();
  await ownerPage.locator('#pet-visibility').selectOption('company');
  await ownerPage.getByRole('button', { name: '만들기' }).click();

  await expect(ownerPage).toHaveURL(/\/pets\/[0-9a-f-]{36}$/);
  petId = ownerPage.url().split('/').pop()!;
  await expect(ownerPage.getByRole('heading', { level: 1, name: PET_NAME })).toBeVisible();
  await expect(
    ownerPage
      .getByRole('navigation', { name: '대화 목록' })
      .getByRole('link', { name: new RegExp(PET_NAME) }),
  ).toBeVisible();
});

test('a message to the pet is answered by my paired Claude Code and shown verbatim', async () => {
  const composer = ownerPage.getByRole('textbox', { name: `${PET_NAME}에게 메시지 보내기` });
  await composer.fill(QUESTION);
  await composer.press('Enter');
  const asked = ownerPage.locator('li[data-author="owner"]').filter({ hasText: QUESTION });
  await expect(asked).toBeVisible();
  const questionId = await asked.getAttribute('data-message-id');
  expect(questionId).toBeTruthy();

  // Pairing: the code is made in ENU Den (cookie), then typed by the person into `enu-pet pair` (no cookie).
  const codeRes = await owner.request.post(`${BASE_URL}/api/v1/me/pet-channel/pairing-codes`, {
    headers: { origin: BASE_URL },
  });
  expect(codeRes.status(), await codeRes.text()).toBe(201);
  const { code } = (await codeRes.json()) as { code: string };
  const pairRes = await machine.post('/api/v1/pet-channel/pair', {
    data: { code, platform: 'linux', plugin_version: '1.0.0', label: 'e2e' },
  });
  expect(pairRes.status(), await pairRes.text()).toBe(201);
  const { token } = (await pairRes.json()) as { token: string };
  const auth = { authorization: `Bearer ${token}` };

  const pollRes = await machine.post('/api/v1/pet-channel/poll', {
    headers: auth,
    data: { wait_s: 0, plugin_version: '1.0.0', include_held: true },
  });
  expect(pollRes.status(), await pollRes.text()).toBe(200);
  const poll = (await pollRes.json()) as {
    messages: { message_id: string; pet_id: string; text: string }[];
    pets: { pet_id: string; name: string; role_instructions: string | null }[];
  };
  const mine = poll.messages.find((m) => m.message_id === questionId);
  expect(mine).toMatchObject({ pet_id: petId, text: QUESTION });
  expect(poll.pets.find((p) => p.pet_id === petId)).toMatchObject({
    name: PET_NAME,
    role_instructions: '배포 체크리스트를 짧게 챙겨 줘.',
  });

  const replyRes = await machine.post('/api/v1/pet-channel/replies', {
    headers: auth,
    data: { in_reply_to: questionId, part: 1, text: REPLY },
  });
  expect(replyRes.status(), await replyRes.text()).toBe(201);
  expect(await replyRes.json()).toMatchObject({ result: 'created', visibility: 'company' });

  // `pet:changed` (owner only) makes the room refetch: the reply appears exactly as written and the pet talks.
  const answered = ownerPage.locator('li[data-author="pet"]').filter({ hasText: REPLY });
  await expect(answered).toBeVisible();
  await expect(answered.locator('div').first()).toHaveText(REPLY);
  await expect(ownerPage.locator('[data-companion-expr]')).toHaveAttribute('data-companion-expr', 'talking');
  await expect(ownerPage.locator('[role="status"]').filter({ hasText: REPLY })).toBeAttached();

  // A channel token is not a cookie session and not an MCP token.
  const asCookieRoute = await machine.get('/api/v1/me/pets', { headers: auth });
  expect(asCookieRoute.status()).toBe(401);
});

test('a colleague sees the company conversation with dates only and cannot write', async () => {
  const page = await colleague.newPage();
  await page.goto(`/people/${ownerId}`);
  const petLink = page.getByRole('main').getByRole('link', { name: new RegExp(PET_NAME) });
  await expect(petLink).toBeVisible({ timeout: 60_000 });
  await petLink.click();
  await expect(page).toHaveURL(new RegExp(`/people/${ownerId}/pets/${petId}$`));

  const room = page.getByRole('list', { name: new RegExp(PET_NAME) });
  await expect(room.getByText(QUESTION)).toBeVisible();
  await expect(room.getByText(REPLY)).toBeVisible();
  await expect(room.getByText('오늘', { exact: true })).toBeVisible();
  expect(await room.innerText()).not.toMatch(/\d{1,2}:\d{2}/);
  await expect(page.getByRole('main').getByRole('textbox')).toHaveCount(0);

  const api = await colleague.request.get(`${BASE_URL}/api/v1/users/${ownerId}/pets/${petId}/thread`);
  expect(api.ok()).toBe(true);
  const raw = await api.text();
  expect(raw).toContain(REPLY);
  expect(raw).not.toMatch(/T\d\d:\d\d/);
  expect(raw).not.toMatch(/createdAt|source|answerState|unread/);

  // The server-rendered page (HTML + RSC payload) never carries the owner's message times either. (The page
  // also holds the viewer's own MeDto, whose times may share the minute: compare exact timestamps.)
  const ownerThread = await owner.request.get(`${BASE_URL}/api/v1/me/pets/${petId}/thread`);
  const times = ((await ownerThread.json()) as { items: { createdAt: string }[] }).items.map(
    (m) => m.createdAt,
  );
  expect(times.length).toBeGreaterThanOrEqual(2);
  const html = await (await colleague.request.get(`${BASE_URL}/people/${ownerId}/pets/${petId}`)).text();
  expect(html).toContain(PET_NAME);
  for (const at of times) expect(html).not.toContain(at);

  // Only the owner writes to a pet.
  const write = await colleague.request.post(`${BASE_URL}/api/v1/me/pets/${petId}/messages`, {
    headers: { origin: BASE_URL },
    data: { text: '안녕', client_msg_id: crypto.randomUUID() },
  });
  expect(write.status()).toBe(404);
  await page.close();
});

test('전체 방 sends over the shell realtime session', async () => {
  await ownerPage
    .getByRole('navigation', { name: '대화 목록' })
    .getByRole('link', { name: '전체 방' })
    .click();
  await expect(ownerPage).toHaveURL(/\/all$/);
  const text = `e2e 전체 방 인사 ${Date.now()}`;
  const box = ownerPage.getByRole('textbox', { name: '메시지를 입력하세요' });
  await expect(ownerPage.getByRole('button', { name: '보내기' })).toBeDisabled();
  await box.fill(text);
  await expect(ownerPage.getByRole('button', { name: '보내기' })).toBeEnabled({ timeout: 30_000 });
  await box.press('Enter');
  await expect(ownerPage.getByRole('log', { name: '전체 방' }).getByText(text)).toBeVisible();
});
