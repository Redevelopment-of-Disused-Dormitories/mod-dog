/* mod dog — demo.js
   Demo mode — generates simulated chat traffic for testing all systems. */

const DEMO_USERS = [
  { id: 'u1', name: 'xX_Gamer_Xx', age: 2 },
  { id: 'u2', name: '實況小助手', age: 847 },
  { id: 'u3', name: 'spam_bot_9000', age: 0 },
  { id: 'u4', name: '電競狂人', age: 1203 },
  { id: 'u5', name: '新注册用户', age: 0 },
  { id: 'u6', name: 'TrollMaster', age: 1 },
  { id: 'u7', name: '安安你好', age: 45 },
  { id: 'u8', name: '夜貓子直播', age: 892 },
  { id: 'u9', name: 'test_user_001', age: 0 },
  { id: 'u10', name: '釣魚高手', age: 33 },
  { id: 'u11', name: '廣告機器人', age: 0 },
  { id: 'u12', name: '忠實觀眾', age: 2100 },
];

const SAFE_MESSAGES = [
  '主播加油！',
  '哈哈哈太好笑了',
  '666666',
  '這遊戲真的好玩',
  '今天播到幾點？',
  '晚安大家',
  '有人知道這是什麼遊戲嗎',
  '支持主播！',
  'GG',
  '太強了吧',
  '這是什麼操作',
  '哈哈哈笑死',
  '第一次來，感覺不錯',
  '訂閱了！',
  '推推',
  '好厲害',
  '這也行？',
  '我的天啊',
  '衝啊！',
  '穩了穩了',
];

const SPAM_MESSAGES = [
  '哈哈哈哈哈哈哈哈哈哈',
  '!!!!!!!!!!!!!!!!!!!',
  '哈哈哈哈哈哈哈哈哈哈哈哈哈',
  '買買買買買買買',
  '快來快來快來快來快來快來',
  '))))))))))))',
  '6666666666666666666666666',
  '啊啊啊啊啊啊啊啊啊啊啊',
  '))))))))))))))))))',
  'aaaaaaaaaaaaaaaaa',
];

const PII_MESSAGES = [
  '我手機是0912345678',
  '我的身分證是A123456789',
  '聯絡我 email: test@example.com',
  '我家電話0223456789',
  '我的卡號4111 1111 1111 1111',
  '我的IP是192.168.1.100',
  '手機 0987654321',
  '身份證字號B234567890',
];

const CROSS_MESSAGES = [
  '去我的YouTube頻道看',
  'https://spam-link.com/bad',
  '加我Line: spamservice',
  '免費點數領取：https://scam.com',
];

const NEW_ACCOUNT_MESSAGES = [
  '新来的观众请订阅',
  '新人求关注',
  '刚来，主播好厉害',
  '第一次看直播',
  '新观众报到',
];

let demoInterval = null;
let messageCount = 0;
const callbacks = new Set();

export function onMessage(fn) { callbacks.add(fn); return () => callbacks.delete(fn); }

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateMessage() {
  messageCount++;
  const roll = Math.random();
  let user, text;

  if (roll < 0.15) {
    // Spam flood
    user = { ...pickRandom(DEMO_USERS.filter((u) => u.age < 2)) };
    text = pickRandom(SPAM_MESSAGES);
  } else if (roll < 0.25) {
    // PII leak
    user = pickRandom(DEMO_USERS.filter((u) => u.age > 100));
    text = pickRandom(PII_MESSAGES);
  } else if (roll < 0.32) {
    // Suspicious link
    user = pickRandom(DEMO_USERS.filter((u) => u.age < 5));
    text = pickRandom(CROSS_MESSAGES);
  } else if (roll < 0.38) {
    // New account flood (grouped spam)
    user = { id: `new_${messageCount}`, name: `new_user_${messageCount}`, age: 0 };
    text = pickRandom(NEW_ACCOUNT_MESSAGES);
  } else {
    // Normal message
    user = pickRandom(DEMO_USERS);
    text = pickRandom(SAFE_MESSAGES);
  }

  return {
    id: `msg_${messageCount}`,
    userId: user.id,
    username: user.name,
    accountAge: user.age,
    text,
    timestamp: Date.now(),
    badge: user.age === 0 ? 'NEW' : user.age > 500 ? 'VIP' : null,
  };
}

export function start(intervalMs = 300) {
  stop();
  demoInterval = setInterval(() => {
    const msg = generateMessage();
    for (const fn of callbacks) fn(msg);
  }, intervalMs);
}

export function stop() {
  if (demoInterval) {
    clearInterval(demoInterval);
    demoInterval = null;
  }
}

export function isRunning() {
  return demoInterval !== null;
}

export function getMessageCount() {
  return messageCount;
}

export function generateBurst(count = 10) {
  const msgs = [];
  for (let i = 0; i < count; i++) {
    msgs.push(generateMessage());
  }
  return msgs;
}

export function generateSpamBurst(count = 15) {
  const msgs = [];
  const spamBot = { id: 'spambot', name: 'SPAM_BOT_99', age: 0 };
  for (let i = 0; i < count; i++) {
    msgs.push({
      id: `spam_${Date.now()}_${i}`,
      userId: spamBot.id,
      username: spamBot.name,
      accountAge: 0,
      text: i % 2 === 0 ? '哈哈哈哈哈哈哈哈哈哈哈' : '))))))))))))))))))))',
      timestamp: Date.now(),
      badge: 'NEW',
    });
  }
  return msgs;
}
