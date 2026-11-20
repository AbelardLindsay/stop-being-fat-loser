// Shared by set-webhook.ts (Cloudflare) and selfhost.ts (local/VPS). Erasable TypeScript only.

export const COMMANDS = {
  en: [
    ['today', 'Today’s calories, protein/fat/carbs and what’s left'],
    ['meals', 'What you ate today and yesterday'],
    ['history', 'Calorie and protein/fat/carbs history, e.g. /history 30'],
    ['weight', 'Log weight, e.g. /weight 82.5'],
    ['walk', 'Walk reminder time, e.g. /walk 19:30'],
    ['training', 'Training days (protein shakes are fine)'],
    ['water', 'Log water, e.g. /water 500'],
    ['undo', 'Delete today’s last meal'],
    ['profile', 'Your stats and schedule'],
    ['connect', 'Owner: sign in with ChatGPT'],
    ['disconnect', 'Owner: sign out of ChatGPT'],
    ['usage', 'Owner: ChatGPT token usage'],
    ['lang', 'Switch language'],
    ['reset', 'Redo setup (history is kept)'],
    ['help', 'How it works'],
  ],
  uk: [
    ['today', 'Калорії й БЖВ за сьогодні і скільки лишилось'],
    ['meals', 'Що ти їв(ла) сьогодні й учора'],
    ['history', 'Історія калорій і БЖВ, напр. /history 30'],
    ['weight', 'Записати вагу, напр. /weight 82.5'],
    ['walk', 'Час прогулянки, напр. /walk 19:30'],
    ['training', 'Дні тренувань (шейк — норм)'],
    ['water', 'Записати воду, напр. /water 500'],
    ['undo', 'Видалити останню їжу за сьогодні'],
    ['profile', 'Твої дані й розклад'],
    ['connect', 'Власник: увійти в ChatGPT'],
    ['disconnect', 'Власник: вийти з ChatGPT'],
    ['usage', 'Власник: використання ChatGPT'],
    ['lang', 'Змінити мову'],
    ['reset', 'Налаштувати заново (історія лишається)'],
    ['help', 'Як це працює'],
  ],
};

/** Calls a Bot API method and returns its `result`; throws on `ok: false`. */
export async function telegram<T = unknown>(token: string, method: string, body: object = {}): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(`${method}: ${json.description ?? res.status}`);
  return json.result;
}

export async function setCommands(token: string): Promise<void> {
  const toCommands = (list: string[][]) => list.map(([command, description]) => ({ command, description }));
  await telegram(token, 'setMyCommands', { commands: toCommands(COMMANDS.en) });
  await telegram(token, 'setMyCommands', { commands: toCommands(COMMANDS.uk), language_code: 'uk' });
}
