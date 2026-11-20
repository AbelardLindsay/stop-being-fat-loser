import type { Lang } from './i18n.ts';
import type { Sex } from './nutrition.ts';

export type RoastKind =
  'cola_nudge' | 'inactivity' | 'no_meals' | 'weight_up' | 'cola_drank' | 'walk_snooze' | 'week_bad' | 'water_low';

/** A gender-neutral line, or one variant per sex where the grammar or the joke depends on it. */
type Line = string | Record<Sex, string>;

// Hard mode only: profanity and fat jokes aimed at the user, who asked for it.
// Ukrainian lines are written natively (vernacular, мат), not translated from the English ones.
export const ROASTS: Record<Lang, Record<RoastKind, Line[]>> = {
  en: {
    cola_nudge: [
      'Put the fucking cola down, fatass. Your gut doesn’t need another roll.',
      'Another soda? That’s exactly why your belly enters the room before you do.',
      'One can and you’re back to wheezing on the stairs like a fat fuck. Water.',
      'Cola is the reason nobody wants to see you naked. Think about that, lardass.',
      'You already look like a cola barrel. Stop topping it up.',
    ],
    inactivity: [
      'Two days without a walk, you walking tub of lard. Get your fat ass up. MOVE.',
      'The couch is groaning under you. Get up before it files a fucking complaint.',
      'You don’t move, so you don’t get laid. Simple math. Door. Street. Now.',
      'Your gut has its own gravitational pull. 30 minutes of walking, fatass.',
      'Even your shadow is thinner than you, because it at least goes outside.',
    ],
    no_meals: [
      'Nothing logged? Bullshit, fatass. Your chins say you ate.',
      'You can hide food from the log, not from the mirror, pig. Photos.',
      'Zero photos and still three chins. Log what you shove in your face.',
      'Eat in secret all you want — your gut snitches on you anyway. Photos. NOW.',
    ],
    weight_up: [
      'Weight’s up, you fat pig. Keep going and Greenpeace will roll you back into the ocean.',
      'Plus a kilo. Congrats, you’re one step closer to never getting laid again.',
      'The scale doesn’t lie: you’re getting fatter. What the fuck are you doing?',
      'Up again, lardass. Your pants are writing their will.',
      'You won’t lose shit eating like a hog. Fix it at the next meal.',
    ],
    cola_drank: [
      'You drank cola, fatass? Streak’s dead, just like your waistline.',
      'One more can and your gut gets its own zip code.',
      'Weak-ass choice. This is why you’re not getting laid.',
      'That can just added another roll. Tasty, piggy?',
    ],
    walk_snooze: [
      'Snooze? You lazy fat bitch. Fine. When it rings again, your ass is out the door.',
      'Deferring a 30-minute walk, you lazy fat bitch? Your gut didn’t snooze — it grew.',
      'Lazy fat bitch move. Every minute you stall, the couch wins.',
      'Snoozed, lardass. Next ping you walk, or you admit you’re just a lazy fat bitch.',
    ],
    week_bad: [
      'Shit week, fatass. Over target, under walks. Tomorrow you fix it.',
      'That week was a fucking buffet. Next week you earn your food.',
      'You coasted all week like a lazy fat fuck. Reset. Execute.',
      'Weekly verdict: soft, lazy and fatter. Prove it wrong next week.',
    ],
    water_low: [
      'You’ve drunk less water than a cactus, fatass. Bottle. Now.',
      'Half the day gone and you’re dry as a fucking raisin. Drink.',
      'Thirst feels like hunger, lardass — that’s half your snacking. Water first.',
      'Your piss is darker than your future at this rate. Drink a glass. Now.',
    ],
  },
  uk: {
    cola_nudge: [
      {
        male: 'Колу — нахуй. Тобі, кабанчику, ще одна складка на пузі ні до чого.',
        female: 'Колу — нахуй. Тобі, свинко, ще одна складка на пузі ні до чого.',
      },
      'Тягне на солодку хуйню? Перетопчешся. Пузо й так через ремінь звисає.',
      {
        male: 'Одна банка — і знову сопеш на третьому поверсі, як старий кабан. Пий воду, блядь.',
        female: 'Одна банка — і знову сопеш на третьому поверсі, як стара свиноматка. Пий воду, блядь.',
      },
      'Через оцю колу тебе ніхто й роздягати не хоче. Подумай, сука.',
      'Ти й так уже як діжка з колою. Годі доливати.',
    ],
    inactivity: [
      'Два дні на дивані, сало ходяче. Ану піднімай сраку. Бігом.',
      'Диван під тобою вже рипить, блядь. Злазь, поки ніжки не повідвалювались.',
      {
        male: 'Не ворушишся — от тобі ніхто й не дає. Взувайся. На вулицю. Зараз.',
        female: 'Не ворушишся — от тебе ніхто й не хоче. Взувайся. На вулицю. Зараз.',
      },
      {
        male: 'Пузо вже на коліна лягає, жиртресте. Пів години ходьби, бігом.',
        female: 'Пузо вже на коліна лягає, товстухо. Пів години ходьби, бігом.',
      },
      'Сука, навіть сусідський кіт ходить більше за тебе.',
    ],
    no_meals: [
      {
        male: 'Нічого не записано? Не пизди, жирдяю. По ряшці видно, що жер.',
        female: 'Нічого не записано? Не пизди, жирдяйко. По ряшці видно, що жерла.',
      },
      'Від журналу сховаєш, а від дзеркала — хуй там, свиното. Фото сюди.',
      'Нуль фото, а підборідь усе одно три. Фоткай, що трескаєш, блядь.',
      'Хаваєш нишком? Пузо все одно здасть тебе з потрохами. Фото. Бігом.',
    ],
    weight_up: [
      'Вага пішла вгору, свинота. Ще трохи — і в маршрутку боком заходитимеш.',
      {
        male: 'Плюс кіло. Вітаю, так тобі взагалі ніхто ніколи не дасть.',
        female: 'Плюс кіло. Вітаю, так тебе взагалі ніхто ніколи не захоче.',
      },
      'Ваги не пиздять: ти жирнієш. Ти шо твориш, а?',
      'Знову плюс, сало. Штани вже по швах тріщать.',
      'Жереш як не в себе — от і маєш. Виправляй, блядь, з наступної їжі.',
    ],
    cola_drank: [
      {
        male: 'Колу випив, жирдяю? Серія накрилась пиздою, як і твоя талія.',
        female: 'Колу випила, жирдяйко? Серія накрилась пиздою, як і твоя талія.',
      },
      'Ще банка — і пузо в двері не пролізе.',
      {
        male: 'Слабак хуїв. От через таке тобі ніхто й не дає.',
        female: 'Слабачка йобана. От через таке тебе ніхто й не хоче.',
      },
      'Йобана кола — і ще одна складка. Ну шо, смачно було, свиното?',
    ],
    walk_snooze: [
      {
        male: 'Відкладаєш? Лінивий жирний сучара. Наступного разу — ноги в руки й на вулицю.',
        female: 'Відкладаєш? Лінива жирна сука. Наступного разу — ноги в руки й на вулицю.',
      },
      {
        male: 'Відклав пів години ходьби, ледащо? Пузо от не відкладає — росте.',
        female: 'Відклала пів години ходьби, ледащо? Пузо от не відкладає — росте.',
      },
      'Поки ти тягнеш кота за хвіст, диван виграє, ледаче сало.',
      {
        male: 'Відклав, сало ходяче. Наступного разу або йдеш, або ти просто лінивий жирний сучара.',
        female: 'Відклала, сало ходяче. Наступного разу або йдеш, або ти просто лінива жирна сука.',
      },
    ],
    week_bad: [
      {
        male: 'Гівняний тиждень, жирна срако. Жер забагато, ходив замало. Завтра виправляєш.',
        female: 'Гівняний тиждень, жирна срако. Жерла забагато, ходила замало. Завтра виправляєш.',
      },
      {
        male: 'Цілий тиждень жер, як на весіллі. Наступного тижня їжу ще треба заробити.',
        female: 'Цілий тиждень жерла, як на весіллі. Наступного тижня їжу ще треба заробити.',
      },
      {
        male: 'Цілий тиждень філонив, як лінивий жирний сучара. Все з нуля. Виконуй.',
        female: 'Цілий тиждень філонила, як лінива жирна сука. Все з нуля. Виконуй.',
      },
      {
        male: 'Підсумок тижня: розлізся ще більше. Наступного тижня доведи, що ти не холодець.',
        female: 'Підсумок тижня: розлізлася ще більше. Наступного тижня доведи, що ти не холодець.',
      },
    ],
    water_low: [
      {
        male: 'За день випив менше, ніж кімнатний вазон, жирна срако. Пляшку в руки. Зараз.',
        female: 'За день випила менше, ніж кімнатний вазон, жирна срако. Пляшку в руки. Зараз.',
      },
      {
        male: 'Пів дня минуло, а ти сухий, як тараня. Пий, блядь.',
        female: 'Пів дня минуло, а ти суха, як тараня. Пий, блядь.',
      },
      'Тобі не їсти хочеться, сало, а пити — от звідки половина твоїх перекусів. Спершу вода.',
      'З такою кількістю води ти не худнеш, а вʼялишся. Склянку. Негайно.',
    ],
  },
};

export function pickRoast(lang: Lang, kind: RoastKind, sex: Sex): string {
  const lines = ROASTS[lang][kind];
  const line = lines[Math.floor(Math.random() * lines.length)] ?? '';
  return typeof line === 'string' ? line : line[sex];
}
